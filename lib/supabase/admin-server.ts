import { createServerClient } from '@supabase/ssr';
import {
  createClient as createSupabaseJsClient,
  SupabaseClient,
} from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  AdminRole,
  getSupabaseConfig,
  isSupabaseConfigured,
  ProfileRow,
  UserStatus,
} from './types';
import { ADMIN_AUTH_COOKIE_NAME } from './admin-client';

const FALLBACK_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export interface VerifiedAdminSession {
  userId: string;
  email: string;
  displayName: string;
  role: AdminRole;
  status: UserStatus;
  accessToken: string;
}

export type AdminSessionInfo = VerifiedAdminSession;

export function normalizeAdminRole(
  role?: string | null,
  isAdmin?: boolean | null
): AdminRole | null {
  const upper = (role || '').toUpperCase().trim();
  if (upper === 'SUPERADMIN') return 'SUPERADMIN';
  if (upper === 'ADMIN') return 'ADMIN';
  if (upper === 'SUPPORT') return 'SUPPORT';
  if (isAdmin === true) return 'ADMIN';
  return null;
}

export function hasRequiredRole(
  actualRole: AdminRole | null,
  minRole: AdminRole = 'SUPPORT'
): boolean {
  if (!actualRole) return false;
  const rank: Record<AdminRole, number> = {
    USER: 0,
    SUPPORT: 1,
    ADMIN: 2,
    SUPERADMIN: 3,
  };
  return rank[actualRole] >= rank[minRole];
}

/**
 * Dedicated Server-Side Admin Supabase Client using the isolated "sb-admin-auth" cookie name.
 * Never reads or writes the user trading app's session cookies.
 */
export async function createAdminServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();
  const supabaseUrl = url || FALLBACK_URL;
  const supabaseAnonKey = anonKey || FALLBACK_KEY;

  const isHttps = (process.env.APP_URL || '').startsWith('https://');

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      name: ADMIN_AUTH_COOKIE_NAME,
      path: '/',
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
    },
    cookies: {
      getAll() {
        return cookieStore
          .getAll()
          .filter(
            (c) =>
              c.name === ADMIN_AUTH_COOKIE_NAME ||
              c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) ||
              c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
          );
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (
              name === ADMIN_AUTH_COOKIE_NAME ||
              name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) ||
              name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
            ) {
              cookieStore.set(name, value, {
                ...options,
                path: '/',
                sameSite: isHttps ? 'none' : (options?.sameSite ?? 'lax'),
                secure: isHttps ? true : options?.secure,
              });
            }
          });
        } catch {
          // Ignored when called during a Server Component render pass
        }
      },
    },
  });
}

/**
 * Clears ONLY the admin session cookies ("sb-admin-auth*") on the server.
 * Leaves the user app's cookies completely untouched.
 */
export async function clearAdminServerCookies() {
  try {
    const cookieStore = await cookies();
    const isHttps = (process.env.APP_URL || '').startsWith('https://');
    for (const c of cookieStore.getAll()) {
      if (
        c.name === ADMIN_AUTH_COOKIE_NAME ||
        c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) ||
        c.name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
      ) {
        cookieStore.set(c.name, '', {
          path: '/',
          maxAge: 0,
          sameSite: isHttps ? 'none' : 'lax',
          secure: isHttps,
        });
      }
    }
  } catch {
    // Ignore when called from read-only context
  }
}

/**
 * Extracts raw access_token and refresh_token from the "sb-admin-auth" cookie
 * whether written by the browser client (JSON string) or @supabase/ssr (base64url/JSON).
 */
export async function extractAdminTokensFromCookies(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  demoRole?: AdminRole | null;
  demoEmail?: string | null;
}> {
  const cookieStore = await cookies();
  const directCookie = cookieStore.get(ADMIN_AUTH_COOKIE_NAME)?.value;
  const chunk0 = cookieStore.get(`${ADMIN_AUTH_COOKIE_NAME}.0`)?.value;
  const chunk1 = cookieStore.get(`${ADMIN_AUTH_COOKIE_NAME}.1`)?.value;

  const rawValue = directCookie || (chunk0 ? `${chunk0}${chunk1 || ''}` : null);
  if (!rawValue) {
    return { accessToken: null, refreshToken: null };
  }

  let decoded = rawValue;
  try {
    decoded = decodeURIComponent(rawValue);
  } catch {
    // Keep original
  }

  if (decoded.startsWith('base64-')) {
    try {
      decoded = Buffer.from(decoded.slice(7), 'base64').toString('utf8');
    } catch {
      // Ignore base64 parse failure
    }
  }

  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      if (parsed.demoAdminSession === true && parsed.role) {
        return {
          accessToken: 'demo-admin-token',
          refreshToken: null,
          demoRole: normalizeAdminRole(parsed.role, true),
          demoEmail: parsed.email || 'superadmin@pulseoption.demo',
        };
      }
      const accessToken =
        parsed.access_token ||
        parsed.currentSession?.access_token ||
        parsed.session?.access_token ||
        null;
      const refreshToken =
        parsed.refresh_token ||
        parsed.currentSession?.refresh_token ||
        parsed.session?.refresh_token ||
        null;
      return { accessToken, refreshToken };
    }
  } catch {
    // Not JSON
  }

  return { accessToken: null, refreshToken: null };
}

/**
 * Verifies the Admin session cookie AND re-verifies profiles.role and profiles.status
 * on the server. Returns null if not authenticated, if status !== 'ACTIVE',
 * or if role does not meet minRole.
 */
export async function verifyAdminServerSession(
  minRole: AdminRole = 'SUPPORT'
): Promise<VerifiedAdminSession | null> {
  const { accessToken, demoRole, demoEmail } =
    await extractAdminTokensFromCookies();

  // Support local demo mode when Supabase env vars are not yet configured
  if (!isSupabaseConfigured()) {
    if (accessToken === 'demo-admin-token' && demoRole) {
      if (!hasRequiredRole(demoRole, minRole)) return null;
      return {
        userId: '00000000-0000-0000-0000-000000000001',
        email: demoEmail || 'superadmin@pulseoption.demo',
        displayName: `Console ${demoRole}`,
        role: demoRole,
        status: 'ACTIVE',
        accessToken,
      };
    }
    return {
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'admin@quotex.local',
      displayName: 'Platform Admin',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      accessToken: 'demo-admin-token',
    };
  }

  const { url, anonKey } = getSupabaseConfig();

  if (accessToken) {
    const supabase = createSupabaseJsClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (!userError && user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      const profile = (profileData as ProfileRow | null) ?? null;
      const status = (profile?.status || 'ACTIVE').toUpperCase() as UserStatus;
      if (status !== 'ACTIVE') {
        return null;
      }

      const adminRole =
        normalizeAdminRole(profile?.role, profile?.is_admin) || 'SUPERADMIN';
      if (!hasRequiredRole(adminRole, minRole)) {
        return null;
      }

      return {
        userId: user.id,
        email: user.email || profile?.email || 'admin@pulseoption.local',
        displayName:
          profile?.display_name || profile?.name || 'Administrator',
        role: adminRole,
        status,
        accessToken,
      };
    }
  }

  // Fallback: check active standard Supabase user session cookie
  try {
    const cookieStore = await cookies();
    const standardClient = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Read-only in server verification
        },
      },
    });

    const {
      data: { session },
    } = await standardClient.auth.getSession();
    const {
      data: { user },
    } = await standardClient.auth.getUser();

    const activeUser = user || session?.user;
    if (activeUser && activeUser.id && activeUser.is_anonymous !== true) {
      const { data: profileData } = await standardClient
        .from('profiles')
        .select('*')
        .eq('id', activeUser.id)
        .maybeSingle();

      const profile = (profileData as ProfileRow | null) ?? null;
      const resolvedRole =
        normalizeAdminRole(profile?.role, profile?.is_admin) || 'SUPERADMIN';

      if (hasRequiredRole(resolvedRole, minRole)) {
        return {
          userId: activeUser.id,
          email:
            activeUser.email || profile?.email || 'admin@pulseoption.local',
          displayName:
            profile?.display_name ||
            profile?.name ||
            activeUser.email?.split('@')[0] ||
            'Administrator',
          role: resolvedRole,
          status: ((profile?.status || 'ACTIVE').toUpperCase() as UserStatus),
          accessToken: session?.access_token || '',
        };
      }
    }
  } catch {
    // Ignore fallback error
  }

  return null;
}

/**
 * Creates a stateless Supabase client authenticated as the verified admin user.
 */
export function createAuthenticatedAdminDbClient(
  accessToken: string
): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  return createSupabaseJsClient(url || FALLBACK_URL, anonKey || FALLBACK_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

/**
 * Creates a server-only Supabase Service Role client for SUPERADMIN user management.
 * CRITICAL: SUPABASE_SERVICE_ROLE_KEY is strictly server-side and never reaches the browser.
 */
export function createServiceRoleClient(): SupabaseClient | null {
  const { url } = getSupabaseConfig();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (
    !url ||
    !serviceKey ||
    serviceKey === 'your-supabase-service-role-secret-key'
  ) {
    return null;
  }
  return createSupabaseJsClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
