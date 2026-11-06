import {
  createClient as createSupabaseJsClient,
  SupabaseClient,
} from '@supabase/supabase-js';
import { getSupabaseConfig } from './types';

export const ADMIN_AUTH_COOKIE_NAME = 'sb-admin-auth';

const FALLBACK_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

let adminBrowserClientInstance: SupabaseClient | null = null;
let cachedAdminConfigKey = '';

export function writeAdminCookieSafe(
  name: string,
  value: string,
  maxAgeSeconds = 60 * 60 * 8
) {
  if (typeof document === 'undefined') return;
  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  const sameSite = isHttps ? 'None; Secure' : 'Lax';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; path=/; max-age=${maxAgeSeconds}; SameSite=${sameSite}`;
}

export function readAdminCookieSafe(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}

export function clearAdminCookiesOnly() {
  if (typeof document === 'undefined') return;
  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const eqIdx = raw.indexOf('=');
    const name = (eqIdx > -1 ? raw.slice(0, eqIdx) : raw).trim();
    if (
      name === ADMIN_AUTH_COOKIE_NAME ||
      name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}.`) ||
      name.startsWith(`${ADMIN_AUTH_COOKIE_NAME}-`)
    ) {
      writeAdminCookieSafe(name, '', 0);
    }
  }
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ADMIN_AUTH_COOKIE_NAME);
      window.localStorage.removeItem(`${ADMIN_AUTH_COOKIE_NAME}-user`);
      window.localStorage.removeItem('sb-admin-last-activity');
    }
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Dedicated Admin Browser Supabase Client.
 * Uses `storageKey: "sb-admin-auth"` and cookie `"sb-admin-auth"`, completely
 * isolated from the user trading app's session storage and cookies.
 */
export function createAdminClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  const supabaseUrl = url || FALLBACK_URL;
  const supabaseAnonKey = anonKey || FALLBACK_KEY;
  const configSignature = `admin::${supabaseUrl}::${supabaseAnonKey}`;

  if (adminBrowserClientInstance && cachedAdminConfigKey === configSignature) {
    return adminBrowserClientInstance;
  }

  cachedAdminConfigKey = configSignature;
  adminBrowserClientInstance = createSupabaseJsClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        storageKey: ADMIN_AUTH_COOKIE_NAME,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage:
          typeof window !== 'undefined'
            ? {
                getItem: (key: string) => {
                  const cookieVal = readAdminCookieSafe(key);
                  if (cookieVal) return cookieVal;
                  try {
                    return window.localStorage.getItem(key);
                  } catch {
                    return null;
                  }
                },
                setItem: (key: string, value: string) => {
                  try {
                    window.localStorage.setItem(key, value);
                  } catch {
                    // Ignore storage access errors
                  }
                  writeAdminCookieSafe(key, value, 60 * 60 * 8);
                },
                removeItem: (key: string) => {
                  try {
                    window.localStorage.removeItem(key);
                  } catch {
                    // Ignore storage access errors
                  }
                  writeAdminCookieSafe(key, '', 0);
                },
              }
            : undefined,
      },
    }
  );

  return adminBrowserClientInstance;
}

export const getSupabaseAdminBrowserClient = createAdminClient;

