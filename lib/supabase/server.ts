import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './types';

const FALLBACK_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();
  const supabaseUrl = url || FALLBACK_URL;
  const supabaseAnonKey = anonKey || FALLBACK_KEY;

  const isHttps = (process.env.APP_URL || '').startsWith('https://');

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore
          .getAll()
          .filter(
            (c) =>
              c.name !== 'sb-admin-auth' &&
              !c.name.startsWith('sb-admin-auth.') &&
              !c.name.startsWith('sb-admin-auth-')
          );
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              sameSite: isHttps ? 'none' : (options?.sameSite ?? 'lax'),
              secure: isHttps ? true : options?.secure,
            })
          );
        } catch {
          // Ignored when called from a Server Component render pass
        }
      },
    },
  });
}
