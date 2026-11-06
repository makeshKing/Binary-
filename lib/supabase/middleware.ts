import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig, isSupabaseConfigured } from './types';
import { ADMIN_AUTH_COOKIE_NAME } from './admin-client';

function applyNoStoreHeaders(res: NextResponse): NextResponse {
  res.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

function applyAdminNoStoreHeaders(res: NextResponse): NextResponse {
  applyNoStoreHeaders(res);
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

function sanitizeNextParam(
  rawNext: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!rawNext || typeof rawNext !== 'string') return fallback;
  const trimmed = rawNext.trim();
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

function parseAdminCookiePayload(request: NextRequest): {
  accessToken: string | null;
  demoAdminSession?: boolean;
  role?: string;
} {
  const direct = request.cookies.get(ADMIN_AUTH_COOKIE_NAME)?.value;
  const chunk0 = request.cookies.get(`${ADMIN_AUTH_COOKIE_NAME}.0`)?.value;
  const chunk1 = request.cookies.get(`${ADMIN_AUTH_COOKIE_NAME}.1`)?.value;
  const raw = direct || (chunk0 ? `${chunk0}${chunk1 || ''}` : null);

  if (!raw) return { accessToken: null };

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep raw
  }

  if (decoded.startsWith('base64-')) {
    try {
      decoded = atob(decoded.slice(7));
    } catch {
      // Ignore
    }
  }

  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      if (parsed.demoAdminSession === true && parsed.role) {
        return {
          accessToken: 'demo-admin-token',
          demoAdminSession: true,
          role: String(parsed.role).toUpperCase(),
        };
      }
      const accessToken =
        parsed.access_token ||
        parsed.currentSession?.access_token ||
        parsed.session?.access_token ||
        null;
      return { accessToken };
    }
  } catch {
    // Ignore parse error
  }

  return { accessToken: null };
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // =========================================================================
  // 1. API ROUTES & ISOLATED ADMIN ROUTE PROTECTION (/api/*, /admin, /admin/*)
  //    API routes handle their own JSON auth responses and must never redirect to HTML.
  // =========================================================================
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname === '/admin/login') {
      const loginRes = NextResponse.next({ request });
      return applyAdminNoStoreHeaders(loginRes);
    }

    const { accessToken, demoAdminSession, role } =
      parseAdminCookiePayload(request);

    const hasStandardAuthCookie = request.cookies
      .getAll()
      .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));

    if (!accessToken && !hasStandardAuthCookie) {
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const redirectRes = NextResponse.redirect(loginUrl);
      return applyAdminNoStoreHeaders(redirectRes);
    }

    if (!accessToken && hasStandardAuthCookie) {
      const adminRes = NextResponse.next({ request });
      return applyAdminNoStoreHeaders(adminRes);
    }

    if (!isSupabaseConfigured()) {
      if (
        demoAdminSession &&
        role &&
        ['SUPPORT', 'ADMIN', 'SUPERADMIN'].includes(role)
      ) {
        const res = NextResponse.next({ request });
        return applyAdminNoStoreHeaders(res);
      }
      const loginUrl = new URL('/admin/login', request.url);
      const redirectRes = NextResponse.redirect(loginUrl);
      return applyAdminNoStoreHeaders(redirectRes);
    }

    try {
      const { url: supabaseUrl, anonKey: supabaseAnonKey } =
        getSupabaseConfig();
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      });

      if (!userRes.ok) {
        const loginUrl = new URL('/admin/login', request.url);
        const redirectRes = NextResponse.redirect(loginUrl);
        redirectRes.cookies.delete(ADMIN_AUTH_COOKIE_NAME);
        return applyAdminNoStoreHeaders(redirectRes);
      }

      const userData = await userRes.json();
      const userId = userData?.id;
      if (!userId) {
        const loginUrl = new URL('/admin/login', request.url);
        const redirectRes = NextResponse.redirect(loginUrl);
        redirectRes.cookies.delete(ADMIN_AUTH_COOKIE_NAME);
        return applyAdminNoStoreHeaders(redirectRes);
      }

      const profRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
          userId
        )}&select=role,status,is_admin`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
          cache: 'no-store',
        }
      );

      if (profRes.ok) {
        const rows = await profRes.json();
        const prof = Array.isArray(rows) ? rows[0] : null;
        const profRole = String(prof?.role || '').toUpperCase();
        const profStatus = String(prof?.status || 'ACTIVE').toUpperCase();
        const isAllowedRole =
          ['SUPPORT', 'ADMIN', 'SUPERADMIN'].includes(profRole) ||
          prof?.is_admin === true;

        if (!prof || !isAllowedRole || profStatus !== 'ACTIVE') {
          const loginUrl = new URL('/admin/login', request.url);
          const redirectRes = NextResponse.redirect(loginUrl);
          redirectRes.cookies.delete(ADMIN_AUTH_COOKIE_NAME);
          return applyAdminNoStoreHeaders(redirectRes);
        }
      }
    } catch {
      // Allow server layout to perform secondary verification if edge fetch fails
    }

    const adminRes = NextResponse.next({ request });
    return applyAdminNoStoreHeaders(adminRes);
  }

  // =========================================================================
  // 2. USER APP SESSION VERIFICATION & ROUTE PROTECTION
  //    Public routes: "/", "/login", "/register", "/logout", "/wallet/payment-details"
  //    Every other route requires a valid, non-anonymous user session.
  // =========================================================================
  const isVisitorPublicRoute =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/logout' ||
    pathname === '/wallet/payment-details';

  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!isSupabaseConfigured()) {
    if (!isVisitorPublicRoute) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set(
        'next',
        `${pathname}${request.nextUrl.search || ''}`
      );
      return applyNoStoreHeaders(NextResponse.redirect(loginUrl));
    }
    return applyNoStoreHeaders(supabaseResponse);
  }

  const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabaseConfig();
  const isHttps =
    request.nextUrl.protocol === 'https:' ||
    (process.env.APP_URL || '').startsWith('https://');

  const userAuthCookies = request.cookies
    .getAll()
    .filter(
      (c) =>
        c.name !== ADMIN_AUTH_COOKIE_NAME &&
        !c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) &&
        !c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
    );

  const hadPreviousAuthTokenCookie = userAuthCookies.some(
    (c) => c.name.startsWith('sb-') && c.name.includes('auth-token')
  );

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return userAuthCookies;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          if (
            name !== ADMIN_AUTH_COOKIE_NAME &&
            !name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`)
          ) {
            request.cookies.set(name, value);
          }
        });
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          if (
            name !== ADMIN_AUTH_COOKIE_NAME &&
            !name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`)
          ) {
            supabaseResponse.cookies.set(name, value, {
              ...options,
              sameSite: isHttps ? 'none' : (options?.sameSite ?? 'lax'),
              secure: isHttps ? true : options?.secure,
            });
          }
        });
      },
    },
  });

  let authenticatedUser: {
    id: string;
    is_anonymous?: boolean;
    email?: string | null;
  } | null = null;
  let hadTokenError = false;

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      hadTokenError = true;
    } else if (user && user.id && user.is_anonymous !== true) {
      authenticatedUser = user;
    }
  } catch {
    hadTokenError = true;
  }

  // Allow /logout to always execute its sign-out flow
  if (pathname === '/logout') {
    return applyNoStoreHeaders(supabaseResponse);
  }

  // Logged-in user visiting "/", "/login", or "/register" -> redirect to "/dashboard" (or safe ?next=)
  if (
    authenticatedUser &&
    (pathname === '/' || pathname === '/login' || pathname === '/register')
  ) {
    const requestedNext = request.nextUrl.searchParams.get('next');
    const safeDestination = sanitizeNextParam(requestedNext, '/dashboard');
    const targetUrl = new URL(safeDestination, request.url);
    return applyNoStoreHeaders(NextResponse.redirect(targetUrl));
  }

  // Visitor on "/", "/login", or "/register" -> render the page
  if (isVisitorPublicRoute) {
    return applyNoStoreHeaders(supabaseResponse);
  }

  // Protected route without a valid non-anonymous user session -> redirect to /login?next=...
  if (!authenticatedUser) {
    const loginUrl = new URL('/login', request.url);
    const fullOriginalPath = `${pathname}${request.nextUrl.search || ''}`;
    loginUrl.searchParams.set('next', fullOriginalPath);

    if (hadPreviousAuthTokenCookie && hadTokenError) {
      loginUrl.searchParams.set('message', 'session_expired');
    }

    const redirectRes = NextResponse.redirect(loginUrl);
    // Clear any stale user auth cookies so the client starts clean
    userAuthCookies.forEach((c) => {
      if (c.name.startsWith('sb-')) {
        redirectRes.cookies.delete(c.name);
      }
    });
    return applyNoStoreHeaders(redirectRes);
  }

  return applyNoStoreHeaders(supabaseResponse);
}
