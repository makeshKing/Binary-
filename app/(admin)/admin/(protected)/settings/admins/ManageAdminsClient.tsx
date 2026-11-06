'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  UserCog,
  UserPlus,
  Trash2,
  ArrowLeft,
  Lock,
  CheckCircle2,
  AlertCircle,
  Terminal,
} from 'lucide-react';
import { ProfileRow } from '@/lib/supabase/types';

export default function ManageAdminsPage() {
  const [admins, setAdmins] = useState<ProfileRow[]>([]);
  const [serviceRoleConfigured, setServiceRoleConfigured] = useState<boolean>(false);
  const [forbidden, setForbidden] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const [email, setEmail] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('SUPPORT');
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=admins', {
        cache: 'no-store',
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        setAdmins(json.admins || []);
        setServiceRoleConfigured(Boolean(json.serviceRoleConfigured));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const handleCreateOrPromote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_admin_account',
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          password: password || undefined,
          role,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to provision admin.' });
      } else {
        setFeedback({
          type: 'ok',
          text: `Admin account (${email.trim()}) provisioned with role ${role}.`,
        });
        setEmail('');
        setDisplayName('');
        setPassword('');
        await loadAdmins();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAdmin = async (targetUserId: string, targetEmail?: string | null) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_admin_account',
          targetUserId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to remove admin access.' });
      } else {
        setFeedback({
          type: 'ok',
          text: `Removed admin privileges from ${targetEmail || targetUserId}.`,
        });
        await loadAdmins();
      }
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-[#0B101B] p-8 text-center space-y-3">
        <Lock className="w-8 h-8 text-rose-400 mx-auto" />
        <h1 className="text-lg font-bold text-white">
          Restricted to SUPERADMIN
        </h1>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Only SUPERADMIN accounts can create, promote, or revoke SUPPORT and ADMIN personnel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Settings</span>
        </Link>
        <span className="text-xs font-mono text-slate-500">
          Server-Side Service Role Key Provisioning
        </span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <UserCog className="w-6 h-6 text-amber-400" />
          <span>Admin &amp; Support Account Provisioning</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          SUPERADMIN-only console to create or remove SUPPORT and ADMIN accounts on the server using SUPABASE_SERVICE_ROLE_KEY.
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-3.5 flex items-center gap-2.5 text-xs ${
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provision / Promote Form */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <span>Create or Promote Admin</span>
          </div>

          <div className="text-[11px] text-slate-400">
            Service Role Key Status:{' '}
            <span
              className={
                serviceRoleConfigured
                  ? 'text-emerald-400 font-mono'
                  : 'text-amber-400 font-mono'
              }
            >
              {serviceRoleConfigured
                ? 'Configured (Server-Only)'
                : 'Promote-Existing Mode'}
            </span>
          </div>

          <form onSubmit={handleCreateOrPromote} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Account Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="support@organization.com"
                className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Support Operator"
                className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Initial Password (if creating brand-new user)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters (optional for existing user)"
                className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Target Role
              </label>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'SUPPORT' | 'ADMIN' | 'SUPERADMIN')
                }
                className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
              >
                <option value="SUPPORT">SUPPORT (Read-Only Console)</option>
                <option value="ADMIN">ADMIN (Wallet, Requests &amp; Trades)</option>
                <option value="SUPERADMIN">SUPERADMIN (Full Governance)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Provisioning...' : 'Provision / Promote Account'}
            </button>
          </form>
        </div>

        {/* Active Admin Personnel Table */}
        <div className="lg:col-span-2 rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 space-y-4">
          <h2 className="text-sm font-semibold text-white">
            Active Admin &amp; Support Accounts ({admins.length})
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-3 px-3">Operator</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Revoke</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading && admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Loading admin accounts...
                    </td>
                  </tr>
                ) : admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No admin accounts found.
                    </td>
                  </tr>
                ) : (
                  admins.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-white">
                          {a.display_name || 'Admin'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {a.email || a.id}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          {a.role || 'ADMIN'}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-emerald-500/15 text-emerald-300">
                          {a.status || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRemoveAdmin(a.id, a.email)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Bootstrap SQL Reference */}
          <div className="mt-6 pt-4 border-t border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              <span>SQL Editor Bootstrap (Promote First SUPERADMIN)</span>
            </div>
            <pre className="p-3 rounded-lg bg-[#070B12] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
{`UPDATE public.profiles
SET role = 'SUPERADMIN', status = 'ACTIVE', is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('mbist0066@gmail.com'));`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
