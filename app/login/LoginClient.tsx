'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/types';
import {
  isRealAuthenticatedUser,
  sanitizeNextPath,
} from '@/lib/supabase/auth-utils';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');
  const messageParam = searchParams.get('message');

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

    if (messageParam === 'logged_out') {
      setInfoMessage('You have been logged out.');
    } else if (messageParam === 'session_expired') {
      setError('Session expired, please log in again.');
    }

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
  }, [messageParam, nextParam, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 6) {
      setError('Please enter your password (at least 6 characters).');
      return;
    }

    if (!isSupabaseConfigured()) {
      setError(
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured.'
      );
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

      if (signInError) {
        const msg = signInError.message || 'Sign in failed.';
        if (msg.toLowerCase().includes('email not confirmed')) {
          setError(
            'Your email address has not been confirmed yet. Please click the confirmation link sent to your email or disable "Confirm email" in Supabase Dashboard → Authentication → Providers → Email.'
          );
        } else if (msg.toLowerCase().includes('invalid login credentials')) {
          setError(
            'Invalid email or password. Please check your credentials or create an account below.'
          );
        } else {
          setError(msg);
        }
        return;
      }

      const user = data?.session?.user;
      if (!user || !isRealAuthenticatedUser(user)) {
        await supabase.auth.signOut().catch(() => {});
        setError('Anonymous accounts are not permitted. Please sign in with a registered email.');
        return;
      }

      const target = sanitizeNextPath(nextParam, '/dashboard');
      router.replace(target);
      router.refresh();
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
          Log in to your Trading Account
        </h1>
        <p className="text-xs text-[#8c94ab] mt-1 mb-5">
          Sign in with your registered email and password to access the live trading terminal.
        </p>

        {!configured && (
          <div className="mb-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-amber-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Supabase Environment Variables Required</span>
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment.
            </p>
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            className="mb-5 p-3.5 rounded-xl bg-[#22ab68]/15 border border-[#22ab68]/40 text-xs text-emerald-200 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-semibold text-slate-300 mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-email"
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
              htmlFor="login-password"
              className="block text-xs font-semibold text-slate-300 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
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
            className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-[#22ab68] hover:bg-[#1e995d] disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-colors"
          >
            <span>
              {loading
                ? 'Signing in...'
                : checkingSession
                  ? 'Checking session...'
                  : 'Log In'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#262b38] flex items-center justify-between text-xs text-[#8c94ab]">
          <span>Don&apos;t have an account yet?</span>
          <Link
            href={
              nextParam
                ? `/register?next=${encodeURIComponent(nextParam)}`
                : '/register'
            }
            className="font-bold text-[#3898ff] hover:underline"
          >
            Sign Up →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-[#171a23] text-xs text-[#8c94ab]">
          Loading sign-in form...
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
