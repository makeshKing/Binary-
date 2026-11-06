'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ScrollText,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react';
import { BalanceLedgerRow, resolveUserNumber } from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';

type SortField = 'user_number' | 'delta' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function AdminLedgerPage() {
  const { formatMoney } = useCurrency();
  const [ledger, setLedger] = useState<BalanceLedgerRow[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState<boolean>(true);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=dashboard&days=30', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        setLedger(json.ledger || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

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

    const rows = ledger.filter((row) => {
      const eType = row.entry_type || row.type || 'ADJUSTMENT';
      if (typeFilter !== 'ALL' && eType !== typeFilter) return false;
      if (!q) return true;
      const uNum = resolveUserNumber(row.user_number, row.user_id);
      if (isExactFiveDigit && String(uNum) === q) return true;
      return (
        String(uNum).includes(q) ||
        (row.user_email || '').toLowerCase().includes(q) ||
        (row.user_display_name || '').toLowerCase().includes(q) ||
        (row.note || '').toLowerCase().includes(q) ||
        row.user_id.toLowerCase().includes(q)
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
      if (sortField === 'delta') {
        return (
          (Number(a.delta ?? a.amount ?? 0) -
            Number(b.delta ?? b.amount ?? 0)) *
          mul
        );
      }
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        mul
      );
    });
  }, [ledger, typeFilter, searchQuery, sortField, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ScrollText className="w-6 h-6 text-amber-400" />
            <span>Global Balance Ledger</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Immutable ledger of all account balance movements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            'ALL',
            'DEPOSIT',
            'WITHDRAW',
            'TRADE_OPEN',
            'TRADE_PAYOUT',
            'ADJUSTMENT',
          ].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer ${
                typeFilter === t
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0B101B] border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchLedger}
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
            placeholder="Filter ledger by 5-digit User ID, email, name, or note..."
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
                <th className="py-3.5 px-4">Entry Type</th>
                <th className="py-3.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('delta')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-white cursor-pointer ml-auto"
                  >
                    <span>Delta</span>
                    {renderSortIcon('delta')}
                  </button>
                </th>
                <th className="py-3.5 px-4 text-right">Balance After</th>
                <th className="py-3.5 px-4">Note</th>
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('created_at')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>Timestamp</span>
                    {renderSortIcon('created_at')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No ledger entries found.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((item) => {
                  const uNum = resolveUserNumber(item.user_number, item.user_id);
                  const deltaVal = Number(item.delta ?? item.amount ?? 0);
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${item.user_id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 font-mono font-bold text-indigo-300 text-xs transition-colors"
                          title={`Inspect User ID ${uNum}`}
                        >
                          <span>{uNum}</span>
                        </Link>
                        {item.user_display_name && (
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {item.user_display_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-indigo-300">
                        {item.entry_type || item.type}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums ${
                          deltaVal >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatMoney(deltaVal, { showPlusSign: true })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-white tabular-nums">
                        {formatMoney(item.balance_after)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {item.note || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {new Date(item.created_at).toLocaleString()}
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
