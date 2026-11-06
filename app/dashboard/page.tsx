import { redirect } from 'next/navigation';
import { TradingTerminal } from '@/components/TradingTerminal';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    redirect('/login?next=%2Fdashboard');
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.id || user.is_anonymous === true) {
    redirect('/login?next=%2Fdashboard');
  }

  return <TradingTerminal />;
}
