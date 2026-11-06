import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/types';
import { VisitorSessionRedirect } from '@/components/VisitorSessionRedirect';
import { LandingUsagePage } from '@/components/LandingUsagePage';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && user.id && user.is_anonymous !== true) {
        redirect('/admin/settings/payment-details');
      }
    } catch {
      // Fall through to visitor landing page
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[#121212] text-[#ededed]">
      <VisitorSessionRedirect destination="/admin/settings/payment-details" />
      <LandingUsagePage />
    </div>
  );
}

