'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, Lock, Mail, KeyRound, AlertCircle, Loader2 } from 'lucide-react';

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath =
    searchParams.get('redirect') || '/admin/settings/payment-details';
  const reason = searchParams.get('reason');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    reason === 'inactivity'
      ? 'You were signed out due to 30 minutes of inactivity.'
      : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          totpCode: requiresTwoFactor ? totpCode.trim() : undefined,
        }),
      });

      const data = await response.json();

      if (response.status === 202 && data.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setErrorMessage(null);
        setLoading(false);
        return;
      }

      if (!response.ok || !(data.ok || data.authenticated)) {
        setErrorMessage(data.error || 'Invalid credentials or no admin access');
        setLoading(false);
        return;
      }

      router.replace(redirectPath.startsWith('/admin') ? redirectPath : '/admin');
      router.refresh();
    } catch {
      setErrorMessage('Invalid credentials or no admin access');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060911] flex flex-col items-center justify-center p-4 selection:bg-indigo-500/30">
      <div className="w-full max-w-md rounded-2xl border border-slate-800/90 bg-[#0B101B] p-8 shadow-2xl">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-4">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Admin Console
          </h1>
          <p className="text-xs text-slate-400 mt-1.5">
            Authorized personnel only
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-3 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-email"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Admin Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="username"
                disabled={requiresTwoFactor || loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@organization.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#070B12] border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="admin-password"
                type="password"
                required
                autoComplete="current-password"
                disabled={requiresTwoFactor || loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#070B12] border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              />
            </div>
          </div>

          {requiresTwoFactor && (
            <div className="pt-2">
              <label
                htmlFor="admin-totp"
                className="block text-xs font-medium text-indigo-300 mb-1.5"
              >
                Two-Factor Authenticator Code (TOTP)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-totp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit code"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#070B12] border border-indigo-500/50 text-sm font-mono tracking-widest text-white placeholder-slate-600 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setRequiresTwoFactor(false);
                  setTotpCode('');
                }}
                className="mt-2 text-[11px] text-slate-400 hover:text-slate-200"
              >
                Use a different account
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Access...</span>
              </>
            ) : requiresTwoFactor ? (
              <span>Verify 2FA &amp; Sign In</span>
            ) : (
              <span>Sign In to Admin Console</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
          <span>Session Cookie: sb-admin-auth</span>
          <span>Rate Limited (5 / 15m)</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#060911] flex items-center justify-center text-slate-400 text-sm">
          Loading Admin Console...
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}
