import { createClient as createSupabaseJsClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './types';

const FALLBACK_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

let browserClientInstance: SupabaseClient | null = null;
let cachedConfigKey = '';

function writeCookieSafe(
  name: string,
  value: string,
  maxAgeSeconds = 60 * 60 * 24 * 30
) {
  if (typeof document === 'undefined') return;
  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  const sameSite = isHttps ? 'None; Secure' : 'Lax';
  if (maxAgeSeconds <= 0 || !value) {
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=${sameSite}`;
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    return;
  }
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; path=/; max-age=${maxAgeSeconds}; SameSite=${sameSite}`;
}

function readCookieSafe(name: string): string | null {
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

export function resetBrowserClientCache(): void {
  browserClientInstance = null;
  cachedConfigKey = '';
}

/**
 * Creates a singleton browser Supabase client that persists real authenticated
 * sessions in BOTH localStorage AND SameSite=None;Secure cookies so server
 * middleware and server components can verify the session reliably.
 */
export function createClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  const supabaseUrl = url || FALLBACK_URL;
  const supabaseAnonKey = anonKey || FALLBACK_KEY;
  const configSignature = `${supabaseUrl}::${supabaseAnonKey}`;

  if (browserClientInstance && cachedConfigKey === configSignature) {
    return browserClientInstance;
  }

  cachedConfigKey = configSignature;
  browserClientInstance = createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage:
        typeof window !== 'undefined'
          ? {
              getItem: (key: string) => {
                try {
                  const fromLocal = window.localStorage.getItem(key);
                  if (fromLocal) return fromLocal;
                } catch {
                  // Ignore storage access errors
                }
                return readCookieSafe(key);
              },
              setItem: (key: string, value: string) => {
                try {
                  window.localStorage.setItem(key, value);
                } catch {
                  // Ignore storage access errors
                }
                writeCookieSafe(key, value);
              },
              removeItem: (key: string) => {
                try {
                  window.localStorage.removeItem(key);
                } catch {
                  // Ignore storage access errors
                }
                writeCookieSafe(key, '', 0);
              },
            }
          : undefined,
    },
  });

  return browserClientInstance;
}
