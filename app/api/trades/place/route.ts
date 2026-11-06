import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/types';
import { DEFAULT_USDT_NPR_RATE } from '@/lib/currency';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = String(body.symbol || '').trim();
    const direction = String(body.direction || '').trim().toUpperCase();
    const amount = Number(body.amount);
    const expirySeconds = Number(body.expirySeconds);

    if (!symbol || (direction !== 'CALL' && direction !== 'PUT')) {
      return NextResponse.json(
        { error: 'Invalid symbol or direction' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amount) || amount < 0.5 || amount > 1000) {
      return NextResponse.json(
        { error: 'Trade amount must be between $0.50 and $1,000.00 (min Rs 150)' },
        { status: 400 }
      );
    }

    if (![30, 60, 120, 300].includes(expirySeconds)) {
      return NextResponse.json(
        { error: 'Invalid expiry duration' },
        { status: 400 }
      );
    }

    const userSupabase = await createClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Authentication required to place a trade' },
        { status: 401 }
      );
    }

    const { url } = getSupabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const adminSupabase =
      url && serviceRoleKey
        ? createSupabaseClient(url, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : userSupabase;

    const { data: asset } = await adminSupabase
      .from('assets')
      .select('*')
      .eq('symbol', symbol)
      .eq('is_active', true)
      .maybeSingle();

    if (!asset) {
      return NextResponse.json(
        { error: `Asset ${symbol} is not found or currently inactive` },
        { status: 404 }
      );
    }

    const { data: tickData } = await adminSupabase
      .from('price_ticks')
      .select('price')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const entryPrice = tickData?.price ? Number(tickData.price) : 0;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return NextResponse.json(
        { error: `Server price feed unavailable for ${symbol}` },
        { status: 503 }
      );
    }

    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: 'Trader profile not found' },
        { status: 404 }
      );
    }

    if ((profile.status || 'ACTIVE') !== 'ACTIVE') {
      return NextResponse.json(
        { error: `Your account status is ${profile.status}. Only ACTIVE accounts can place trades.` },
        { status: 403 }
      );
    }

    const currentBalance = Number(profile.balance);
    const cleanAmount = Number(amount.toFixed(2));
    if (currentBalance < cleanAmount) {
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 400 }
      );
    }

    const { count: openCount } = await adminSupabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'OPEN');

    if ((openCount ?? 0) >= 10) {
      return NextResponse.json(
        { error: 'Maximum limit of 10 concurrent open trades reached' },
        { status: 400 }
      );
    }

    const { data: rateRow } = await adminSupabase
      .from('exchange_rates')
      .select('rate')
      .eq('base', 'USDT')
      .eq('quote', 'NPR')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fxRate = rateRow?.rate ? Number(rateRow.rate) : DEFAULT_USDT_NPR_RATE;
    const displayCurrency =
      profile.preferred_currency === 'NPR' ? 'NPR' : 'USDT';

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expirySeconds * 1000);
    const nextBalance = Number((currentBalance - cleanAmount).toFixed(2));

    const { error: balErr } = await adminSupabase
      .from('profiles')
      .update({ balance: nextBalance })
      .eq('id', user.id);

    if (balErr) {
      return NextResponse.json(
        { error: balErr.message || 'Could not deduct trade stake' },
        { status: 500 }
      );
    }

    const { data: insertedTrade, error: tradeErr } = await adminSupabase
      .from('trades')
      .insert({
        user_id: user.id,
        asset_id: asset.id,
        direction,
        amount: cleanAmount,
        entry_price: entryPrice,
        payout_percent: asset.payout_percent ?? 85,
        opened_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        status: 'OPEN',
        fx_rate_used: fxRate,
        display_currency: displayCurrency,
      })
      .select('*')
      .single();

    if (tradeErr || !insertedTrade) {
      // Roll back balance deduction if insert failed (e.g. legacy table check constraint)
      await adminSupabase
        .from('profiles')
        .update({ balance: currentBalance })
        .eq('id', user.id);

      return NextResponse.json(
        { error: tradeErr?.message || 'Could not insert trade' },
        { status: 400 }
      );
    }

    return NextResponse.json({ trade: insertedTrade });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
