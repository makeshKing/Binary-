'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserPlus,
  Activity,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Trophy,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Radio,
  ArrowRight,
  QrCode,
} from 'lucide-react';
import { getSupabaseAdminBrowserClient } from '@/lib/supabase/admin-client';
import {
  ProfileRow,
  TradeRow,
  WalletRequestRow,
  AdminAuditLogRow,
  resolveUserNumber,
} from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';
import LoadingScreen from '@/components/LoadingScreen';
import { parsePaymentProofFromNote } from '@/lib/payment-details';
import {
  PaymentProofModal,
  PaymentProofThumbnail,
} from '@/components/admin/PaymentProofModal';

interface DashboardPayload {
  session: {
    userId: string;
    email: string;
    displayName: string;
    role: 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
  };
  profiles: ProfileRow[];
  trades: TradeRow[];
  walletRequests: WalletRequestRow[];
  auditLogs: AdminAuditLogRow[];
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [daysFilter, setDaysFilter] = useState<number>(30);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<
    Array<{ id: string; type: string; summary: string; timestamp: string }>
  >([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const redirected = window.sessionStorage.getItem(
        'payment_setup_redirect_v1'
      );
      if (!redirected) {
        window.sessionStorage.setItem('payment_setup_redirect_v1', '1');
        router.replace('/admin/settings/payment-details');
      }
    }
  }, [router]);

  const fetchDashboard = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/actions?view=dashboard&days=${days}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard(daysFilter);
  }, [daysFilter, fetchDashboard]);

  // Supabase Realtime Live Activity Feed (using isolated admin browser client)
  useEffect(() => {
    const supabase = getSupabaseAdminBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel('admin-dashboard-live-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades' },
        (payload) => {
          const row = (payload.new || payload.old) as Partial<TradeRow>;
          setLiveEvents((prev) => [
            {
              id: `trade-${Date.now()}-${Math.random()}`,
              type: 'TRADE',
              summary: `${payload.eventType}: ${row.symbol || 'Asset'} ${
                row.direction || ''
              } ($${Number(row.stake || 0).toFixed(2)}) · ${row.status || ''}`,
              timestamp: new Date().toISOString(),
            },
            ...prev.slice(0, 19),
          ]);
          fetchDashboard(daysFilter);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_requests' },
        (payload) => {
          const row = (payload.new || payload.old) as Partial<WalletRequestRow>;
          setLiveEvents((prev) => [
            {
              id: `req-${Date.now()}-${Math.random()}`,
              type: 'WALLET',
              summary: `${payload.eventType}: ${row.type || 'REQUEST'} $${Number(
                row.amount || 0
              ).toFixed(2)} (${row.status || 'PENDING'})`,
              timestamp: new Date().toISOString(),
            },
            ...prev.slice(0, 19),
          ]);
          fetchDashboard(daysFilter);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [daysFilter, fetchDashboard]);

  const handleQuickReview = async (requestId: string, approve: boolean) => {
    setActionBusyId(requestId);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_request',
          requestId,
          approve,
          adminNote: approve
            ? 'Approved via Admin Dashboard quick action'
            : 'Rejected via Admin Dashboard quick action',
        }),
      });
      if (res.ok) {
        await fetchDashboard(daysFilter);
      }
    } finally {
      setActionBusyId(null);
    }
  };

  // Compute Stat Cards & Charts Data
  const metrics = useMemo(() => {
    const profiles = data?.profiles || [];
    const trades = data?.trades || [];
    const requests = data?.walletRequests || [];

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    const totalUsers = profiles.length;
    const newSignupsToday = profiles.filter(
      (p) => new Date(p.created_at).getTime() >= startOfToday
    ).length;

    const activeTraderIds = new Set(trades.map((t) => t.user_id));
    const activeTraders = activeTraderIds.size;

    const openTrades = trades.filter((t) => t.status === 'OPEN').length;
    const pendingDeposits = requests.filter(
      (r) => r.status === 'PENDING' && r.type === 'DEPOSIT'
    ).length;
    const pendingWithdrawals = requests.filter(
      (r) => r.status === 'PENDING' && r.type === 'WITHDRAW'
    ).length;

    const totalCreditsInCirculation = profiles.reduce(
      (sum, p) => sum + Number(p.balance || 0),
      0
    );

    const wonTrades = trades.filter((t) => t.status === 'WON').length;
    const lostTrades = trades.filter((t) => t.status === 'LOST').length;
    const drawTrades = trades.filter((t) => t.status === 'DRAW').length;
    const settledCount = wonTrades + lostTrades;
    const winRatioPct =
      settledCount > 0 ? ((wonTrades / settledCount) * 100).toFixed(1) : '0.0';

    // Daily buckets for last N days
    const dailyBuckets: Array<{
      dateKey: string;
      label: string;
      signups: number;
      volume: number;
    }> = [];

    for (let i = daysFilter - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyBuckets.push({ dateKey, label, signups: 0, volume: 0 });
    }

    const bucketMap = new Map(dailyBuckets.map((b) => [b.dateKey, b]));

    profiles.forEach((p) => {
      const key = new Date(p.created_at).toISOString().slice(0, 10);
      const bucket = bucketMap.get(key);
      if (bucket) bucket.signups += 1;
    });

    trades.forEach((t) => {
      const key = new Date(t.opened_at).toISOString().slice(0, 10);
      const bucket = bucketMap.get(key);
      if (bucket) bucket.volume += Number(t.stake || 0);
    });

    const latestPendingRequests = requests
      .filter((r) => r.status === 'PENDING')
      .slice(0, 10);

    return {
      totalUsers,
      newSignupsToday,
      activeTraders,
      openTrades,
      pendingDeposits,
      pendingWithdrawals,
      totalCreditsInCirculation,
      wonTrades,
      lostTrades,
      drawTrades,
      winRatioPct,
      dailyBuckets,
      latestPendingRequests,
    };
  }, [data, daysFilter]);

  const canMutateRequests =
    data?.session?.role === 'ADMIN' || data?.session?.role === 'SUPERADMIN';

  if (loading && !data) {
    return (
      <LoadingScreen
        variant="panel"
        label="Loading Admin Operational Telemetry"
      />
    );
  }

  const maxSignups = Math.max(1, ...metrics.dailyBuckets.map((b) => b.signups));
  const maxVolume = Math.max(1, ...metrics.dailyBuckets.map((b) => b.volume));
  const totalOutcomes = Math.max(
    1,
    metrics.wonTrades + metrics.lostTrades + metrics.drawTrades
  );

  return (
    <div className="space-y-8">
      {/* Header & Date Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Platform Overview
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time operational telemetry and account management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-[#0B101B] border border-slate-800 p-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDaysFilter(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  daysFilter === d
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Last {d}d
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchDashboard(daysFilter)}
            className="p-2.5 rounded-xl bg-[#0B101B] border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
            title="Refresh metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 8 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Total Users</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.totalUsers.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Registered trader profiles
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>New Signups Today</span>
            <UserPlus className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            +{metrics.newSignupsToday.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Since 00:00 local time</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Active Traders ({daysFilter}d)</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.activeTraders.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Users with ≥1 trade in window
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Open Trades</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.openTrades.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Awaiting expiry settlement
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Pending Deposit Requests</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-300">
            {metrics.pendingDeposits.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Deposit requests queued
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Pending Withdraw Requests</span>
            <ArrowUpRight className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-300">
            {metrics.pendingWithdrawals.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Withdrawal requests queued
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Total Balance in Circulation</span>
            <Coins className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white tabular-nums">
            {formatMoney(metrics.totalCreditsInCirculation)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Sum of all user live balances
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Platform Win / Loss Ratio</span>
            <Trophy className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            {metrics.winRatioPct}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {metrics.wonTrades}W / {metrics.lostTrades}L ({metrics.drawTrades} draw)
          </div>
        </div>
      </div>

      {/* 3 Charts: Signups per Day, Trading Volume per Day, Win vs Loss */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart 1: Signups per Day */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">
                Signups per Day (Last {daysFilter}d)
              </h2>
              <span className="text-xs font-mono text-indigo-400">
                {metrics.dailyBuckets.reduce((a, b) => a + b.signups, 0)} total
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mb-4">
              Daily new account registrations
            </p>
          </div>

          <div className="h-44 flex items-end gap-1 pt-4 border-b border-slate-800/80">
            {metrics.dailyBuckets.map((b) => {
              const heightPct = Math.max(6, Math.round((b.signups / maxSignups) * 100));
              return (
                <div
                  key={b.dateKey}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative"
                >
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t transition-all ${
                      b.signups > 0
                        ? 'bg-indigo-500 group-hover:bg-indigo-400'
                        : 'bg-slate-800/60'
                    }`}
                  />
                  <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute -top-8 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-[10px] font-mono text-white whitespace-nowrap z-10">
                    {b.label}: {b.signups}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2">
            <span>{metrics.dailyBuckets[0]?.label}</span>
            <span>
              {metrics.dailyBuckets[metrics.dailyBuckets.length - 1]?.label}
            </span>
          </div>
        </div>

        {/* Chart 2: Trading Volume per Day */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">
                Trading Volume per Day
              </h2>
              <span className="text-xs font-mono text-emerald-400 tabular-nums">
                {formatMoney(
                  metrics.dailyBuckets.reduce((a, b) => a + b.volume, 0)
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mb-4">
              Stake volume across all pairs
            </p>
          </div>

          <div className="h-44 flex items-end gap-1 pt-4 border-b border-slate-800/80">
            {metrics.dailyBuckets.map((b) => {
              const heightPct = Math.max(6, Math.round((b.volume / maxVolume) * 100));
              return (
                <div
                  key={b.dateKey}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative"
                >
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t transition-all ${
                      b.volume > 0
                        ? 'bg-emerald-500 group-hover:bg-emerald-400'
                        : 'bg-slate-800/60'
                    }`}
                  />
                  <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute -top-8 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-[10px] font-mono text-white whitespace-nowrap z-10 tabular-nums">
                    {b.label}: {formatMoney(b.volume)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2">
            <span>{metrics.dailyBuckets[0]?.label}</span>
            <span>
              {metrics.dailyBuckets[metrics.dailyBuckets.length - 1]?.label}
            </span>
          </div>
        </div>

        {/* Chart 3: Win vs Loss Distribution */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white mb-1">
              Win vs Loss Breakdown
            </h2>
            <p className="text-[11px] text-slate-400 mb-6">
              Settled binary contracts in the last {daysFilter} days
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-emerald-300 font-medium">Trader Wins (WON)</span>
                  <span className="font-mono text-slate-300">
                    {metrics.wonTrades} (
                    {Math.round((metrics.wonTrades / totalOutcomes) * 100)}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${Math.round((metrics.wonTrades / totalOutcomes) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-rose-300 font-medium">Trader Losses (LOST)</span>
                  <span className="font-mono text-slate-300">
                    {metrics.lostTrades} (
                    {Math.round((metrics.lostTrades / totalOutcomes) * 100)}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500"
                    style={{
                      width: `${Math.round(
                        (metrics.lostTrades / totalOutcomes) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-medium">Tie / Draw (DRAW)</span>
                  <span className="font-mono text-slate-400">
                    {metrics.drawTrades} (
                    {Math.round((metrics.drawTrades / totalOutcomes) * 100)}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-slate-400"
                    style={{
                      width: `${Math.round(
                        (metrics.drawTrades / totalOutcomes) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Total Settled</span>
            <span className="font-mono text-white font-semibold">
              {metrics.wonTrades + metrics.lostTrades + metrics.drawTrades} trades
            </span>
          </div>
        </div>
      </div>

      {/* 3 Operational Widgets: Latest 10 Pending Requests, Live Activity Feed, Recent Admin Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Widget 1: Latest 10 Pending Requests */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Latest Pending Requests
              </h2>
              <p className="text-[11px] text-slate-400">
                Up to 10 queued deposit/withdraw requests
              </p>
            </div>
            {canMutateRequests && (
              <Link
                href="/admin/requests"
                className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-80">
            {metrics.latestPendingRequests.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500">
                No pending wallet requests.
              </div>
            ) : (
              metrics.latestPendingRequests.map((req) => {
                const parsed = parsePaymentProofFromNote(req.note);
                const uNum = resolveUserNumber(req.user_number, req.user_id);
                return (
                  <div
                    key={req.id}
                    className="p-3 rounded-lg border border-slate-800 bg-[#070B12] flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                              req.type === 'DEPOSIT'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {req.type}
                          </span>
                          <span className="text-xs font-mono font-bold text-white tabular-nums">
                            {formatMoney(req.amount)}
                          </span>
                          {parsed.methodLabel && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-mono font-bold text-indigo-300">
                              {parsed.methodLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-1">
                          User ID: #{uNum} ·{' '}
                          {new Date(req.created_at).toLocaleTimeString()}
                        </div>
                      </div>

                      {canMutateRequests ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={actionBusyId === req.id}
                            onClick={() => handleQuickReview(req.id, true)}
                            className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 cursor-pointer disabled:opacity-50"
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={actionBusyId === req.id}
                            onClick={() => handleQuickReview(req.id, false)}
                            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 cursor-pointer disabled:opacity-50"
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500">
                          Read-only
                        </span>
                      )}
                    </div>

                    {parsed.screenshotUrl && (
                      <div className="pt-1 border-t border-slate-800/80">
                        <PaymentProofThumbnail
                          screenshotUrl={parsed.screenshotUrl}
                          onClick={() => setPreviewRequestId(req.id)}
                          size="sm"
                          label="View Deposit Proof"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Widget 2: Live Activity Feed (Supabase Realtime) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Live Activity Feed</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Supabase Realtime stream of trades &amp; requests
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-80">
            {liveEvents.length === 0 ? (
              <div className="space-y-2">
                {(data?.trades || []).slice(0, 6).map((t) => (
                  <div
                    key={t.id}
                    className="p-2.5 rounded-lg border border-slate-800/70 bg-[#070B12] text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-slate-200">
                        {t.symbol} · {t.direction}
                      </span>
                      <span className="font-mono text-indigo-300 tabular-nums">
                        {formatMoney(t.stake, {
                          tradeDisplayCurrency: t.display_currency,
                          tradeFxRateUsed: t.fx_rate_used,
                        })}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
                      <span>Status: {t.status}</span>
                      <span>{new Date(t.opened_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              liveEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-indigo-300">
                      {ev.type}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-slate-200 mt-1 font-mono text-[11px]">
                    {ev.summary}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Widget 3: Recent Admin Actions */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Recent Admin Actions</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Latest logged security &amp; operational events
              </p>
            </div>
            {data?.session?.role === 'SUPERADMIN' && (
              <Link
                href="/admin/audit-log"
                className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
              >
                <span>Audit Log</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-80">
            {(data?.auditLogs || []).length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500">
                No recent admin audit events recorded.
              </div>
            ) : (
              (data?.auditLogs || []).slice(0, 8).map((log) => (
                <div
                  key={log.id}
                  className="p-2.5 rounded-lg border border-slate-800 bg-[#070B12] text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        log.action.includes('FAILED')
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-indigo-500/15 text-indigo-300'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 truncate">
                    {log.admin_email || 'System'} · IP: {log.ip_address || '127.0.0.1'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <PaymentProofModal
        request={
          previewRequestId
            ? (data?.walletRequests || []).find(
                (r) => r.id === previewRequestId
              ) || null
            : null
        }
        onClose={() => setPreviewRequestId(null)}
        formatMoney={formatMoney}
        canReview={canMutateRequests}
        busy={actionBusyId === previewRequestId}
        onApprove={async (id) => {
          await handleQuickReview(id, true);
          setPreviewRequestId(null);
        }}
        onReject={async (id) => {
          await handleQuickReview(id, false);
          setPreviewRequestId(null);
        }}
      />
    </div>
  );
}
