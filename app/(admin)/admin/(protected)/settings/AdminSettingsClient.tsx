'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Settings,
  KeyRound,
  ShieldCheck,
  UserCog,
  CheckCircle2,
  AlertCircle,
  Trash2,
  QrCode,
} from 'lucide-react';
import { getSupabaseAdminBrowserClient } from '@/lib/supabase/admin-client';

interface TotpFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
}

export default function AdminSettingsPage() {
  const [role, setRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('SUPPORT');
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [defaultBalance, setDefaultBalance] = useState<number>(10000);
  const [maxStake, setMaxStake] = useState<number>(5000);
  const [minStake, setMinStake] = useState<number>(1);
  const [allowRegistrations, setAllowRegistrations] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  // Supabase TOTP 2FA State
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [enrolling, setEnrolling] = useState<boolean>(false);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadSettingsAndMfa = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/actions?view=dashboard&days=7', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.session?.role) setRole(json.session.role);
        if (json.settings) {
          setMaintenanceMode(Boolean(json.settings.maintenance_mode));
          setDefaultBalance(Number(json.settings.default_virtual_balance ?? 10000));
          setMaxStake(Number(json.settings.max_trade_stake ?? 5000));
          setMinStake(Number(json.settings.min_trade_stake ?? 1));
          setAllowRegistrations(Boolean(json.settings.allow_new_registrations ?? true));
        }
      }

      const supabase = getSupabaseAdminBrowserClient();
      if (supabase) {
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        if (mfaData?.totp) {
          setFactors(mfaData.totp as TotpFactor[]);
        }
      }
    } catch {
      // Ignore load errors
    }
  }, []);

  useEffect(() => {
    loadSettingsAndMfa();
  }, [loadSettingsAndMfa]);

  const handleStartEnrollTotp = async () => {
    setFeedback(null);
    setEnrolling(true);
    try {
      const supabase = getSupabaseAdminBrowserClient();
      if (!supabase) return;

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Admin Console TOTP (${new Date().toLocaleDateString()})`,
      });

      if (error || !data) {
        setFeedback({
          type: 'err',
          text: error?.message || 'Failed to start TOTP 2FA enrollment.',
        });
        setEnrolling(false);
        return;
      }

      setPendingFactorId(data.id);
      setQrCodeSvg(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to enroll TOTP.',
      });
      setEnrolling(false);
    }
  };

  const handleVerifyEnrollTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFactorId || !verifyCode) return;
    setFeedback(null);

    const supabase = getSupabaseAdminBrowserClient();
    if (!supabase) return;

    const { data: challengeData, error: challengeErr } =
      await supabase.auth.mfa.challenge({
        factorId: pendingFactorId,
      });

    if (challengeErr || !challengeData) {
      setFeedback({
        type: 'err',
        text: challengeErr?.message || 'Failed to create 2FA challenge.',
      });
      return;
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challengeData.id,
      code: verifyCode.trim(),
    });

    if (verifyErr) {
      setFeedback({
        type: 'err',
        text: verifyErr.message || 'Invalid 6-digit code.',
      });
      return;
    }

    setFeedback({
      type: 'ok',
      text: 'Two-Factor Authentication (TOTP) is now active on your admin account.',
    });
    setPendingFactorId(null);
    setQrCodeSvg(null);
    setTotpSecret(null);
    setVerifyCode('');
    setEnrolling(false);
    await loadSettingsAndMfa();
  };

  const handleUnenrollFactor = async (factorId: string) => {
    setFeedback(null);
    const supabase = getSupabaseAdminBrowserClient();
    if (!supabase) return;

    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setFeedback({ type: 'err', text: error.message });
    } else {
      setFeedback({ type: 'ok', text: '2FA factor removed.' });
      await loadSettingsAndMfa();
    }
  };

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_settings',
          maintenance_mode: maintenanceMode,
          default_virtual_balance: defaultBalance,
          max_trade_stake: maxStake,
          min_trade_stake: minStake,
          allow_new_registrations: allowRegistrations,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to save settings.' });
      } else {
        setFeedback({ type: 'ok', text: 'Platform settings updated.' });
      }
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-indigo-400" />
            <span>Admin Security &amp; Platform Settings</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Virtual credits only. No real money. Configure TOTP 2FA and global simulation parameters.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {(role === 'ADMIN' || role === 'SUPERADMIN') && (
            <Link
              href="/admin/settings/payment-details"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              <QrCode className="w-4 h-4" />
              <span>Manual Payment Details &amp; Share</span>
            </Link>
          )}
          {role === 'SUPERADMIN' && (
            <Link
              href="/admin/settings/admins"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <UserCog className="w-4 h-4" />
              <span>Manage Admin Accounts (SUPERADMIN)</span>
            </Link>
          )}
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Set up 2FA (Supabase TOTP) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-5 h-5 text-indigo-400" />
              <div>
                <h2 className="text-base font-bold text-white">
                  Set up Two-Factor Authentication (TOTP)
                </h2>
                <p className="text-xs text-slate-400">
                  Require a 6-digit authenticator code when signing in at /admin/login
                </p>
              </div>
            </div>
          </div>

          {/* Enrolled factors list */}
          {factors.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">
                Enrolled Authenticator Factors
              </div>
              {factors.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-lg border border-slate-800 bg-[#070B12] flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-white">
                      {f.friendly_name || 'Authenticator App'}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-400 uppercase">
                      Status: {f.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnenrollFactor(f.id)}
                    className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                    title="Remove 2FA factor"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!pendingFactorId ? (
            <button
              type="button"
              disabled={enrolling}
              onClick={handleStartEnrollTotp}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
            >
              {factors.length > 0
                ? 'Enroll Additional TOTP Factor'
                : 'Set Up 2FA Authenticator'}
            </button>
          ) : (
            <form
              onSubmit={handleVerifyEnrollTotp}
              className="space-y-4 pt-3 border-t border-slate-800"
            >
              <p className="text-xs text-slate-300">
                1. Scan this QR code with Google Authenticator, 1Password, or Authy:
              </p>
              {qrCodeSvg && (
                <div className="bg-white p-3 rounded-xl inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeSvg}
                    alt="TOTP QR Code"
                    className="w-40 h-40"
                  />
                </div>
              )}
              {totpSecret && (
                <div className="text-xs text-slate-400">
                  Manual setup key:{' '}
                  <code className="font-mono text-indigo-300 bg-slate-900 px-2 py-0.5 rounded">
                    {totpSecret}
                  </code>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  2. Enter the 6-digit code from your authenticator app:
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-48 px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-sm font-mono tracking-widest text-white"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Verify &amp; Activate 2FA
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingFactorId(null);
                    setQrCodeSvg(null);
                    setTotpSecret(null);
                    setEnrolling(false);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Card 2: Global Simulation Parameters (SUPERADMIN only) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-bold text-white">
                Platform Simulation Settings
              </h2>
              <p className="text-xs text-slate-400">
                Global virtual credit defaults and trade stake boundaries (SUPERADMIN only)
              </p>
            </div>
          </div>

          <form onSubmit={handleSavePlatformSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Default Virtual Balance ($)
                </label>
                <input
                  type="number"
                  disabled={role !== 'SUPERADMIN'}
                  value={defaultBalance}
                  onChange={(e) => setDefaultBalance(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs font-mono text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Max Trade Stake ($)
                </label>
                <input
                  type="number"
                  disabled={role !== 'SUPERADMIN'}
                  value={maxStake}
                  onChange={(e) => setMaxStake(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs font-mono text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Min Trade Stake ($)
                </label>
                <input
                  type="number"
                  disabled={role !== 'SUPERADMIN'}
                  value={minStake}
                  onChange={(e) => setMinStake(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs font-mono text-white disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <label className="flex items-center gap-2.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  disabled={role !== 'SUPERADMIN'}
                  checked={allowRegistrations}
                  onChange={(e) => setAllowRegistrations(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span>Allow new user demo registrations</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  disabled={role !== 'SUPERADMIN'}
                  checked={maintenanceMode}
                  onChange={(e) => setMaintenanceMode(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span>Enable Maintenance Mode notice</span>
              </label>
            </div>

            {role === 'SUPERADMIN' ? (
              <button
                type="submit"
                disabled={savingSettings}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save Platform Settings'}
              </button>
            ) : (
              <div className="text-xs text-slate-500 font-mono">
                Read-only: SUPERADMIN role required to modify global parameters.
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
