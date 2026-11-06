import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminServerSession,
  createAuthenticatedAdminDbClient,
  createServiceRoleClient,
  hasRequiredRole,
} from '@/lib/supabase/admin-server';
import { recordAdminAuditLog, getMemoryAuditLogs } from '@/lib/admin/audit-and-rate-limit';
import {
  AdminAuditLogRow,
  AdminRole,
  BalanceLedgerRow,
  CurrencyRow,
  ExchangeRateRow,
  ProfileRow,
  resolveUserNumber,
  TradeRow,
  UserStatus,
  WalletRequestRow,
} from '@/lib/supabase/types';
import { calculateRatePercentChange, DEFAULT_USDT_NPR_RATE } from '@/lib/currency';

export const dynamic = 'force-dynamic';

function extractClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}

export async function GET(request: NextRequest) {
  const session = await verifyAdminServerSession('SUPPORT');
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: valid admin session required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'dashboard';
  const userId = searchParams.get('userId');
  const days = Math.min(90, Math.max(7, Number(searchParams.get('days') || '30')));

  const userDb = createAuthenticatedAdminDbClient(session.accessToken);
  const db = createServiceRoleClient() || userDb;
  if (!db) {
    return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
  }

  try {
    // Server-side parameterized user search (restricted to SUPPORT/ADMIN/SUPERADMIN)
    if (view === 'search-users') {
      const q = (searchParams.get('q') || '').trim();
      const roleFilter = (searchParams.get('role') || 'ALL').trim().toUpperCase();
      const statusFilter = (searchParams.get('status') || 'ALL').trim().toUpperCase();

      // 1. Try server-side RPC admin_search_users first
      const { data: rpcUsers, error: rpcErr } = await db.rpc('admin_search_users', {
        p_query: q,
        p_role: roleFilter,
        p_status: statusFilter,
        p_limit: 100,
      });

      if (!rpcErr && Array.isArray(rpcUsers)) {
        const normalized = (rpcUsers as ProfileRow[]).map((p) => ({
          ...p,
          user_number: resolveUserNumber(p.user_number, p.id),
        }));
        return NextResponse.json(
          { users: normalized },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }

      // 2. Parameterized fallback if migration RPC hasn't been executed yet
      const { data: allProfiles } = await db
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      const enriched = ((allProfiles || []) as ProfileRow[]).map((p) => ({
        ...p,
        user_number: resolveUserNumber(p.user_number, p.id),
      }));

      const isFiveDigit = /^\d{5}$/.test(q);
      const exactNum = isFiveDigit ? Number(q) : null;
      const lowerQ = q.toLowerCase();

      const filtered = enriched
        .filter((p) => {
          const effectiveRole = (p.role || (p.is_admin ? 'ADMIN' : 'USER')).toUpperCase();
          const effectiveStatus = (p.status || 'ACTIVE').toUpperCase();
          if (roleFilter !== 'ALL' && effectiveRole !== roleFilter) return false;
          if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
          if (!q) return true;
          if (exactNum !== null && p.user_number === exactNum) return true;
          return (
            String(p.user_number).includes(lowerQ) ||
            (p.email || '').toLowerCase().includes(lowerQ) ||
            (p.display_name || p.name || '').toLowerCase().includes(lowerQ) ||
            p.id.toLowerCase() === lowerQ ||
            p.id.toLowerCase().includes(lowerQ)
          );
        })
        .sort((a, b) => {
          if (exactNum !== null) {
            const aExact = a.user_number === exactNum ? 0 : 1;
            const bExact = b.user_number === exactNum ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
          }
          return (
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime()
          );
        });

      return NextResponse.json(
        { users: filtered.slice(0, 100) },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (view === 'audit-log') {
      if (!hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPERADMIN role required to view audit logs.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const [{ data: logs }, { data: profiles }] = await Promise.all([
        db
          .from('admin_audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('profiles').select('id, user_number, email, display_name').limit(500),
      ]);

      const userMap = new Map<string, { user_number: number; email?: string | null }>();
      for (const p of (profiles || []) as ProfileRow[]) {
        userMap.set(p.id, {
          user_number: resolveUserNumber(p.user_number, p.id),
          email: p.email,
        });
      }

      const rawLogs = (
        logs && logs.length > 0 ? logs : getMemoryAuditLogs()
      ) as AdminAuditLogRow[];

      const combinedLogs = rawLogs.map((log) => {
        const adminInfo = log.admin_user_id ? userMap.get(log.admin_user_id) : undefined;
        const targetInfo =
          log.target_id && userMap.has(log.target_id)
            ? userMap.get(log.target_id)
            : undefined;
        const metaUserNum =
          log.metadata && typeof log.metadata.target_user_number === 'number'
            ? (log.metadata.target_user_number as number)
            : undefined;

        return {
          ...log,
          admin_user_number:
            adminInfo?.user_number ??
            (log.admin_user_id ? resolveUserNumber(null, log.admin_user_id) : null),
          target_user_number:
            metaUserNum ??
            targetInfo?.user_number ??
            (log.target_type === 'profile' && log.target_id
              ? resolveUserNumber(null, log.target_id)
              : null),
        };
      });

      return NextResponse.json(
        { auditLogs: combinedLogs },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (view === 'admins') {
      if (!hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPERADMIN role required to manage admins.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const { data: admins } = await db
        .from('profiles')
        .select('*')
        .in('role', ['SUPPORT', 'ADMIN', 'SUPERADMIN'])
        .order('created_at', { ascending: false });

      const enrichedAdmins = ((admins || []) as ProfileRow[]).map((p) => ({
        ...p,
        user_number: resolveUserNumber(p.user_number, p.id),
      }));

      return NextResponse.json(
        {
          admins: enrichedAdmins,
          serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (view === 'exchange-rates') {
      const [{ data: rateRows }, { data: currencyRows }, { data: adminProfiles }] =
        await Promise.all([
          db
            .from('exchange_rates')
            .select('*')
            .eq('base', 'USDT')
            .eq('quote', 'NPR')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(100),
          db.from('currencies').select('*').order('display_order', { ascending: true }),
          db
            .from('profiles')
            .select('id, email, display_name, user_number')
            .in('role', ['SUPPORT', 'ADMIN', 'SUPERADMIN']),
        ]);

      const adminMap = new Map<
        string,
        { email: string; display_name: string; user_number: number }
      >();
      for (const p of (adminProfiles || []) as ProfileRow[]) {
        adminMap.set(p.id, {
          email: p.email || '',
          display_name: p.display_name || p.name || 'Admin',
          user_number: resolveUserNumber(p.user_number, p.id),
        });
      }

      const enrichedRates: ExchangeRateRow[] =
        rateRows && rateRows.length > 0
          ? (rateRows as ExchangeRateRow[]).map((r) => {
              const setter = r.set_by ? adminMap.get(r.set_by) : undefined;
              return {
                ...r,
                rate: Number(r.rate),
                set_by_email: setter?.email || (r.set_by ? r.set_by.slice(0, 8) : 'System Seed'),
                set_by_name: setter?.display_name || (r.set_by ? 'Admin' : 'System Default'),
              };
            })
          : [
              {
                id: 1,
                base: 'USDT',
                quote: 'NPR',
                rate: DEFAULT_USDT_NPR_RATE,
                reason: 'Initial default exchange rate (1 USDT = Rs 134.50)',
                set_by: null,
                set_by_email: 'System Seed',
                set_by_name: 'System Default',
                created_at: new Date().toISOString(),
              },
            ];

      const defaultCurrencies: CurrencyRow[] = [
        {
          code: 'USDT',
          symbol: '$',
          decimals: 2,
          is_active: true,
          display_order: 1,
        },
        {
          code: 'NPR',
          symbol: 'Rs',
          decimals: 2,
          is_active: true,
          display_order: 2,
        },
      ];

      return NextResponse.json(
        {
          session,
          currentRate: enrichedRates[0],
          rateHistory: enrichedRates,
          currencies:
            currencyRows && currencyRows.length > 0
              ? (currencyRows as CurrencyRow[])
              : defaultCurrencies,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (view === 'user-detail' && userId) {
      let profileData: ProfileRow | null = null;

      if (/^\d{5}$/.test(userId.trim())) {
        const { data: byNum } = await db
          .from('profiles')
          .select('*')
          .eq('user_number', Number(userId.trim()))
          .maybeSingle();
        profileData = (byNum as ProfileRow | null) || null;
      }

      if (!profileData) {
        const { data: byId } = await db
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        profileData = (byId as ProfileRow | null) || null;
      }

      const resolvedUuid = profileData?.id || userId;
      const resolvedUserNum = profileData
        ? resolveUserNumber(profileData.user_number, profileData.id)
        : resolveUserNumber(null, resolvedUuid);

      const [
        { data: trades },
        { data: requests },
        { data: ledger },
      ] = await Promise.all([
        db
          .from('trades')
          .select('*')
          .eq('user_id', resolvedUuid)
          .order('opened_at', { ascending: false })
          .limit(100),
        db
          .from('wallet_requests')
          .select('*')
          .eq('user_id', resolvedUuid)
          .order('created_at', { ascending: false })
          .limit(50),
        db
          .from('balance_ledger')
          .select('*')
          .eq('user_id', resolvedUuid)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      return NextResponse.json(
        {
          profile: profileData
            ? { ...profileData, user_number: resolvedUserNum }
            : null,
          trades: ((trades || []) as TradeRow[]).map((t) => ({
            ...t,
            user_number: resolvedUserNum,
          })),
          requests: ((requests || []) as WalletRequestRow[]).map((r) => ({
            ...r,
            user_number: r.user_number ?? resolvedUserNum,
          })),
          ledger: ((ledger || []) as BalanceLedgerRow[]).map((l) => ({
            ...l,
            user_number: resolvedUserNum,
            entry_type: l.entry_type || l.type || 'ADJUSTMENT',
            delta: l.delta ?? l.amount ?? 0,
          })),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Default comprehensive admin payload for dashboard & sections
    const sinceDate = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const [
      { data: profiles },
      { data: trades },
      { data: walletRequests },
      { data: ledger },
      { data: assets },
      { data: auditLogs },
      { data: settings },
    ] = await Promise.all([
      db.from('profiles').select('*').order('created_at', { ascending: false }).limit(500),
      db
        .from('trades')
        .select('*')
        .gte('opened_at', sinceDate)
        .order('opened_at', { ascending: false })
        .limit(1000),
      db
        .from('wallet_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300),
      db
        .from('balance_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300),
      db.from('assets').select('*').order('symbol', { ascending: true }),
      hasRequiredRole(session.role, 'ADMIN')
        ? db
            .from('admin_audit_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      db.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
    ]);

    const userMap = new Map<
      string,
      {
        user_number: number;
        email: string;
        display_name: string;
        balance: number;
      }
    >();

    const enrichedProfiles = ((profiles || []) as ProfileRow[]).map((p) => {
      const uNum = resolveUserNumber(p.user_number, p.id);
      userMap.set(p.id, {
        user_number: uNum,
        email: p.email || '',
        display_name: p.display_name || p.name || 'Trader',
        balance: Number(p.balance || 0),
      });
      return {
        ...p,
        user_number: uNum,
      };
    });

    const enrichedRequests = ((walletRequests || []) as WalletRequestRow[]).map((r) => {
      const uInfo = userMap.get(r.user_id);
      return {
        ...r,
        user_number: r.user_number ?? uInfo?.user_number ?? resolveUserNumber(null, r.user_id),
        user_email: uInfo?.email || undefined,
        user_display_name: uInfo?.display_name || undefined,
        user_balance: uInfo?.balance ?? undefined,
      };
    });

    const enrichedLedger = ((ledger || []) as BalanceLedgerRow[]).map((l) => {
      const uInfo = userMap.get(l.user_id);
      return {
        ...l,
        entry_type: l.entry_type || l.type || 'ADJUSTMENT',
        delta: l.delta ?? l.amount ?? 0,
        user_number: uInfo?.user_number ?? resolveUserNumber(null, l.user_id),
        user_email: uInfo?.email || undefined,
        user_display_name: uInfo?.display_name || undefined,
      };
    });

    const enrichedTrades = ((trades || []) as TradeRow[]).map((t) => {
      const uInfo = userMap.get(t.user_id);
      return {
        ...t,
        user_number: uInfo?.user_number ?? resolveUserNumber(null, t.user_id),
        user_email: uInfo?.email || undefined,
        user_display_name: uInfo?.display_name || undefined,
      };
    });

    const rawAuditLogs = (
      auditLogs && auditLogs.length > 0 ? auditLogs : getMemoryAuditLogs().slice(0, 50)
    ) as AdminAuditLogRow[];

    const mergedAuditLogs = rawAuditLogs.map((log) => {
      const adminInfo = log.admin_user_id ? userMap.get(log.admin_user_id) : undefined;
      const targetInfo =
        log.target_id && userMap.has(log.target_id)
          ? userMap.get(log.target_id)
          : undefined;
      return {
        ...log,
        admin_user_number:
          adminInfo?.user_number ??
          (log.admin_user_id ? resolveUserNumber(null, log.admin_user_id) : null),
        target_user_number:
          targetInfo?.user_number ??
          (log.target_type === 'profile' && log.target_id
            ? resolveUserNumber(null, log.target_id)
            : null),
      };
    });

    return NextResponse.json(
      {
        session,
        profiles: enrichedProfiles,
        trades: enrichedTrades,
        walletRequests: enrichedRequests,
        ledger: enrichedLedger,
        assets: assets || [],
        auditLogs: mergedAuditLogs,
        settings: settings || {
          maintenance_mode: false,
          default_virtual_balance: 10000,
          max_trade_stake: 5000,
          min_trade_stake: 1,
          allow_new_registrations: true,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  const session = await verifyAdminServerSession('SUPPORT');
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: valid admin session required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const userDb = createAuthenticatedAdminDbClient(session.accessToken);
  const db = createServiceRoleClient() || userDb;
  if (!db) {
    return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
  }

  async function processRequestReviewFallback(
    requestId: string,
    approve: boolean,
    adminNote?: string
  ) {
    const { data: reqRow, error: reqErr } = await db
      .from('wallet_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (reqErr || !reqRow) {
      throw new Error(reqErr?.message || 'Wallet request not found.');
    }

    if (reqRow.status !== 'PENDING') {
      throw new Error(
        `Request has already been reviewed (status: ${reqRow.status}).`
      );
    }

    const { data: profRow, error: profErr } = await db
      .from('profiles')
      .select('*')
      .eq('id', reqRow.user_id)
      .maybeSingle();

    if (profErr || !profRow) {
      throw new Error(profErr?.message || 'Target user profile not found.');
    }

    const cleanNote = (adminNote || '').trim() || null;
    const reqAmount = Number(reqRow.amount || 0);
    const currentBal = Number(profRow.balance || 0);
    const uNum = resolveUserNumber(
      profRow.user_number ?? reqRow.user_number,
      reqRow.user_id
    );

    if (approve) {
      if (reqRow.type === 'WITHDRAW' && currentBal < reqAmount) {
        throw new Error(
          `Insufficient user balance ($${currentBal.toFixed(
            2
          )}) to approve withdrawal of $${reqAmount.toFixed(2)}.`
        );
      }

      const deltaVal = reqRow.type === 'DEPOSIT' ? reqAmount : -reqAmount;
      const nextBal = Number((currentBal + deltaVal).toFixed(2));

      const { error: balUpdateErr } = await db
        .from('profiles')
        .update({ balance: nextBal })
        .eq('id', reqRow.user_id);

      if (balUpdateErr) {
        throw new Error(balUpdateErr.message);
      }

      const { data: updatedReq, error: updReqErr } = await db
        .from('wallet_requests')
        .update({
          status: 'APPROVED',
          user_number: uNum,
          admin_note: cleanNote ?? reqRow.admin_note,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session!.userId,
        })
        .eq('id', requestId)
        .select('*')
        .maybeSingle();

      if (updReqErr) {
        throw new Error(updReqErr.message);
      }

      try {
        await db.from('balance_ledger').insert({
          user_id: reqRow.user_id,
          user_number: uNum,
          type: reqRow.type,
          entry_type: reqRow.type,
          amount: deltaVal,
          delta: deltaVal,
          balance_after: nextBal,
          note: `Admin approved ${String(reqRow.type).toLowerCase()} request${
            cleanNote ? `: ${cleanNote}` : ''
          }`,
        });
      } catch {
        // Ignore optional ledger error
      }

      try {
        await db.from('user_notifications').insert({
          user_id: reqRow.user_id,
          title: `${
            reqRow.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'
          } Request Approved`,
          message: `Your ${String(reqRow.type).toLowerCase()} request of $${reqAmount.toFixed(
            2
          )} (User ID: ${uNum}) was approved. New balance: $${nextBal.toFixed(2)}.`,
          type: 'REQUEST_APPROVED',
        });
      } catch {
        // Ignore notification error
      }

      return updatedReq;
    } else {
      const { data: updatedReq, error: updReqErr } = await db
        .from('wallet_requests')
        .update({
          status: 'REJECTED',
          user_number: uNum,
          admin_note: cleanNote ?? reqRow.admin_note,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session!.userId,
        })
        .eq('id', requestId)
        .select('*')
        .maybeSingle();

      if (updReqErr) {
        throw new Error(updReqErr.message);
      }

      try {
        await db.from('user_notifications').insert({
          user_id: reqRow.user_id,
          title: `${
            reqRow.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'
          } Request Rejected`,
          message: `Your ${String(reqRow.type).toLowerCase()} request of $${reqAmount.toFixed(
            2
          )} (User ID: ${uNum}) was rejected.${
            cleanNote ? ` Reason: ${cleanNote}` : ''
          }`,
          type: 'REQUEST_REJECTED',
        });
      } catch {
        // Ignore notification error
      }

      return updatedReq;
    }
  }

  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // 1. Review Virtual Wallet Request (Requires ADMIN or SUPERADMIN — SUPPORT is blocked)
    if (action === 'review_request') {
      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPPORT role is read-only and cannot review wallet requests.' },
          { status: 403 }
        );
      }

      const { requestId, approve, adminNote } = body as {
        requestId: string;
        approve: boolean;
        adminNote?: string;
      };

      const { data: rpcData, error: rpcErr } = await userDb.rpc('admin_review_request', {
        p_request_id: requestId,
        p_approve: Boolean(approve),
        p_admin_note: adminNote || null,
      });

      let data = rpcData;

      if (rpcErr) {
        try {
          data = await processRequestReviewFallback(
            requestId,
            Boolean(approve),
            adminNote
          );
        } catch (fallbackErr) {
          return NextResponse.json(
            {
              error:
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : rpcErr.message,
            },
            { status: 400 }
          );
        }
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: approve ? 'WALLET_REQUEST_APPROVED' : 'WALLET_REQUEST_REJECTED',
        targetType: 'wallet_request',
        targetId: requestId,
        metadata: { approve, adminNote: adminNote || null },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({ ok: true, data });
    }

    // 1b. Bulk Review Virtual Wallet Requests (Requires ADMIN or SUPERADMIN)
    if (action === 'bulk_review_requests') {
      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPPORT role is read-only and cannot bulk review wallet requests.' },
          { status: 403 }
        );
      }

      const { requestIds, approve, adminNote } = body as {
        requestIds: string[];
        approve: boolean;
        adminNote?: string;
      };

      if (!Array.isArray(requestIds) || requestIds.length === 0) {
        return NextResponse.json(
          { error: 'At least one requestId is required for bulk action.' },
          { status: 400 }
        );
      }

      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const reqId of requestIds.slice(0, 50)) {
        const { error: rpcErr } = await userDb.rpc('admin_review_request', {
          p_request_id: reqId,
          p_approve: Boolean(approve),
          p_admin_note: adminNote || null,
        });

        let errMsg: string | null = rpcErr ? rpcErr.message : null;

        if (rpcErr) {
          try {
            await processRequestReviewFallback(
              reqId,
              Boolean(approve),
              adminNote
            );
            errMsg = null;
          } catch (fallbackErr) {
            errMsg =
              fallbackErr instanceof Error
                ? fallbackErr.message
                : rpcErr.message;
          }
        }

        if (errMsg) {
          failed.push({ id: reqId, error: errMsg });
        } else {
          succeeded.push(reqId);
          await recordAdminAuditLog({
            adminUserId: session.userId,
            adminEmail: session.email,
            action: approve ? 'WALLET_REQUEST_APPROVED' : 'WALLET_REQUEST_REJECTED',
            targetType: 'wallet_request',
            targetId: reqId,
            metadata: { approve, bulk: true, adminNote: adminNote || null },
            ipAddress: ip,
            userAgent,
          });
        }
      }

      return NextResponse.json({
        ok: failed.length === 0,
        succeeded,
        failed,
      });
    }

    // 2. Adjust User Virtual Balance (Requires ADMIN or SUPERADMIN — SUPPORT is blocked)
    if (action === 'adjust_balance') {
      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPPORT role is read-only and cannot adjust user balances.' },
          { status: 403 }
        );
      }

      const { targetUserId, delta, exactBalance, note } = body as {
        targetUserId: string;
        delta?: number;
        exactBalance?: number;
        note?: string;
      };

      const trimmedNote =
        (note || '').trim().length >= 3
          ? (note || '').trim()
          : 'Manual admin balance adjustment';

      if (!targetUserId) {
        return NextResponse.json(
          { error: 'Valid targetUserId is required.' },
          { status: 400 }
        );
      }

      const { data: targetProfile, error: profErr } = await db
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profErr || !targetProfile) {
        return NextResponse.json(
          { error: profErr?.message || 'Target trader profile not found.' },
          { status: 404 }
        );
      }

      const currentBalance = Number(targetProfile.balance || 0);
      let numericDelta = Number(delta);

      if (
        exactBalance !== undefined &&
        exactBalance !== null &&
        Number.isFinite(Number(exactBalance))
      ) {
        const targetExact = Number(Number(exactBalance).toFixed(2));
        if (targetExact < 0 || targetExact > 10000000) {
          return NextResponse.json(
            { error: 'Target balance must be between $0.00 and $10,000,000.00.' },
            { status: 400 }
          );
        }
        numericDelta = Number((targetExact - currentBalance).toFixed(2));
      } else {
        numericDelta = Number(Number(delta).toFixed(2));
      }

      if (!Number.isFinite(numericDelta)) {
        return NextResponse.json(
          { error: 'Valid numeric balance adjustment is required.' },
          { status: 400 }
        );
      }

      if (numericDelta === 0) {
        return NextResponse.json({
          ok: true,
          newBalance: currentBalance,
          previousBalance: currentBalance,
          delta: 0,
        });
      }

      const projectedBalance = Number((currentBalance + numericDelta).toFixed(2));
      if (projectedBalance < 0) {
        return NextResponse.json(
          {
            error: `Cannot debit $${Math.abs(numericDelta).toFixed(
              2
            )}: resulting balance ($${projectedBalance.toFixed(
              2
            )}) would be negative.`,
          },
          { status: 400 }
        );
      }

      if (projectedBalance > 10000000) {
        return NextResponse.json(
          { error: 'Resulting balance cannot exceed $10,000,000.00.' },
          { status: 400 }
        );
      }

      let finalNewBalance: number | null = null;

      // 1. Try RPC admin_adjust_user_balance first
      const { data: rpcBalance, error: rpcError } = await userDb.rpc(
        'admin_adjust_user_balance',
        {
          p_target_user_id: targetUserId,
          p_delta: numericDelta,
          p_note: trimmedNote,
        }
      );

      if (
        !rpcError &&
        rpcBalance !== null &&
        rpcBalance !== undefined &&
        Number.isFinite(Number(rpcBalance))
      ) {
        finalNewBalance = Number(rpcBalance);
      } else {
        // 2. Authoritative direct update via Service Role / Admin DB client
        const { data: updatedProf, error: updateErr } = await db
          .from('profiles')
          .update({ balance: projectedBalance })
          .eq('id', targetUserId)
          .select('id, balance, user_number')
          .maybeSingle();

        if (updateErr || !updatedProf) {
          return NextResponse.json(
            {
              error:
                updateErr?.message ||
                rpcError?.message ||
                'Failed to update user balance.',
            },
            { status: 400 }
          );
        }

        finalNewBalance = Number(updatedProf.balance);
        const resolvedUserNum = resolveUserNumber(
          updatedProf.user_number ?? targetProfile.user_number,
          targetUserId
        );

        try {
          await db.from('balance_ledger').insert({
            user_id: targetUserId,
            user_number: resolvedUserNum,
            trade_id: null,
            type: 'ADJUSTMENT',
            entry_type: 'ADJUSTMENT',
            amount: numericDelta,
            delta: numericDelta,
            balance_after: finalNewBalance,
            note: trimmedNote,
          });
        } catch {
          // Ignore optional ledger insert error
        }

        try {
          await db.from('user_notifications').insert({
            user_id: targetUserId,
            title:
              numericDelta > 0
                ? 'Account Balance Credited'
                : 'Account Balance Adjusted',
            message: `An administrator ${
              numericDelta > 0 ? 'credited' : 'debited'
            } $${Math.abs(numericDelta).toFixed(2)} ${
              numericDelta > 0 ? 'to' : 'from'
            } your account (${trimmedNote}). New balance: $${finalNewBalance.toFixed(
              2
            )}.`,
            type: 'INFO',
          });
        } catch {
          // Ignore optional notification insert error
        }
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'BALANCE_ADJUSTED',
        targetType: 'profile',
        targetId: targetUserId,
        metadata: {
          previousBalance: currentBalance,
          delta: numericDelta,
          newBalance: finalNewBalance,
          note: trimmedNote,
        },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({
        ok: true,
        newBalance: finalNewBalance,
        previousBalance: currentBalance,
        delta: numericDelta,
      });
    }

    // 3. Update User Status or Role
    if (action === 'update_user_status_or_role') {
      const { targetUserId, newStatus, newRole } = body as {
        targetUserId: string;
        newStatus?: UserStatus;
        newRole?: AdminRole;
      };

      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: ADMIN or SUPERADMIN role required.' },
          { status: 403 }
        );
      }

      if (newRole && !hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: Only SUPERADMIN can change user roles.' },
          { status: 403 }
        );
      }

      const { data, error } = await db.rpc('admin_update_user_role_status', {
        p_target_user_id: targetUserId,
        p_new_status: newStatus || null,
        p_new_role: newRole || null,
      });

      if (error) {
        // Fallback direct update if migration hasn't been applied yet
        const updatePayload: Record<string, unknown> = {};
        if (newStatus) updatePayload.status = newStatus;
        if (newRole && hasRequiredRole(session.role, 'SUPERADMIN')) {
          updatePayload.role = newRole;
          updatePayload.is_admin = newRole !== 'USER';
        }
        const { error: fallbackErr } = await db
          .from('profiles')
          .update(updatePayload)
          .eq('id', targetUserId);
        if (fallbackErr) {
          return NextResponse.json({ error: fallbackErr.message }, { status: 400 });
        }
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'USER_ROLE_STATUS_UPDATED',
        targetType: 'profile',
        targetId: targetUserId,
        metadata: { newStatus, newRole },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({ ok: true, data });
    }

    // 4. Update Market Asset Configuration (Requires ADMIN or SUPERADMIN)
    if (action === 'update_asset') {
      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: ADMIN or SUPERADMIN role required to update assets.' },
          { status: 403 }
        );
      }

      const { assetId, payoutPercent, payoutRate, volatility, anchorPrice, isActive } = body as {
        assetId: string;
        payoutPercent?: number;
        payoutRate?: number;
        volatility?: number;
        anchorPrice?: number;
        isActive?: boolean;
      };

      if (!assetId) {
        return NextResponse.json({ error: 'assetId is required.' }, { status: 400 });
      }

      const updateFields: Record<string, unknown> = {};

      if (volatility !== undefined) {
        const numericVolatility = Number(volatility);
        if (
          !Number.isFinite(numericVolatility) ||
          numericVolatility < 0 ||
          numericVolatility > 0.5
        ) {
          return NextResponse.json(
            {
              error:
                'Volatility must be between 0.000 and 0.500 (% per 1-second tick).',
            },
            { status: 400 }
          );
        }
        updateFields.volatility = Number(numericVolatility.toFixed(6));
      }

      if (anchorPrice !== undefined) {
        const numericAnchor = Number(anchorPrice);
        if (!Number.isFinite(numericAnchor) || numericAnchor <= 0) {
          return NextResponse.json({ error: 'Anchor price must be a positive number.' }, { status: 400 });
        }
        updateFields.anchor_price = numericAnchor;
      }

      if (payoutPercent !== undefined || payoutRate !== undefined) {
        const rawPayout =
          payoutPercent !== undefined
            ? Number(payoutPercent)
            : Number(payoutRate) <= 1
              ? Math.round(Number(payoutRate) * 100)
              : Math.round(Number(payoutRate));
        if (!Number.isFinite(rawPayout) || rawPayout < 50 || rawPayout > 98) {
          return NextResponse.json(
            { error: 'Payout percent must be between 50% and 98%.' },
            { status: 400 }
          );
        }
        updateFields.payout_percent = Math.round(rawPayout);
      }

      if (typeof isActive === 'boolean') {
        updateFields.is_active = isActive;
      }

      const { data, error } = await db
        .from('assets')
        .update(updateFields)
        .eq('id', assetId)
        .select('*')
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'ASSET_UPDATED',
        targetType: 'asset',
        targetId: assetId,
        metadata: updateFields,
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({ ok: true, asset: data });
    }

    // 5. Update Platform Settings (Requires SUPERADMIN)
    if (action === 'update_settings') {
      if (!hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: SUPERADMIN role required to modify platform settings.' },
          { status: 403 }
        );
      }

      const {
        maintenance_mode,
        default_virtual_balance,
        max_trade_stake,
        min_trade_stake,
        allow_new_registrations,
      } = body as {
        maintenance_mode?: boolean;
        default_virtual_balance?: number;
        max_trade_stake?: number;
        min_trade_stake?: number;
        allow_new_registrations?: boolean;
      };

      const payload = {
        id: 1,
        maintenance_mode: Boolean(maintenance_mode),
        default_virtual_balance: Number(default_virtual_balance ?? 10000),
        max_trade_stake: Number(max_trade_stake ?? 5000),
        min_trade_stake: Number(min_trade_stake ?? 1),
        allow_new_registrations: Boolean(allow_new_registrations ?? true),
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      };

      const { data, error } = await db
        .from('platform_settings')
        .upsert(payload)
        .select('*')
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'PLATFORM_SETTINGS_UPDATED',
        targetType: 'platform_settings',
        targetId: '1',
        metadata: payload,
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({ ok: true, settings: data });
    }

    // 6. SUPERADMIN-only: Create or Promote SUPPORT / ADMIN Account via Service Role Key
    if (action === 'create_admin_account') {
      if (!hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: Only SUPERADMIN can create or promote admin accounts.' },
          { status: 403 }
        );
      }

      const { email, password, displayName, role } = body as {
        email: string;
        password?: string;
        displayName?: string;
        role: 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
      };

      if (!email || !['SUPPORT', 'ADMIN', 'SUPERADMIN'].includes(role)) {
        return NextResponse.json(
          { error: 'Valid email and admin role (SUPPORT, ADMIN, SUPERADMIN) are required.' },
          { status: 400 }
        );
      }

      const normalizedEmail = email.trim().toLowerCase();
      const serviceClient = createServiceRoleClient();

      if (serviceClient) {
        // Check if user already exists in profiles or auth.users
        const { data: existingProfile } = await serviceClient
          .from('profiles')
          .select('*')
          .ilike('email', normalizedEmail)
          .maybeSingle();

        let targetUserId = existingProfile?.id;

        if (!targetUserId) {
          if (!password || password.length < 8) {
            return NextResponse.json(
              {
                error:
                  'Password (min 8 characters) is required when creating a brand-new admin user.',
              },
              { status: 400 }
            );
          }

          const { data: createdAuthUser, error: createAuthErr } =
            await serviceClient.auth.admin.createUser({
              email: normalizedEmail,
              password,
              email_confirm: true,
              user_metadata: {
                display_name: displayName || normalizedEmail.split('@')[0],
              },
            });

          if (createAuthErr || !createdAuthUser.user) {
            return NextResponse.json(
              { error: createAuthErr?.message || 'Failed to create auth user.' },
              { status: 400 }
            );
          }

          targetUserId = createdAuthUser.user.id;
        }

        const { error: upsertErr } = await serviceClient.from('profiles').upsert({
          id: targetUserId,
          email: normalizedEmail,
          display_name:
            displayName || existingProfile?.display_name || normalizedEmail.split('@')[0],
          role,
          status: 'ACTIVE',
          is_admin: true,
        });

        if (upsertErr) {
          return NextResponse.json({ error: upsertErr.message }, { status: 400 });
        }

        await recordAdminAuditLog({
          adminUserId: session.userId,
          adminEmail: session.email,
          action: 'ADMIN_ACCOUNT_CREATED_OR_PROMOTED',
          targetType: 'profile',
          targetId: targetUserId,
          metadata: { email: normalizedEmail, role },
          ipAddress: ip,
          userAgent,
        });

        return NextResponse.json({ ok: true, userId: targetUserId });
      } else {
        // Fallback if SUPABASE_SERVICE_ROLE_KEY is not set: promote existing user by email via RPC
        const { data: existingProfile } = await db
          .from('profiles')
          .select('*')
          .ilike('email', normalizedEmail)
          .maybeSingle();

        if (!existingProfile) {
          return NextResponse.json(
            {
              error:
                'SUPABASE_SERVICE_ROLE_KEY is not configured on the server to create new Auth users. Either set SUPABASE_SERVICE_ROLE_KEY in environment variables or enter the email of an existing registered user to promote them.',
            },
            { status: 400 }
          );
        }

        const { error: rpcErr } = await db.rpc('admin_update_user_role_status', {
          p_target_user_id: existingProfile.id,
          p_new_status: 'ACTIVE',
          p_new_role: role,
        });

        if (rpcErr) {
          return NextResponse.json({ error: rpcErr.message }, { status: 400 });
        }

        await recordAdminAuditLog({
          adminUserId: session.userId,
          adminEmail: session.email,
          action: 'ADMIN_ACCOUNT_PROMOTED',
          targetType: 'profile',
          targetId: existingProfile.id,
          metadata: { email: normalizedEmail, role },
          ipAddress: ip,
          userAgent,
        });

        return NextResponse.json({ ok: true, userId: existingProfile.id });
      }
    }

    // 7. SUPERADMIN-only: Remove Admin Access (Demote to USER or suspend)
    if (action === 'remove_admin_account') {
      if (!hasRequiredRole(session.role, 'SUPERADMIN')) {
        return NextResponse.json(
          { error: 'Forbidden: Only SUPERADMIN can remove admin accounts.' },
          { status: 403 }
        );
      }

      const { targetUserId } = body as { targetUserId: string };
      if (!targetUserId) {
        return NextResponse.json({ error: 'targetUserId is required.' }, { status: 400 });
      }

      if (targetUserId === session.userId) {
        return NextResponse.json(
          { error: 'You cannot remove your own SUPERADMIN access.' },
          { status: 400 }
        );
      }

      const serviceClient = createServiceRoleClient();
      if (serviceClient) {
        const { error } = await serviceClient
          .from('profiles')
          .update({ role: 'USER', is_admin: false })
          .eq('id', targetUserId);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      } else {
        const { error } = await db.rpc('admin_update_user_role_status', {
          p_target_user_id: targetUserId,
          p_new_status: 'ACTIVE',
          p_new_role: 'USER',
        });
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'ADMIN_ACCOUNT_REMOVED',
        targetType: 'profile',
        targetId: targetUserId,
        metadata: { demotedTo: 'USER' },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({ ok: true });
    }

    // 8. Set USDT -> NPR Exchange Rate (Requires ADMIN or SUPERADMIN; >20% requires SUPERADMIN + confirm flag)
    if (action === 'set_exchange_rate') {
      if (!hasRequiredRole(session.role, 'ADMIN')) {
        return NextResponse.json(
          {
            error:
              'Forbidden: Only ADMIN or SUPERADMIN can update the exchange rate.',
          },
          { status: 403 }
        );
      }

      const { rate, reason, superadminConfirm } = body as {
        rate: number | string;
        reason: string;
        superadminConfirm?: boolean;
      };

      const numericRate = Number(rate);
      const trimmedReason = (reason || '').trim();

      if (!Number.isFinite(numericRate) || numericRate < 1 || numericRate > 1000) {
        return NextResponse.json(
          { error: 'Exchange rate must be between 1.0000 and 1000.0000.' },
          { status: 400 }
        );
      }

      if (trimmedReason.length < 3) {
        return NextResponse.json(
          {
            error:
              'A clear reason (minimum 3 characters) is required when updating the exchange rate.',
          },
          { status: 400 }
        );
      }

      // Fetch current active rate to verify 20% change threshold
      const { data: latestRow } = await db
        .from('exchange_rates')
        .select('rate')
        .eq('base', 'USDT')
        .eq('quote', 'NPR')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const beforeRate =
        latestRow && Number(latestRow.rate) > 0
          ? Number(latestRow.rate)
          : DEFAULT_USDT_NPR_RATE;

      const changeInfo = calculateRatePercentChange(beforeRate, numericRate);

      if (changeInfo.exceedsTwentyPercent) {
        if (session.role !== 'SUPERADMIN') {
          return NextResponse.json(
            {
              error: `Exchange rate change (${changeInfo.formattedPercent}) exceeds 20% from current rate (${beforeRate.toFixed(
                2
              )} -> ${numericRate.toFixed(
                2
              )}). Only SUPERADMIN can confirm a rate change larger than 20%.`,
              code: 'RATE_CHANGE_EXCEEDS_20_PERCENT',
              changeInfo,
            },
            { status: 403 }
          );
        }

        if (!superadminConfirm) {
          return NextResponse.json(
            {
              error: `Exchange rate change (${changeInfo.formattedPercent}) exceeds 20%. SUPERADMIN confirmation flag (superadminConfirm = true) is required.`,
              code: 'SUPERADMIN_CONFIRMATION_REQUIRED',
              changeInfo,
            },
            { status: 400 }
          );
        }
      }

      // 1. Try calling the SECURITY DEFINER RPC admin_set_exchange_rate first
      const { data: rpcRow, error: rpcErr } = await db.rpc(
        'admin_set_exchange_rate',
        {
          p_rate: Number(numericRate.toFixed(4)),
          p_reason: trimmedReason,
          p_superadmin_confirm: Boolean(superadminConfirm),
        }
      );

      let insertedRow = rpcRow;

      if (rpcErr) {
        // Fallback direct insert into append-only exchange_rates if RPC isn't deployed yet
        const { data: fallbackRow, error: insertErr } = await db
          .from('exchange_rates')
          .insert({
            base: 'USDT',
            quote: 'NPR',
            rate: Number(numericRate.toFixed(4)),
            reason: trimmedReason,
            set_by: session.userId,
          })
          .select('*')
          .maybeSingle();

        if (insertErr) {
          return NextResponse.json(
            { error: rpcErr.message || insertErr.message },
            { status: 400 }
          );
        }
        insertedRow = fallbackRow;
      }

      await recordAdminAuditLog({
        adminUserId: session.userId,
        adminEmail: session.email,
        action: 'EXCHANGE_RATE_UPDATED',
        targetType: 'exchange_rates',
        targetId: String(insertedRow?.id || 'latest'),
        metadata: {
          base: 'USDT',
          quote: 'NPR',
          before_rate: beforeRate,
          after_rate: Number(numericRate.toFixed(4)),
          pct_change: changeInfo.percentChange,
          reason: trimmedReason,
          superadmin_confirm: Boolean(superadminConfirm),
        },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json({
        ok: true,
        exchangeRate: insertedRow,
        beforeRate,
        afterRate: Number(numericRate.toFixed(4)),
        changeInfo,
      });
    }

    return NextResponse.json({ error: `Unknown admin action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}
