'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react';
import { getSupabaseAdminBrowserClient } from '@/lib/supabase/admin-client';
import { resolveUserNumber, TradeRow } from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';

type SortField = 'user_number' | 'stake' | 'opened_at';
type SortDir = 'asc' | 'desc';

export default function AdminTradesPage() {
  const { formatMoney } = useCurrency();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('opened_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState<boolean>(true);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=dashboard&days=30', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setTrades(json.trades || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    const supabase = getSupabaseAdminBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel('admin-trades-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades' },
        () => {
          fetchTrades();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTrades]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

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

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const isExactFiveDigit = /^\d{5}$/.test(q);

    const rows = trades.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!q) return true;
      const uNum = resolveUserNumber(t.user_number, t.user_id);
      if (isExactFiveDigit && String(uNum) === q) return true;
      return (
        String(uNum).includes(q) ||
        (t.symbol || '').toLowerCase().includes(q) ||
        (t.user_email || '').toLowerCase().includes(q) ||
        (t.user_display_name || '').toLowerCase().includes(q) ||
        t.user_id.toLowerCase().includes(q)
      );
    });

    return rows.sort((a, b) => {
      const aNum = resolveUserNumber(a.user_number, a.user_id);
      const bNum = resolveUserNumber(b.user_number, b.user_id);

      if (isExactFiveDigit) {
        const aExact = String(aNum) === q ? 0 : 1;
        const bExact = String(bNum) === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
      }

      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'user_number') {
        return (aNum - bNum) * mul;
      }
      if (sortField === 'stake') {
        return (Number(a.stake) - Number(b.stake)) * mul;
      }
      return (
        (new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime()) *
        mul
      );
    });
  }, [trades, statusFilter, searchQuery, sortField, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-sky-400" />
            <span>Global Trades Monitor</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Live and settled binary option contracts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {['ALL', 'OPEN', 'WON', 'LOST', 'DRAW'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer ${
                statusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0B101B] border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchTrades}
            className="p-2 rounded-lg bg-[#0B101B] border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Search by User ID */}
      <div className="bg-[#0B101B] border border-slate-800/80 rounded-xl p-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter trades by 5-digit User ID, pair, email, or name..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

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
                <th className="py-3.5 px-4">Pair</th>
                <th className="py-3.5 px-4">Direction</th>
                <th className="py-3.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('stake')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-white cursor-pointer ml-auto"
                  >
                    <span>Stake</span>
                    {renderSortIcon('stake')}
                  </button>
                </th>
                <th className="py-3.5 px-4 text-right">Entry / Exit</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Payout</th>
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('opened_at')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>Opened</span>
                    {renderSortIcon('opened_at')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No trades matching {statusFilter}.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((t) => {
                  const uNum = resolveUserNumber(t.user_number, t.user_id);
                  return (
                    <tr key={t.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${t.user_id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 font-mono font-bold text-indigo-300 text-xs transition-colors"
                          title={`Inspect User ID ${uNum}`}
                        >
                          <span>{uNum}</span>
                        </Link>
                        {t.user_display_name && (
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {t.user_display_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-white">
                        {t.symbol}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                            t.direction === 'CALL' || (t.direction as string) === 'UP'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-white tabular-nums">
                        <div>
                          {formatMoney(t.stake, {
                            tradeDisplayCurrency: t.display_currency,
                            tradeFxRateUsed: t.fx_rate_used,
                          })}
                        </div>
                        {t.display_currency === 'NPR' && t.fx_rate_used && (
                          <div className="text-[10px] text-slate-500">
                            NPR @ Rs {Number(t.fx_rate_used).toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-300">
                        {Number(t.entry_price).toFixed(5)} /{' '}
                        {t.exit_price !== null
                          ? Number(t.exit_price).toFixed(5)
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${
                            t.status === 'WON'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : t.status === 'LOST'
                              ? 'bg-rose-500/15 text-rose-300'
                              : t.status === 'OPEN'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-emerald-300 tabular-nums">
                        {formatMoney(t.payout || 0, {
                          tradeDisplayCurrency: t.display_currency,
                          tradeFxRateUsed: t.fx_rate_used,
                        })}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {new Date(t.opened_at).toLocaleString()}
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
