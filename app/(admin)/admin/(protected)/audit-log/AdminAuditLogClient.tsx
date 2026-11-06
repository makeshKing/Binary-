'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  RefreshCw,
  Lock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react';
import { AdminAuditLogRow, resolveUserNumber } from '@/lib/supabase/types';

type SortField = 'user_number' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AdminAuditLogRow[]>([]);
  const [forbidden, setForbidden] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=audit-log', {
        cache: 'no-store',
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        setLogs(json.auditLogs || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

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

    const resolveLogUserNumber = (log: AdminAuditLogRow): number => {
      if (log.target_user_number) return Number(log.target_user_number);
      if (log.admin_user_number) return Number(log.admin_user_number);
      return resolveUserNumber(
        null,
        log.target_id || log.admin_user_id || log.id
      );
    };

    const rows = logs.filter((l) => {
      if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
      if (!q) return true;
      const uNum = resolveLogUserNumber(l);
      if (isExactFiveDigit && String(uNum) === q) return true;
      return (
        String(uNum).includes(q) ||
        (l.admin_email || '').toLowerCase().includes(q) ||
        (l.action || '').toLowerCase().includes(q) ||
        (l.target_id || '').toLowerCase().includes(q)
      );
    });

    return rows.sort((a, b) => {
      const aNum = resolveLogUserNumber(a);
      const bNum = resolveLogUserNumber(b);

      if (isExactFiveDigit) {
        const aExact = String(aNum) === q ? 0 : 1;
        const bExact = String(bNum) === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
      }

      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'user_number') {
        return (aNum - bNum) * mul;
      }
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        mul
      );
    });
  }, [logs, actionFilter, searchQuery, sortField, sortDir]);

  if (forbidden) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-[#0B101B] p-8 text-center space-y-3">
        <Lock className="w-8 h-8 text-rose-400 mx-auto" />
        <h1 className="text-lg font-bold text-white">
          Restricted to SUPERADMIN
        </h1>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          The security audit log contains sensitive authentication and IP telemetry and can only be viewed by SUPERADMIN accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <ShieldAlert className="w-6 h-6 text-amber-400" />
            <span>Security &amp; Admin Audit Log</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Immutable audit trail of ADMIN_LOGIN, ADMIN_LOGIN_FAILED, IP addresses, user agents, and administrative mutations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            'ALL',
            'ADMIN_LOGIN',
            'ADMIN_LOGIN_FAILED',
            'WALLET_REQUEST_APPROVED',
            'WALLET_REQUEST_REJECTED',
            'BALANCE_ADJUSTED',
          ].map((act) => (
            <button
              key={act}
              type="button"
              onClick={() => setActionFilter(act)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono cursor-pointer ${
                actionFilter === act
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0B101B] border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {act}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchAuditLogs}
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
            placeholder="Filter audit log by 5-digit User ID, admin email, or action..."
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
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Admin Email</th>
                <th className="py-3.5 px-4">Target</th>
                <th className="py-3.5 px-4">IP Address</th>
                <th className="py-3.5 px-4">User Agent</th>
                <th className="py-3.5 px-4">Metadata</th>
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
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No audit log entries recorded yet.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((log) => {
                  const uNum =
                    log.target_user_number ||
                    log.admin_user_number ||
                    resolveUserNumber(
                      null,
                      log.target_id || log.admin_user_id || log.id
                    );
                  const linkTargetId =
                    log.target_type === 'profile' && log.target_id
                      ? log.target_id
                      : log.admin_user_id || String(uNum);

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${linkTargetId}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 font-mono font-bold text-indigo-300 text-xs transition-colors"
                          title={`Inspect User ID ${uNum}`}
                        >
                          <span>{uNum}</span>
                        </Link>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${
                            log.action.includes('FAILED')
                              ? 'bg-rose-500/15 text-rose-300'
                              : log.action === 'ADMIN_LOGIN'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-indigo-500/15 text-indigo-300'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-white">
                        {log.admin_email || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {log.target_type
                          ? `${log.target_type}:${(log.target_id || '').slice(0, 10)}`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-300">
                        {log.ip_address || '127.0.0.1'}
                      </td>
                      <td className="py-3.5 px-4 text-[11px] text-slate-500 max-w-xs truncate">
                        {log.user_agent || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[10px] text-slate-400 max-w-xs truncate">
                        {JSON.stringify(log.metadata || {})}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
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
