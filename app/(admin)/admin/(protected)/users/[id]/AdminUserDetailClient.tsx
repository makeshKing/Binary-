'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Coins,
  Shield,
  Activity,
  ScrollText,
  WalletCards,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  AlertTriangle,
  Plus,
  Minus,
} from 'lucide-react';
import {
  ProfileRow,
  TradeRow,
  WalletRequestRow,
  BalanceLedgerRow,
  AdminRole,
  UserStatus,
  resolveUserNumber,
} from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';
import { parsePaymentProofFromNote } from '@/lib/payment-details';
import {
  PaymentProofModal,
  PaymentProofThumbnail,
} from '@/components/admin/PaymentProofModal';

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;
  const { currency, rate, formatMoney } = useCurrency();

  const [sessionRole, setSessionRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('ADMIN');
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [requests, setRequests] = useState<WalletRequestRow[]>([]);
  const [ledger, setLedger] = useState<BalanceLedgerRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  const [adjustMode, setAdjustMode] = useState<'CREDIT' | 'DEBIT' | 'SET'>('CREDIT');
  const [inputCurrency, setInputCurrency] = useState<'USDT' | 'NPR'>('USDT');
  const [adjustAmount, setAdjustAmount] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [confirmDialogOpen, setConfirmDialogOpen] = useState<boolean>(false);

  const [selectedStatus, setSelectedStatus] = useState<UserStatus>('ACTIVE');
  const [selectedRole, setSelectedRole] = useState<AdminRole>('USER');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);

  useEffect(() => {
    setInputCurrency(currency === 'NPR' ? 'NPR' : 'USDT');
  }, [currency]);

  const loadUserDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [detailRes, dashRes] = await Promise.all([
        fetch(`/api/admin/actions?view=user-detail&userId=${encodeURIComponent(userId)}`, {
          cache: 'no-store',
        }),
        fetch('/api/admin/actions?view=dashboard&days=7', { cache: 'no-store' }),
      ]);

      if (dashRes.ok) {
        const dashJson = await dashRes.json();
        if (dashJson.session?.role) {
          setSessionRole(dashJson.session.role);
        }
      }

      if (detailRes.ok) {
        const json = await detailRes.json();
        setProfile(json.profile || null);
        setTrades(json.trades || []);
        setRequests(json.requests || []);
        setLedger(json.ledger || []);
        if (json.profile) {
          setSelectedStatus((json.profile.status as UserStatus) || 'ACTIVE');
          setSelectedRole(
            (json.profile.role as AdminRole) ||
              (json.profile.is_admin ? 'ADMIN' : 'USER')
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadUserDetail();
  }, [loadUserDetail]);

  const canMutateAdmin = sessionRole === 'ADMIN' || sessionRole === 'SUPERADMIN';
  const isSuperAdmin = sessionRole === 'SUPERADMIN';

  const userNumber = profile
    ? resolveUserNumber(profile.user_number, profile.id)
    : 48213;

  const handleCopyUserNumber = async () => {
    try {
      await navigator.clipboard.writeText(String(userNumber));
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  const effectiveRate = Number(rate) > 0 ? Number(rate) : 134.5;
  const currentBalance = Number(profile?.balance || 0);
  const rawInputVal = Number(adjustAmount);
  const hasValidNumber =
    adjustAmount.trim() !== '' &&
    Number.isFinite(rawInputVal) &&
    (adjustMode === 'SET' ? rawInputVal >= 0 : rawInputVal > 0);

  const baseInputAmt = hasValidNumber
    ? Number(
        (inputCurrency === 'NPR' ? rawInputVal / effectiveRate : rawInputVal).toFixed(2)
      )
    : 0;

  const computedDelta =
    adjustMode === 'CREDIT'
      ? baseInputAmt
      : adjustMode === 'DEBIT'
      ? -baseInputAmt
      : Number((baseInputAmt - currentBalance).toFixed(2));

  const projectedBalance =
    adjustMode === 'SET'
      ? baseInputAmt
      : Number((currentBalance + computedDelta).toFixed(2));

  const executeBalanceAdjustment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) return;
    setFeedback(null);

    if (!hasValidNumber) {
      setFeedback({
        type: 'err',
        text:
          adjustMode === 'SET'
            ? 'Please enter a valid target balance (0 or greater).'
            : 'Please enter a positive credit/debit amount greater than 0.',
      });
      return;
    }

    if (adjustMode !== 'SET' && baseInputAmt <= 0) {
      setFeedback({
        type: 'err',
        text: 'Converted base USDT amount must be at least $0.01.',
      });
      return;
    }

    if (projectedBalance < 0) {
      setFeedback({
        type: 'err',
        text: `Cannot debit $${baseInputAmt.toFixed(
          2
        )}: resulting balance ($${projectedBalance.toFixed(
          2
        )}) would be negative. Current balance is $${currentBalance.toFixed(2)}.`,
      });
      return;
    }

    if (adjustMode === 'SET' && Math.abs(computedDelta) < 0.01) {
      setFeedback({
        type: 'err',
        text: `User balance is already $${currentBalance.toFixed(2)} USDT.`,
      });
      return;
    }

    const cleanNote =
      adjustReason.trim().length >= 3
        ? adjustReason.trim()
        : adjustMode === 'CREDIT'
        ? 'Manual admin credit adjustment'
        : adjustMode === 'DEBIT'
        ? 'Manual admin debit adjustment'
        : 'Manual admin exact balance adjustment';

    setConfirmDialogOpen(false);
    setBusy(true);

    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_balance',
          targetUserId: profile.id,
          delta: computedDelta,
          exactBalance: adjustMode === 'SET' ? projectedBalance : undefined,
          note: cleanNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to adjust balance.' });
      } else {
        const updatedBal = Number(json.newBalance ?? projectedBalance);
        setProfile((prev) => (prev ? { ...prev, balance: updatedBal } : prev));
        setFeedback({
          type: 'ok',
          text:
            adjustMode === 'SET'
              ? `Balance set to ${formatMoney(updatedBal)} ($${updatedBal.toFixed(2)} USDT).`
              : `Balance ${
                  computedDelta >= 0 ? 'credited' : 'debited'
                } by ${formatMoney(Math.abs(computedDelta))} ($${Math.abs(
                  computedDelta
                ).toFixed(2)} USDT). New balance: ${formatMoney(updatedBal)} ($${updatedBal.toFixed(2)} USDT).`,
        });
        setAdjustAmount('');
        setAdjustReason('');
        await loadUserDetail();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error adjusting balance.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRoleOrStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_user_status_or_role',
          targetUserId: profile.id,
          newStatus: selectedStatus,
          newRole: isSuperAdmin ? selectedRole : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to update account.' });
      } else {
        setFeedback({ type: 'ok', text: 'Account status / role updated.' });
        await loadUserDetail();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        Loading user inspector...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Users</span>
        </Link>
        <div className="rounded-xl border border-slate-800 bg-[#0B101B] p-8 text-center text-sm text-slate-400">
          User profile not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Confirmation Dialog Modal for Manual Credit / Debit / Set */}
      {confirmDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-indigo-500/40 bg-[#0D131F] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">
                Confirm Manual{' '}
                {adjustMode === 'CREDIT'
                  ? 'Credit'
                  : adjustMode === 'DEBIT'
                  ? 'Debit'
                  : 'Balance Override'}
              </h3>
            </div>

            <div className="rounded-lg bg-[#070B12] border border-slate-800 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Trader</span>
                <span className="font-semibold text-white">
                  {profile.display_name || 'Trader'} (User ID: {userNumber})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Current Balance</span>
                <span className="font-mono text-slate-200">
                  {formatMoney(currentBalance)} (${currentBalance.toFixed(2)} USDT)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Net Adjustment</span>
                <span
                  className={`font-mono font-bold ${
                    computedDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {computedDelta >= 0 ? '+' : '-'}${Math.abs(computedDelta).toFixed(2)} USDT
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800">
                <span className="text-slate-300 font-semibold">New Balance After</span>
                <span className="font-mono font-bold text-white">
                  {formatMoney(projectedBalance)} (${projectedBalance.toFixed(2)} USDT)
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-400 block mb-0.5">Audit Reason:</span>
                <span className="text-slate-200">
                  {adjustReason.trim() || 'Manual admin balance adjustment'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              This action updates the user&apos;s live balance, writes an immutable ledger entry, and logs to <code className="text-slate-300">admin_audit_log</code>.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDialogOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeBalanceAdjustment()}
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white cursor-pointer ${
                  computedDelta >= 0
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                Confirm Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header with Prominent 5-Digit User ID */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0B101B] border border-slate-800/80 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Users Directory</span>
          </Link>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30">
            <span className="text-xs font-mono font-bold text-white">
              User ID: <span className="text-indigo-300">{userNumber}</span>
            </span>
            <button
              type="button"
              onClick={handleCopyUserNumber}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-mono text-slate-200 cursor-pointer"
            >
              {copiedId ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <span className="text-xs font-mono text-slate-500">
          Live Account Inspector
        </span>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-3.5 flex items-center gap-3 text-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Profile Summary & Admin Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Profile Overview */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                {profile.display_name || profile.name || 'Trader'}
              </h1>
              <div className="text-xs font-mono text-slate-400">
                {profile.email || profile.id}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">5-Digit User ID</span>
              <span className="font-mono font-bold text-indigo-300 text-sm">
                {userNumber}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Primary Key (UUID)</span>
              <span className="font-mono text-[11px] text-slate-400 truncate max-w-[180px]" title={profile.id}>
                {profile.id}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-slate-400">Live Balance</span>
              <div className="text-right font-mono">
                <div className="font-bold text-emerald-300 tabular-nums">
                  {formatMoney(profile.balance || 0)}
                </div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  Base: ${Number(profile.balance || 0).toFixed(2)} USDT
                </div>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Preferred Currency</span>
              <span className="font-mono text-indigo-300 font-semibold">
                {profile.preferred_currency || 'USDT'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Role</span>
              <span className="font-mono text-indigo-300">
                {profile.role || (profile.is_admin ? 'ADMIN' : 'USER')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status</span>
              <span className="font-mono text-white">
                {profile.status || 'ACTIVE'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Country</span>
              <span className="text-slate-200">{profile.country || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Joined</span>
              <span className="font-mono text-slate-300">
                {new Date(profile.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Manual Credit / Debit / Set Exact Balance */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>Adjust User Balance</span>
            </div>
            <div className="inline-flex rounded-md bg-[#070B12] border border-slate-800 p-0.5 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => setInputCurrency('USDT')}
                className={`px-2 py-0.5 rounded cursor-pointer font-bold ${
                  inputCurrency === 'USDT'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                USDT ($)
              </button>
              <button
                type="button"
                onClick={() => setInputCurrency('NPR')}
                className={`px-2 py-0.5 rounded cursor-pointer font-bold ${
                  inputCurrency === 'NPR'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                NPR (Rs)
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">
            Credit, debit, or set exact balance in USDT ($) or NPR (Rs).
          </p>

          {canMutateAdmin ? (
            <form onSubmit={executeBalanceAdjustment} className="space-y-3">
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#070B12] border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdjustMode('CREDIT')}
                  className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                    adjustMode === 'CREDIT'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Credit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustMode('DEBIT')}
                  className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                    adjustMode === 'DEBIT'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Minus className="w-3.5 h-3.5" />
                  <span>Debit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustMode('SET')}
                  className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                    adjustMode === 'SET'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>= Set Exact</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-slate-300">
                    {adjustMode === 'SET'
                      ? `New Target Balance (${inputCurrency === 'NPR' ? 'NPR Rs' : 'USDT $'})`
                      : `Amount (${inputCurrency === 'NPR' ? 'NPR Rs' : 'USDT $'})`}
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    Current: {formatMoney(currentBalance)}
                  </span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min={adjustMode === 'SET' ? '0' : '0.01'}
                  required
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder={inputCurrency === 'NPR' ? '5000' : '100.00'}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                />

                {/* Quick Amount Presets */}
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {(inputCurrency === 'NPR'
                    ? [1000, 5000, 10000, 50000]
                    : [50, 100, 500, 1000]
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAdjustAmount(String(preset))}
                      className="py-1 px-1.5 rounded bg-[#070B12] hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                    >
                      {adjustMode === 'CREDIT'
                        ? '+'
                        : adjustMode === 'DEBIT'
                        ? '-'
                        : ''}
                      {inputCurrency === 'NPR' ? `Rs ${preset}` : `$${preset}`}
                    </button>
                  ))}
                </div>

                {hasValidNumber && (
                  <div className="mt-2 rounded-lg bg-[#070B12] border border-slate-800/90 p-2.5 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Delta (Base USDT):</span>
                      <span
                        className={`font-bold ${
                          computedDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {computedDelta >= 0 ? '+' : '-'}$
                        {Math.abs(computedDelta).toFixed(2)} USDT
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-200 border-t border-slate-800/80 pt-1">
                      <span>Projected Balance:</span>
                      <span
                        className={`font-bold ${
                          projectedBalance < 0 ? 'text-rose-400' : 'text-white'
                        }`}
                      >
                        {formatMoney(projectedBalance)} ($
                        {projectedBalance.toFixed(2)} USDT)
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Audit Note / Reason (optional)
                </label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Manual admin balance adjustment"
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[
                    'Manual Deposit Credit',
                    'Bonus Credit',
                    'Balance Correction',
                    'Manual Withdrawal',
                  ].map((reasonPreset) => (
                    <button
                      key={reasonPreset}
                      type="button"
                      onClick={() => setAdjustReason(reasonPreset)}
                      className="px-2 py-0.5 rounded bg-[#070B12] hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      {reasonPreset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className={`flex-1 py-2.5 px-4 rounded-lg text-white text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors ${
                    adjustMode === 'CREDIT'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : adjustMode === 'DEBIT'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {busy
                    ? 'Updating Balance...'
                    : adjustMode === 'CREDIT'
                    ? 'Apply Credit Now'
                    : adjustMode === 'DEBIT'
                    ? 'Apply Debit Now'
                    : 'Set Balance Now'}
                </button>
              </div>
            </form>
          ) : (
            <div className="h-36 rounded-lg border border-slate-800 bg-[#070B12] p-4 flex items-center justify-center text-center text-xs text-slate-500">
              SUPPORT role is read-only. Balance adjustments require ADMIN or SUPERADMIN privileges.
            </div>
          )}
        </div>

        {/* Card 3: Status & Role Governance */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
            <Shield className="w-4 h-4 text-indigo-400" />
            <span>Status &amp; Role Control</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-4">
            Suspend/activate account or update access role (SUPERADMIN only).
          </p>

          {canMutateAdmin ? (
            <form onSubmit={handleUpdateRoleOrStatus} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Account Status
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value as UserStatus)}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Platform Role {!isSuperAdmin && '(SUPERADMIN required)'}
                </label>
                <select
                  value={selectedRole}
                  disabled={!isSuperAdmin}
                  onChange={(e) => setSelectedRole(e.target.value as AdminRole)}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white disabled:opacity-50"
                >
                  <option value="USER">USER</option>
                  <option value="SUPPORT">SUPPORT</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SUPERADMIN">SUPERADMIN</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Save Governance Settings
              </button>
            </form>
          ) : (
            <div className="h-36 rounded-lg border border-slate-800 bg-[#070B12] p-4 flex items-center justify-center text-center text-xs text-slate-500">
              SUPPORT role is read-only. Status and role changes require ADMIN or SUPERADMIN privileges.
            </div>
          )}
        </div>
      </div>

      {/* User Trades, Wallet Requests, and Balance Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Trades */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>User Trades ({trades.length})</span>
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center">
                No trades recorded for this user.
              </div>
            ) : (
              trades.map((t) => (
                <div
                  key={t.id}
                  className="p-2.5 rounded-lg border border-slate-800 bg-[#070B12] text-xs"
                >
                  <div className="flex justify-between font-mono">
                    <span className="font-semibold text-white">
                      {t.symbol} · {t.direction}
                    </span>
                    <div className="text-right tabular-nums">
                      <span className="text-indigo-300">
                        {formatMoney(t.stake, {
                          tradeDisplayCurrency: t.display_currency,
                          tradeFxRateUsed: t.fx_rate_used,
                        })}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Base: ${Number(t.stake).toFixed(2)} USDT
                        {t.display_currency === 'NPR' && t.fx_rate_used
                          ? ` @ Rs ${Number(t.fx_rate_used).toFixed(2)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>Status: {t.status}</span>
                    <span>{new Date(t.opened_at).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Wallet Requests (Always shows base USDT amount alongside converted display) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <WalletCards className="w-4 h-4 text-emerald-400" />
            <span>Wallet Requests ({requests.length})</span>
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {requests.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center">
                No wallet requests.
              </div>
            ) : (
              requests.map((r) => {
                const parsed = parsePaymentProofFromNote(r.note);
                return (
                  <div
                    key={r.id}
                    className="p-2.5 rounded-lg border border-slate-800 bg-[#070B12] text-xs space-y-2"
                  >
                    <div className="flex justify-between font-mono">
                      <div>
                        <span className="font-semibold text-white tabular-nums">
                          {r.type} · {formatMoney(r.amount)}
                        </span>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          Base: ${Number(r.amount).toFixed(2)} USDT
                        </div>
                      </div>
                      <span className="text-slate-300">{r.status}</span>
                    </div>
                    {parsed.screenshotUrl && (
                      <div>
                        <PaymentProofThumbnail
                          screenshotUrl={parsed.screenshotUrl}
                          onClick={() => setPreviewRequestId(r.id)}
                          size="sm"
                          label="View Payment Proof"
                        />
                      </div>
                    )}
                    {parsed.methodLabel && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-mono font-bold text-indigo-300">
                          {parsed.methodLabel}
                        </span>
                        {parsed.payoutAccountId && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300">
                            {parsed.methodCode === 'BANK_TRANSFER'
                              ? `A/C: ${parsed.payoutAccountId}`
                              : `ID: ${parsed.payoutAccountId}`}
                          </span>
                        )}
                      </div>
                    )}
                    {(parsed.userNote || (!parsed.methodLabel && !parsed.screenshotUrl && r.note)) && (
                      <div className="text-[11px] text-slate-400 truncate">
                        {parsed.userNote || r.note}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Balance Ledger (Always shows base USDT amount alongside converted display) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
            <ScrollText className="w-4 h-4 text-amber-400" />
            <span>Balance Ledger ({ledger.length})</span>
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {ledger.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center">
                No ledger entries recorded.
              </div>
            ) : (
              ledger.map((l) => {
                const deltaVal = Number(l.delta ?? l.amount ?? 0);
                return (
                  <div
                    key={l.id}
                    className="p-2.5 rounded-lg border border-slate-800 bg-[#070B12] text-xs"
                  >
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-200">
                        {l.entry_type || l.type}
                      </span>
                      <div className="text-right tabular-nums">
                        <span
                          className={
                            deltaVal >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          }
                        >
                          {formatMoney(deltaVal, { showPlusSign: true })}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          Base: {deltaVal >= 0 ? '+' : '-'}$
                          {Math.abs(deltaVal).toFixed(2)} USDT
                        </span>
                      </div>
                    </div>
                    {l.note && (
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {l.note}
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 tabular-nums">
                      <span>
                        After: {formatMoney(l.balance_after)} ($
                        {Number(l.balance_after).toFixed(2)} USDT)
                      </span>
                      <span>{new Date(l.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <PaymentProofModal
        request={
          previewRequestId
            ? requests.find((r) => r.id === previewRequestId) || null
            : null
        }
        onClose={() => setPreviewRequestId(null)}
        formatMoney={formatMoney}
      />
    </div>
  );
}
