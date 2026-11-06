import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, LeaderboardRow } from '@/lib/supabase/types';
import {
  LeaderboardClientView,
  LeaderboardDisplayItem,
} from '@/components/LeaderboardClientTable';

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  if (!isSupabaseConfigured()) {
    redirect('/login?next=%2Fleaderboard');
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !user.id || user.is_anonymous === true) {
    redirect('/login?next=%2Fleaderboard');
  }

  let leaderboardRows: LeaderboardDisplayItem[] = [];

  try {
    const { data } = await supabase.rpc('get_leaderboard_7d');

    if (Array.isArray(data)) {
      leaderboardRows = (data as LeaderboardRow[]).map((row, idx) => {
        const profitNum = Number(row.total_profit ?? 0);
        const volumeNum = Number(row.total_volume ?? 0);
        const balanceNum = Number(row.current_balance ?? 0);
        return {
          rank: Number(row.rank ?? idx + 1),
          userId: row.user_id,
          name: row.trader_name || 'Trader',
          tradesCount: Number(row.settled_trades ?? 0),
          totalVolumeNum: volumeNum,
          totalProfitNum: profitNum,
          currentBalanceNum: balanceNum,
        };
      });
    }
  } catch {
    // Fallback to empty state if RPC not yet created
  }

  return <LeaderboardClientView rows={leaderboardRows} />;
}
