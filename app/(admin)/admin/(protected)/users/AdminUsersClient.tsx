'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Users,
  ArrowRight,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Coins,
  Plus,
  Minus,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { ProfileRow, resolveUserNumber } from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';

type SortField = 'user_number' | 'balance' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function AdminUsersPage() {
  const { currency, rate, formatMoney } = useCurrency();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Inline Balance Adjustment Modal state
  const [adjustTarget, setAdjustTarget] = useState<ProfileRow | null>(null);
  const [adjustMode, setAdjustMode] = useState<'CREDIT' | 'DEBIT' | 'SET'>('CREDIT');
  const [inputCurrency, setInputCurrency] = useState<'USDT' | 'NPR'>('USDT');
  const [adjustAmount, setAdjustAmount] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjustBusy, setAdjustBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setInputCurrency(currency === 'NPR' ? 'NPR' : 'USDT');
  }, [currency]);

  // Initialize from ?q= URL parameter if navigated from top bar search
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qParam = params.get('q');
      if (qParam) {
        setSearchQuery(qParam);
        setDebouncedQuery(qParam);
      }
    }
  }, []);

  // Debounce search input (250ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/admin/actions?view=search-users&q=${encodeURIComponent(
        debouncedQuery
      )}&role=${encodeURIComponent(roleFilter)}&status=${encodeURIComponent(
        statusFilter
      )}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setProfiles(json.users || []);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const openAdjustModal = (user: ProfileRow) => {
    setAdjustTarget(user);
    setAdjustMode('CREDIT');
    setInputCurrency(currency === 'NPR' ? 'NPR' : 'USDT');
    setAdjustAmount('');
    setAdjustReason('');
  };

  const effectiveRate = Number(rate) > 0 ? Number(rate) : 134.5;
  const targetCurrentBalance = Number(adjustTarget?.balance || 0);
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
      : Number((baseInputAmt - targetCurrentBalance).toFixed(2));

  const projectedBalance =
    adjustMode === 'SET'
      ? baseInputAmt
      : Number((targetCurrentBalance + computedDelta).toFixed(2));

  const handleApplyBalanceAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
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
        )}) would be negative.`,
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

    setAdjustBusy(true);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_balance',
          targetUserId: adjustTarget.id,
          delta: computedDelta,
          exactBalance: adjustMode === 'SET' ? projectedBalance : undefined,
          note: cleanNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'err',
          text: json.error || 'Failed to adjust user balance.',
        });
      } else {
        const updatedBal = Number(json.newBalance ?? projectedBalance);
        const uNum = resolveUserNumber(adjustTarget.user_number, adjustTarget.id);
        setProfiles((prev) =>
          prev.map((row) =>
            row.id === adjustTarget.id ? { ...row, balance: updatedBal } : row
          )
        );
        setFeedback({
          type: 'ok',
          text: `Updated balance for ${
            adjustTarget.display_name || adjustTarget.name || 'Trader'
          } (ID: ${uNum}) to ${formatMoney(updatedBal)} ($${updatedBal.toFixed(
            2
          )} USDT).`,
        });
        setAdjustTarget(null);
        setAdjustAmount('');
        setAdjustReason('');
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error adjusting balance.',
      });
    } finally {
      setAdjustBusy(false);
    }
  };

  const sortedProfiles = useMemo(() => {
    const exactFiveDigit = /^\d{5}$/.test(debouncedQuery)
      ? Number(debouncedQuery)
      : null;

    return [...profiles].sort((a, b) => {
      const aNum = resolveUserNumber(a.user_number, a.id);
      const bNum = resolveUserNumber(b.user_number, b.id);

      // If searching by exact 5-digit number, prioritize exact User ID match first
      if (exactFiveDigit !== null) {
        const aExact = aNum === exactFiveDigit ? 0 : 1;
        const bExact = bNum === exactFiveDigit ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
      }

      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'user_number') {
        return (aNum - bNum) * mul;
      }
      if (sortField === 'balance') {
        return (Number(a.balance || 0) - Number(b.balance || 0)) * mul;
      }
      return (
        (new Date(a.created_at || 0).getTime() -
          new Date(b.created_at || 0).getTime()) *
        mul
      );
    });
  }, [profiles, debouncedQuery, sortField, sortDir]);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-indigo-400" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Inline Balance Adjustment Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B101B] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Adjust User Balance
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    {adjustTarget.display_name || adjustTarget.name || 'Trader'} · ID:{' '}
                    <span className="text-indigo-300 font-bold">
                      {resolveUserNumber(adjustTarget.user_number, adjustTarget.id)}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-[#070B12] border border-slate-800 p-3 flex items-center justify-between text-xs">
              <span className="text-slate-400">Current Live Balance</span>
              <div className="text-right font-mono">
                <div className="font-bold text-emerald-300">
                  {formatMoney(targetCurrentBalance)}
                </div>
                <div className="text-[10px] text-slate-500">
                  Base: ${targetCurrentBalance.toFixed(2)} USDT
                </div>
              </div>
            </div>

            <form onSubmit={handleApplyBalanceAdjustment} className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">
                  Adjustment Mode
                </span>
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
                <label className="block text-xs text-slate-300 mb-1">
                  {adjustMode === 'SET'
                    ? `New Balance (${inputCurrency === 'NPR' ? 'NPR Rs' : 'USDT $'})`
                    : `Amount (${inputCurrency === 'NPR' ? 'NPR Rs' : 'USDT $'})`}
                </label>
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
                  <div className="mt-2 rounded-lg bg-[#070B12] border border-slate-800 p-2.5 text-[11px] font-mono space-y-1">
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
                    <div className="flex justify-between text-slate-200 border-t border-slate-800 pt-1">
                      <span>New Balance After:</span>
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
                  Reason / Audit Note (optional)
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

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjustBusy}
                  className={`px-4 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-50 ${
                    adjustMode === 'CREDIT'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : adjustMode === 'DEBIT'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {adjustBusy
                    ? 'Updating...'
                    : adjustMode === 'CREDIT'
                    ? 'Apply Credit'
                    : adjustMode === 'DEBIT'
                    ? 'Apply Debit'
                    : 'Set Balance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Users className="w-6 h-6 text-indigo-400" />
            <span>Users Directory</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Server-side search by 5-digit User ID, email, display name, or UUID.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchUsers}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0B101B] border border-slate-800 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 text-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#0B101B] border border-slate-800/80 rounded-xl p-4">
        <div className="sm:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by 5-digit User ID (e.g. 48213), email, name, or UUID..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Roles</option>
            <option value="USER">USER</option>
            <option value="SUPPORT">SUPPORT</option>
            <option value="ADMIN">ADMIN</option>
            <option value="SUPERADMIN">SUPERADMIN</option>
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="DISABLED">DISABLED</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-900/40">
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('user_number')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>User ID</span>
                    {renderSortIcon('user_number')}
                  </button>
                </th>
                <th className="py-3.5 px-4">User</th>
                <th className="py-3.5 px-4">Role</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Country</th>
                <th className="py-3.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('balance')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-white cursor-pointer ml-auto"
                  >
                    <span>Live Balance</span>
                    {renderSortIcon('balance')}
                  </button>
                </th>
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('created_at')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>Created</span>
                    {renderSortIcon('created_at')}
                  </button>
                </th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {loading && profiles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Loading user profiles...
                  </td>
                </tr>
              ) : sortedProfiles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No matching user profiles found.
                  </td>
                </tr>
              ) : (
                sortedProfiles.map((p) => {
                  const role = p.role || (p.is_admin ? 'ADMIN' : 'USER');
                  const status = p.status || 'ACTIVE';
                  const uNum = resolveUserNumber(p.user_number, p.id);
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${p.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 font-mono font-bold text-indigo-300 text-xs transition-colors"
                          title={`Inspect User ID ${uNum}`}
                        >
                          <span>{uNum}</span>
                        </Link>
                      </td>
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${p.id}`}
                          className="font-semibold text-white hover:text-indigo-300 transition-colors"
                        >
                          {p.display_name || p.name || 'Trader'}
                        </Link>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {p.email || p.id}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                            role === 'SUPERADMIN'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : role === 'ADMIN'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : role === 'SUPPORT'
                              ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {role}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${
                            status === 'ACTIVE'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : status === 'SUSPENDED'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {p.country || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-white tabular-nums">
                        <div>{formatMoney(p.balance || 0)}</div>
                        <div className="text-[10px] text-slate-500">
                          ${Number(p.balance || 0).toFixed(2)} USDT
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openAdjustModal(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium cursor-pointer"
                            title="Adjust user balance"
                          >
                            <Coins className="w-3.5 h-3.5" />
                            <span>Adjust Balance</span>
                          </button>
                          <Link
                            href={`/admin/users/${p.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
