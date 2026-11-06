'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3,
  Lock,
  Mail,
  User,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/types';
import {
  isRealAuthenticatedUser,
  sanitizeNextPath,
} from '@/lib/supabase/auth-utils';

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [configured, setConfigured] = useState<boolean>(true);

  useEffect(() => {
    const isConf = isSupabaseConfigured();
    setConfigured(isConf);

    if (!isConf) {
      setCheckingSession(false);
      return;
    }

    let isMounted = true;
    const supabase = createClient();

    async function checkAlreadyLoggedIn() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.user && isRealAuthenticatedUser(session.user)) {
          const target = sanitizeNextPath(nextParam, '/dashboard');
          router.replace(target);
          return;
        }

        if (session?.user?.is_anonymous) {
          await supabase.auth.signOut().catch(() => {});
        }
      } finally {
        if (isMounted) {
          setCheckingSession(false);
        }
      }
    }

    void checkAlreadyLoggedIn();

    return () => {
      isMounted = false;
    };
  }, [nextParam, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!isSupabaseConfigured()) {
      setError(
        'Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment first.'
      );
      return;
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (cleanName.length < 2 || cleanName.length > 50) {
      setError('Display name must be between 2 and 50 characters.');
      return;
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            name: cleanName,
            display_name: cleanName,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const target = sanitizeNextPath(nextParam, '/dashboard');

      // If Confirm Email is disabled in Supabase, data.session is returned immediately
      if (data?.session?.user && isRealAuthenticatedUser(data.session.user)) {
        router.replace(target);
        router.refresh();
        return;
      }

      // If email confirmation is required by the Supabase project settings
      if (data?.user && !data?.session) {
        setInfoMessage(
          `Account registered for ${cleanEmail}! Please check your email inbox and click the confirmation link to activate your account, then log in.`
        );
        return;
      }
    } catch {
      setError(
        'Unable to reach Supabase Auth. Verify that NEXT_PUBLIC_SUPABASE_URL is a valid https://*.supabase.co URL.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-10 bg-[#171a23]">
      <div className="w-full max-w-md bg-[#1c202b] border border-[#2e3446] rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#252a3a] border border-[#343b4f] flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-[#22ab68]" />
            </div>
            <div>
              <span className="text-base font-extrabold tracking-wider text-white block leading-none">
                QUOTEX
              </span>
              <span className="text-[10px] font-mono text-[#8c94ab] uppercase tracking-widest">
                WEB TRADING PLATFORM
              </span>
            </div>
          </Link>

          <span className="px-2.5 py-1 rounded-md bg-[#22ab68]/15 border border-[#22ab68]/30 text-[10px] font-mono font-bold text-[#22ab68]">
            LIVE ACCOUNT
          </span>
        </div>

        <h1 className="text-xl font-bold text-white tracking-tight">
          Create Live Trading Account
        </h1>
        <p className="text-xs text-[#8c94ab] mt-1 mb-5">
          Automatically provisions your personal profile and unique 5-digit User ID with a $0.00 balance ready for deposit.
        </p>

        {!configured && (
          <div className="mb-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            Configure <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to register.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#e34c3b]/15 border border-[#e34c3b]/40 text-xs text-red-200 flex items-start gap-2.5 leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            className="mb-5 p-3.5 rounded-xl bg-[#22ab68]/15 border border-[#22ab68]/40 text-xs text-emerald-200 flex items-start gap-2.5 leading-relaxed"
          >
            <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="register-name"
              className="block text-xs font-semibold text-slate-300 mb-1.5"
            >
              Trader Display Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="register-name"
                type="text"
                required
                minLength={2}
                maxLength={50}
                disabled={loading || checkingSession}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Mercer"
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-[#141720] border border-[#2e3446] focus:border-[#1d8cf8] focus:outline-none text-sm text-white disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="block text-xs font-semibold text-slate-300 mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="register-email"
                type="email"
                required
                autoComplete="email"
                disabled={loading || checkingSession}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-[#141720] border border-[#2e3446] focus:border-[#1d8cf8] focus:outline-none text-sm text-white disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="block text-xs font-semibold text-slate-300 mb-1.5"
            >
              Password (min. 6 characters)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="register-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                disabled={loading || checkingSession}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-[#141720] border border-[#2e3446] focus:border-[#1d8cf8] focus:outline-none text-sm text-white disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || checkingSession}
            className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-[#1d8cf8] hover:bg-[#167ae0] disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-colors"
          >
            <span>
              {loading
                ? 'Creating Account...'
                : checkingSession
                  ? 'Checking session...'
                  : 'Create Live Account'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#262b38] flex items-center justify-between text-xs text-[#8c94ab]">
          <span>Already registered?</span>
          <Link
            href={
              nextParam
                ? `/login?next=${encodeURIComponent(nextParam)}`
                : '/login'
            }
            className="font-bold text-[#3898ff] hover:underline"
          >
            Log In →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-[#171a23] text-xs text-[#8c94ab]">
          Loading registration form...
        </div>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
