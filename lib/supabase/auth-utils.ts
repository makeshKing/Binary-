'use client';

import { useEffect, useState } from 'react';
import { createClient, resetBrowserClientCache } from './client';
import { isSupabaseConfigured } from './types';
import { ADMIN_AUTH_COOKIE_NAME } from './admin-client';

export const AUTH_LOGOUT_STORAGE_KEY = 'pulseoption:auth_logout_sync';
export const AUTH_BROADCAST_CHANNEL = 'pulseoption_auth_channel';

/**
 * Validates a `?next=` redirect path so open redirects or auth loops cannot occur.
 */
export function sanitizeNextPath(
  nextParam: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!nextParam || typeof nextParam !== 'string') return fallback;
  const trimmed = nextParam.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }
  const pathnameOnly = trimmed.split('?')[0].split('#')[0];
  if (
    pathnameOnly === '/' ||
    pathnameOnly === '/login' ||
    pathnameOnly === '/register' ||
    pathnameOnly === '/logout' ||
    pathnameOnly === '/admin' ||
    pathnameOnly.startsWith('/admin/')
  ) {
    return fallback;
  }
  return trimmed;
}

/**
 * Checks whether a Supabase user object represents a real, non-anonymous user.
 */
export function isRealAuthenticatedUser(
  user: { id?: string; is_anonymous?: boolean; email?: string | null } | null | undefined
): boolean {
  if (!user || !user.id) return false;
  if (user.is_anonymous === true) return false;
  return true;
}

/**
 * Clears all user-auth keys in localStorage, sessionStorage, and non-admin auth cookies.
 * Never touches the isolated `sb-admin-auth` cookie.
 */
export function clearAppClientStorage(): void {
  if (typeof window === 'undefined') return;

  try {
    const localKeysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('sb-') ||
        k.startsWith('supabase.') ||
        k.startsWith('pulseoption:')
      ) {
        if (
          k !== ADMIN_AUTH_COOKIE_NAME &&
          !k.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) &&
          k !== AUTH_LOGOUT_STORAGE_KEY
        ) {
          localKeysToRemove.push(k);
        }
      }
    }
    localKeysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Ignore storage errors
  }

  try {
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('sb-') ||
        k.startsWith('supabase.') ||
        k.startsWith('pulseoption:')
      ) {
        sessionKeysToRemove.push(k);
      }
    }
    sessionKeysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Ignore storage errors
  }

  if (typeof document !== 'undefined') {
    try {
      const isHttps = window.location.protocol === 'https:';
      const sameSite = isHttps ? 'None; Secure' : 'Lax';
      const cookies = document.cookie.split(';');
      for (const rawCookie of cookies) {
        const eqIdx = rawCookie.indexOf('=');
        const name = (eqIdx > -1 ? rawCookie.slice(0, eqIdx) : rawCookie).trim();
        if (!name) continue;
        if (
          name === ADMIN_AUTH_COOKIE_NAME ||
          name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) ||
          name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
        ) {
          continue;
        }
        if (name.startsWith('sb-') || name.startsWith('pulseoption')) {
          document.cookie = `${ name }=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}`;
          document.cookie = `${ name }=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
      }
    } catch {
      // Ignore cookie errors
    }
  }
}

/**
 * Broadcasts a logout signal across all open browser tabs (via both localStorage
 * event and BroadcastChannel).
 */
export function broadcastLogoutToOtherTabs(
  reason: 'logged_out' | 'session_expired' = 'logged_out'
): void {
  if (typeof window === 'undefined') return;

  const payload = JSON.stringify({
    type: 'LOGOUT',
    reason,
    timestamp: Date.now(),
  });

  try {
    window.localStorage.setItem(AUTH_LOGOUT_STORAGE_KEY, payload);
  } catch {
    // Ignore storage errors
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      channel.postMessage({ type: 'LOGOUT', reason, timestamp: Date.now() });
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel errors
  }
}

/**
 * Signs out of Supabase, removes all Realtime channels, wipes client storage/cookies,
 * notifies all other open tabs, and replaces the current history entry with /login
 * so pressing the browser Back button cannot return to the protected page.
 */
export async function performFullLogout(
  reason: 'logged_out' | 'session_expired' = 'logged_out'
): Promise<void> {
  try {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      try {
        await supabase.removeAllChannels();
      } catch {
        // Ignore channel cleanup errors
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore network errors during signOut
      }
    }
  } finally {
    clearAppClientStorage();
    resetBrowserClientCache();
    broadcastLogoutToOtherTabs(reason);

    if (typeof window !== 'undefined') {
      const target = `/login?message=${encodeURIComponent(reason)}`;
      window.location.replace(target);
    }
  }
}

/**
 * Client-side session guard hook for protected pages (/dashboard, /wallet, /profile, /leaderboard).
 * Enforces:
 * 1. Real non-anonymous session required before rendering protected UI.
 * 2. Multi-tab logout synchronization (logging out in Tab A immediately logs out Tab B).
 * 3. Expired token / refresh failure handling -> redirects to /login?message=session_expired.
 * 4. Browser Back button (bfcache `pageshow`) protection after logout.
 */
export function useProtectedSessionGuard(currentPath: string): {
  isCheckingAuth: boolean;
  authenticatedUserId: string | null;
  userEmail: string | null;
} {
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(
    null
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const redirectToLogin = (
      reason?: 'logged_out' | 'session_expired',
      includeNext = true
    ) => {
      clearAppClientStorage();
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams();
      if (includeNext && currentPath && currentPath.startsWith('/')) {
        params.set('next', currentPath);
      }
      if (reason) {
        params.set('message', reason);
      }
      const qs = params.toString();
      window.location.replace(`/login${qs ? `?${qs}` : ''}`);
    };

    if (!isSupabaseConfigured()) {
      redirectToLogin();
      return;
    }

    const supabase = createClient();

    async function verifyCurrentSession() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          redirectToLogin('session_expired', true);
          return;
        }

        let activeUser = session?.user ?? null;
        if (!activeUser) {
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();
          if (userError) {
            redirectToLogin(undefined, true);
            return;
          }
          activeUser = user;
        }

        if (!isRealAuthenticatedUser(activeUser)) {
          // If an anonymous user somehow existed, sign them out immediately
          if (activeUser?.is_anonymous) {
            await supabase.auth.signOut().catch(() => {});
          }
          redirectToLogin(undefined, true);
          return;
        }

        if (isMounted && activeUser) {
          setAuthenticatedUserId(activeUser.id);
          setUserEmail(activeUser.email ?? null);
          setIsCheckingAuth(false);
        }
      } catch {
        redirectToLogin('session_expired', true);
      }
    }

    void verifyCurrentSession();

    // Listen to Supabase Auth events (SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        if (event === 'SIGNED_OUT') {
          setAuthenticatedUserId(null);
          setUserEmail(null);
          redirectToLogin('logged_out', false);
          return;
        }
        if (
          (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') &&
          !session
        ) {
          // If INITIAL_SESSION has no session, verifyCurrentSession handles it
          if (event === 'TOKEN_REFRESHED') {
            setAuthenticatedUserId(null);
            setUserEmail(null);
            redirectToLogin('session_expired', true);
          }
          return;
        }
        if (session?.user) {
          if (!isRealAuthenticatedUser(session.user)) {
            redirectToLogin(undefined, true);
            return;
          }
          setAuthenticatedUserId(session.user.id);
          setUserEmail(session.user.email ?? null);
          setIsCheckingAuth(false);
        }
      }
    );

    // Multi-tab logout listener via localStorage 'storage' event
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === AUTH_LOGOUT_STORAGE_KEY && e.newValue) {
        let reason: 'logged_out' | 'session_expired' = 'logged_out';
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed?.reason === 'session_expired') {
            reason = 'session_expired';
          }
        } catch {
          // Use default
        }
        setAuthenticatedUserId(null);
        setUserEmail(null);
        redirectToLogin(reason, false);
      } else if (e.key && e.key.startsWith('sb-') && e.newValue === null) {
        // Auth token key removed in another tab
        setAuthenticatedUserId(null);
        setUserEmail(null);
        redirectToLogin('logged_out', false);
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    // Multi-tab logout listener via BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (event?.data?.type === 'LOGOUT') {
            const reason =
              event.data.reason === 'session_expired'
                ? 'session_expired'
                : 'logged_out';
            setAuthenticatedUserId(null);
            setUserEmail(null);
            redirectToLogin(reason, false);
          }
        };
      }
    } catch {
      // Ignore BroadcastChannel errors
    }

    // Back-button / bfcache restore check: re-verify session on pageshow & visibilitychange
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void verifyCurrentSession();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void verifyCurrentSession();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (bc) {
        bc.close();
      }
    };
  }, [currentPath]);

  return { isCheckingAuth, authenticatedUserId, userEmail };
}
