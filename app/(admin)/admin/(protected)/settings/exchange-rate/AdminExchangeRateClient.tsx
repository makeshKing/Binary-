'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeftRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  History,
} from 'lucide-react';
import { ExchangeRateRow } from '@/lib/supabase/types';
import {
  calculateRatePercentChange,
  DEFAULT_USDT_NPR_RATE,
  formatExchangeRateLabel,
} from '@/lib/currency';
import { useCurrency } from '@/components/CurrencyProvider';

interface ExchangeRatePayload {
  session: {
    userId: string;
    email: string;
    displayName: string;
    role: 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
  };
  currentRate: ExchangeRateRow;
  rateHistory: ExchangeRateRow[];
}

export default function AdminExchangeRatePage() {
  const { refreshRate } = useCurrency();

  const [data, setData] = useState<ExchangeRatePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [newRateInput, setNewRateInput] = useState<string>('');
  const [reasonInput, setReasonInput] = useState<string>('');
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [superadminOverrideChecked, setSuperadminOverrideChecked] =
    useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=exchange-rates', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = (await res.json()) as ExchangeRatePayload;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  const currentRateValue = Number(
    data?.currentRate?.rate ?? DEFAULT_USDT_NPR_RATE
  );
  const role = data?.session?.role || 'SUPPORT';
  const canEdit = role === 'ADMIN' || role === 'SUPERADMIN';
  const isSuperAdmin = role === 'SUPERADMIN';

  const parsedNewRate = Number(newRateInput);
  const isRateValid =
    newRateInput.trim() !== '' &&
    Number.isFinite(parsedNewRate) &&
    parsedNewRate >= 1 &&
    parsedNewRate <= 1000;

  const rateChangePreview = useMemo(() => {
    if (!isRateValid) return null;
    return calculateRatePercentChange(currentRateValue, parsedNewRate);
  }, [currentRateValue, isRateValid, parsedNewRate]);

  const handleOpenConfirmModal = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!canEdit) {
      setFeedback({
        type: 'err',
        text: 'Only ADMIN or SUPERADMIN roles can update the exchange rate.',
      });
      return;
    }

    if (!isRateValid) {
      setFeedback({
        type: 'err',
        text: 'Please enter a valid exchange rate between 1.00 and 1000.00.',
      });
      return;
    }

    if (reasonInput.trim().length < 3) {
      setFeedback({
        type: 'err',
        text: 'Please enter a clear reason (at least 3 characters) for the audit log.',
      });
      return;
    }

    setSuperadminOverrideChecked(false);
    setConfirmModalOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!isRateValid || !rateChangePreview) return;

    if (rateChangePreview.exceedsTwentyPercent && !isSuperAdmin) {
      setFeedback({
        type: 'err',
        text: 'Rate change exceeds 20%. Only a SUPERADMIN can approve a rate change larger than 20%.',
      });
      setConfirmModalOpen(false);
      return;
    }

    if (
      rateChangePreview.exceedsTwentyPercent &&
      isSuperAdmin &&
      !superadminOverrideChecked
    ) {
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_exchange_rate',
          rate: Number(parsedNewRate.toFixed(4)),
          reason: reasonInput.trim(),
          superadminConfirm:
            rateChangePreview.exceedsTwentyPercent &&
            isSuperAdmin &&
            superadminOverrideChecked,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'err',
          text: json.error || 'Failed to update exchange rate.',
        });
        setConfirmModalOpen(false);
      } else {
        setFeedback({
          type: 'ok',
          text: `Exchange rate updated from Rs ${currentRateValue.toFixed(
            2
          )} to Rs ${Number(parsedNewRate).toFixed(2)} (${
            rateChangePreview.formattedPercent
          }). All open sessions have been notified in real time.`,
        });
        setConfirmModalOpen(false);
        setNewRateInput('');
        setReasonInput('');
        await Promise.all([fetchRates(), refreshRate()]);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error.',
      });
      setConfirmModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const chartPoints = useMemo(() => {
    const history = [...(data?.rateHistory || [])].reverse();
    if (history.length === 0) return [];
    const rates = history.map((h) => Number(h.rate));
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const span = Math.max(1, maxRate - minRate);

    return history.map((item, idx) => {
      const xPct =
        history.length === 1 ? 50 : (idx / (history.length - 1)) * 100;
      const yPct = 85 - ((Number(item.rate) - minRate) / span) * 70;
      return {
        ...item,
        xPct,
        yPct,
      };
    });
  }, [data?.rateHistory]);

  return (
    <div className="space-y-6">
      {/* Confirmation Modal */}
      {confirmModalOpen && rateChangePreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-indigo-500/40 bg-[#0D131F] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {rateChangePreview.exceedsTwentyPercent ? (
                <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0" />
              ) : (
                <ArrowLeftRight className="w-6 h-6 text-indigo-400 shrink-0" />
              )}
              <div>
                <h3 className="text-base font-bold text-white">
                  Confirm Exchange Rate Update
                </h3>
                <p className="text-xs text-slate-400">
                  Append-only rate update with live broadcast to all connected clients
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-[#070B12] border border-slate-800 p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Currency Pair</span>
                <span className="font-mono font-bold text-white">
                  USDT / NPR
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Current Rate (Before)</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  1 USDT = Rs {currentRateValue.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">New Rate (After)</span>
                <span className="font-mono font-bold text-emerald-300 tabular-nums">
                  1 USDT = Rs {parsedNewRate.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <span className="text-slate-300 font-semibold">
                  Percentage Change
                </span>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded tabular-nums ${
                    rateChangePreview.exceedsTwentyPercent
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : rateChangePreview.percentChange >= 0
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {rateChangePreview.formattedPercent}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-400 block mb-0.5">Audit Reason:</span>
                <span className="text-slate-200">{reasonInput.trim()}</span>
              </div>
            </div>

            {rateChangePreview.exceedsTwentyPercent && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2 text-xs">
                <div className="flex items-start gap-2 text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">
                      Large Rate Movement (&gt;20% Threshold)
                    </div>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      This change is {rateChangePreview.formattedPercent} from
                      the current rate. Changes larger than 20% are blocked for
                      standard ADMIN accounts and require explicit SUPERADMIN
                      confirmation.
                    </p>
                  </div>
                </div>

                {isSuperAdmin ? (
                  <label className="flex items-center gap-2 pt-2 border-t border-amber-500/20 cursor-pointer text-amber-100 font-medium">
                    <input
                      type="checkbox"
                      checked={superadminOverrideChecked}
                      onChange={(e) =>
                        setSuperadminOverrideChecked(e.target.checked)
                      }
                      className="rounded border-amber-500/50 bg-slate-950 text-amber-500"
                    />
                    <span>
                      I confirm this &gt;20% rate change as SUPERADMIN
                    </span>
                  </label>
                ) : (
                  <div className="pt-1 text-[11px] font-semibold text-rose-300">
                    Your current role ({role}) cannot apply a &gt;20% change.
                    Please contact a SUPERADMIN.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  submitting ||
                  (rateChangePreview.exceedsTwentyPercent && !isSuperAdmin) ||
                  (rateChangePreview.exceedsTwentyPercent &&
                    isSuperAdmin &&
                    !superadminOverrideChecked)
                }
                onClick={handleConfirmSubmit}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Applying Rate...' : 'Confirm & Broadcast Rate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ArrowLeftRight className="w-6 h-6 text-indigo-400" />
            <span>USDT / NPR Exchange Rate</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage the display and entry conversion rate. All database balances
            and settlements remain stored in base USDT.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchRates}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0B101B] border border-slate-800 text-xs font-medium text-slate-300 hover:text-white cursor-pointer self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
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

      {/* Top Row: Current Active Rate Card + Set New Rate Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Current Active Rate Card */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-400 font-semibold">
                Active Conversion Rate
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono font-semibold text-emerald-300">
                LIVE REALTIME
              </span>
            </div>

            <div className="text-3xl font-bold font-mono text-white tracking-tight tabular-nums">
              {formatExchangeRateLabel(currentRateValue)}
            </div>

            <p className="text-xs text-slate-400 mt-2">
              {data?.currentRate?.reason ||
                'Initial default exchange rate (1 USDT = Rs 134.50)'}
            </p>
          </div>

          <div className="pt-4 border-t border-slate-800/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Last Updated</span>
              </span>
              <span className="font-mono text-slate-200">
                {data?.currentRate?.created_at
                  ? new Date(data.currentRate.created_at).toLocaleString()
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 inline-flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                <span>Set By</span>
              </span>
              <span className="font-mono text-indigo-300">
                {data?.currentRate?.set_by_name || 'System Default'}{' '}
                {data?.currentRate?.set_by_email
                  ? `(${data.currentRate.set_by_email})`
                  : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Base Source of Truth</span>
              <span className="font-mono text-emerald-300 font-semibold">
                USDT ($ · 2 decimals)
              </span>
            </div>
          </div>
        </div>

        {/* Set New Exchange Rate Form */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800/80 bg-[#0B101B] p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-white">
              Set New USDT → NPR Rate
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              Allowed bounds: 1.00 – 1,000.00
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-5">
            Every update inserts a new immutable row in{' '}
            <code className="text-slate-300">exchange_rates</code> and writes a
            before/after entry to{' '}
            <code className="text-slate-300">admin_audit_log</code>. Changes over
            20% require SUPERADMIN confirmation.
          </p>

          {canEdit ? (
            <form onSubmit={handleOpenConfirmModal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    New NPR Rate per 1 USDT *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      Rs
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      max="1000"
                      required
                      value={newRateInput}
                      onChange={(e) => setNewRateInput(e.target.value)}
                      placeholder={currentRateValue.toFixed(2)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#070B12] border border-slate-800 focus:border-indigo-500 focus:outline-none text-sm font-mono text-white tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Projected Change vs Current
                  </label>
                  <div className="h-[42px] px-3.5 rounded-lg bg-[#070B12] border border-slate-800 flex items-center justify-between text-xs font-mono">
                    {rateChangePreview ? (
                      <>
                        <span className="text-slate-400">
                          Rs {currentRateValue.toFixed(2)} → Rs{' '}
                          {parsedNewRate.toFixed(2)}
                        </span>
                        <span
                          className={`font-bold px-2 py-0.5 rounded ${
                            rateChangePreview.exceedsTwentyPercent
                              ? 'bg-amber-500/20 text-amber-300'
                              : rateChangePreview.percentChange >= 0
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {rateChangePreview.formattedPercent}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-500">
                        Enter a rate (1 – 1000) to preview % delta
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Reason for Rate Update (Required) *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={240}
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder="e.g., Daily NRB / USDT market reference rate adjustment"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#070B12] border border-slate-800 focus:border-indigo-500 focus:outline-none text-xs text-white"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-slate-400">
                  Historical trades settled in NPR retain their snapshot{' '}
                  <code className="text-slate-300">fx_rate_used</code>.
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  Review &amp; Confirm Rate
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-lg border border-slate-800 bg-[#070B12] p-6 text-center text-xs text-slate-400">
              SUPPORT role is read-only. Updating the USDT/NPR exchange rate
              requires ADMIN or SUPERADMIN privileges.
            </div>
          )}
        </div>
      </div>

      {/* Rate History Visual Chart */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              <span>Exchange Rate History Chart (USDT → NPR)</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Append-only progression of the active conversion rate over time
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {chartPoints.length} data point(s)
          </span>
        </div>

        {chartPoints.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-slate-500">
            No rate history points available.
          </div>
        ) : (
          <div className="relative h-44 w-full rounded-lg bg-[#070B12] border border-slate-800/80 p-4 overflow-hidden">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="w-full h-full overflow-visible"
            >
              {chartPoints.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  points={chartPoints
                    .map((p) => `${p.xPct},${p.yPct}`)
                    .join(' ')}
                />
              )}
              {chartPoints.map((p) => (
                <circle
                  key={p.id}
                  cx={p.xPct}
                  cy={p.yPct}
                  r="1.8"
                  className="fill-emerald-400 stroke-slate-950"
                  strokeWidth="0.6"
                />
              ))}
            </svg>
            <div className="absolute bottom-2 left-4 right-4 flex justify-between text-[10px] font-mono text-slate-500">
              <span>
                {new Date(chartPoints[0].created_at).toLocaleDateString()} (Rs{' '}
                {Number(chartPoints[0].rate).toFixed(2)})
              </span>
              <span>
                Latest: Rs{' '}
                {Number(chartPoints[chartPoints.length - 1].rate).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rate History Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">
              Immutable Exchange Rate Log
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {(data?.rateHistory || []).length} record(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-900/40">
                <th className="py-3.5 px-4">ID</th>
                <th className="py-3.5 px-4">Pair</th>
                <th className="py-3.5 px-4 text-right">Rate (NPR per 1 USDT)</th>
                <th className="py-3.5 px-4">Set By</th>
                <th className="py-3.5 px-4">Reason</th>
                <th className="py-3.5 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {(data?.rateHistory || []).map((row, index) => (
                <tr key={row.id} className="hover:bg-slate-800/30">
                  <td className="py-3.5 px-4 font-mono text-slate-400">
                    #{row.id}
                    {index === 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-200">
                    {row.base} / {row.quote}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-white tabular-nums">
                    Rs {Number(row.rate).toFixed(4)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-slate-200">
                      {row.set_by_name || 'System Default'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {row.set_by_email || '—'}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300">
                    {row.reason || '—'}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
