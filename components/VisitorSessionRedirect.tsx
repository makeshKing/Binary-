'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/types';
import { isRealAuthenticatedUser, sanitizeNextPath } from '@/lib/supabase/auth-utils';

export function VisitorSessionRedirect({
  destination = '/dashboard',
  nextParam,
}: {
  destination?: string;
  nextParam?: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let isMounted = true;
    const supabase = createClient();

    async function checkExistingSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (session?.user && isRealAuthenticatedUser(session.user)) {
        const target = sanitizeNextPath(nextParam, destination);
        router.replace(target);
      } else if (session?.user?.is_anonymous) {
        await supabase.auth.signOut().catch(() => {});
      }
    }

    void checkExistingSession();

    return () => {
      isMounted = false;
    };
  }, [destination, nextParam, router]);

  return null;
}
