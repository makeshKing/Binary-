-- =============================================================================
-- PULSEOPTION VOLATILITY & NATURAL MARKET MOVEMENT MIGRATION
-- =============================================================================
-- 1. Defines assets.volatility as PERCENT PER 1-SECOND TICK (safe range: 0.001 to 0.2)
-- 2. Sets starting volatility values:
--      BTC/USD : 0.020 (% per 1s tick)
--      ETH/USD : 0.025 (% per 1s tick)
--      EUR/USD : 0.004 (% per 1s tick)
--      GOLD    : 0.010 (% per 1s tick)
-- 3. Adds state columns on public.assets for:
--      - Slow-moving anchor price (anchor_price) with gentle mean reversion & +/-3% clamp
--      - Light momentum (last_return: 85% fresh Box-Muller normal noise + 15% previous move)
--      - Occasional volatility bursts (1.5x to 2.5x for 10 to 20s every 2 to 4 minutes)
-- 4. Replaces public.tick_prices() and public.generate_ticks() with zero-drift
--    Box-Muller normal random walk (strictly independent of trades/balances).
-- =============================================================================

-- 1. Update check constraint on public.assets.volatility to allow 0.001 to 0.2 (% per 1s tick)
DO $$
DECLARE
  r_con RECORD;
BEGIN
  FOR r_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.assets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%volatility%'
  LOOP
    EXECUTE format('ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS %I', r_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.assets
  ALTER COLUMN volatility SET DEFAULT 0.020000;

-- Add simulation state columns on public.assets if they do not exist yet
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS anchor_price numeric(18, 6),
  ADD COLUMN IF NOT EXISTS last_return numeric(18, 10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS burst_until timestamptz,
  ADD COLUMN IF NOT EXISTS burst_multiplier numeric(8, 4) NOT NULL DEFAULT 1.0000,
  ADD COLUMN IF NOT EXISTS next_burst_at timestamptz;

-- 2. Set starting volatility values (PERCENT PER 1-SECOND TICK) and initialize anchor prices
UPDATE public.assets
SET
  volatility = CASE symbol
    WHEN 'BTC/USD' THEN 0.020000
    WHEN 'ETH/USD' THEN 0.025000
    WHEN 'EUR/USD' THEN 0.004000
    WHEN 'GOLD'    THEN 0.010000
    ELSE LEAST(0.200000, GREATEST(0.001000, volatility))
  END,
  anchor_price = COALESCE(
    anchor_price,
    (
      SELECT pt.price
      FROM public.price_ticks pt
      WHERE pt.asset_id = public.assets.id
      ORDER BY pt.created_at DESC, pt.id DESC
      LIMIT 1
    ),
    CASE symbol
      WHEN 'BTC/USD' THEN 89420.500000
      WHEN 'ETH/USD' THEN 3185.250000
      WHEN 'EUR/USD' THEN 1.084200
      WHEN 'GOLD'    THEN 2745.800000
      ELSE 100.000000
    END
  ),
  last_return = 0,
  burst_until = NULL,
  burst_multiplier = 1.0000,
  next_burst_at = now() + ((120.0 + random() * 120.0) || ' seconds')::interval;

-- Add safe range constraint (0.001 to 0.2 percent per 1-second tick)
ALTER TABLE public.assets
  ADD CONSTRAINT assets_volatility_check
  CHECK (volatility >= 0.001000 AND volatility <= 0.200000);

-- 3. Create public.tick_prices() with:
--    - Zero-drift random walk (strictly independent of trades, user balances, or directions)
--    - Box-Muller normal distribution N(0, 1)
--    - Light momentum: 85% fresh random noise + 15% previous tick move
--    - Occasional volatility bursts: every 2–4 min (120–240s), volatility * 1.5..2.5 for 10–20s
--    - Gentle mean reversion toward slow-moving anchor_price + hard clamp of +/-3% from anchor
--    - Precision: 2 decimals for BTC/ETH/GOLD, 4 decimals for EUR/USD, never <= 0
CREATE OR REPLACE FUNCTION public.tick_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_asset RECORD;
  v_now timestamptz := now();
  v_last_price numeric(18, 6);
  v_anchor numeric(18, 6);
  v_decimals integer;
  v_min_price numeric(18, 6);
  v_u1 double precision;
  v_u2 double precision;
  v_z double precision;
  v_vol_pct double precision;
  v_burst_mult double precision;
  v_burst_until timestamptz;
  v_next_burst_at timestamptz;
  v_burst_duration double precision;
  v_sigma double precision;
  v_fresh_noise double precision;
  v_momentum_move double precision;
  v_deviation double precision;
  v_reversion double precision;
  v_total_return double precision;
  v_raw_next numeric(18, 6);
  v_clamped_next numeric(18, 6);
  v_next_price numeric(18, 6);
BEGIN
  FOR r_asset IN
    SELECT
      id,
      symbol,
      volatility,
      anchor_price,
      last_return,
      burst_until,
      burst_multiplier,
      next_burst_at
    FROM public.assets
    WHERE is_active = true
  LOOP
    -- 1. Fetch latest tick price for this asset
    SELECT price
    INTO v_last_price
    FROM public.price_ticks
    WHERE asset_id = r_asset.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_last_price IS NULL OR v_last_price <= 0 THEN
      v_last_price := CASE r_asset.symbol
        WHEN 'BTC/USD' THEN 89420.500000
        WHEN 'ETH/USD' THEN 3185.250000
        WHEN 'EUR/USD' THEN 1.084200
        WHEN 'GOLD'    THEN 2745.800000
        ELSE 100.000000
      END;
    END IF;

    v_decimals := CASE WHEN r_asset.symbol = 'EUR/USD' THEN 4 ELSE 2 END;
    v_min_price := power(10.0::numeric, -v_decimals);

    -- 2. Initialize or slowly update the anchor price (EMA alpha = 0.0003 per 1s tick)
    v_anchor := COALESCE(r_asset.anchor_price, v_last_price);
    IF v_anchor <= 0 THEN
      v_anchor := v_last_price;
    ELSE
      v_anchor := ROUND((0.9997 * v_anchor) + (0.0003 * v_last_price), 6);
    END IF;

    -- 3. Manage occasional small volatility bursts:
    --    Once every 2 to 4 minutes (120 to 240s), multiply volatility by 1.5 to 2.5
    --    for 10 to 20 seconds, then return to normal (1.0).
    v_burst_until := r_asset.burst_until;
    v_next_burst_at := r_asset.next_burst_at;
    v_burst_mult := COALESCE(r_asset.burst_multiplier, 1.0);

    IF v_burst_until IS NOT NULL AND v_now < v_burst_until THEN
      -- Currently inside an active burst window
      v_burst_mult := LEAST(2.5, GREATEST(1.5, v_burst_mult));
    ELSE
      -- Not currently in a burst; check if it is time to trigger a new burst
      IF v_next_burst_at IS NULL THEN
        v_burst_mult := 1.0;
        v_burst_until := NULL;
        v_next_burst_at := v_now + ((120.0 + random() * 120.0) || ' seconds')::interval;
      ELSIF v_now >= v_next_burst_at THEN
        -- Start a new 10 to 20 second volatility burst (1.5x to 2.5x)
        v_burst_mult := 1.5 + (random() * 1.0);
        v_burst_duration := 10.0 + (random() * 10.0);
        v_burst_until := v_now + (v_burst_duration || ' seconds')::interval;
        -- Schedule the next burst 2 to 4 minutes after this burst ends
        v_next_burst_at := v_burst_until + ((120.0 + random() * 120.0) || ' seconds')::interval;
      ELSE
        v_burst_mult := 1.0;
        v_burst_until := NULL;
      END IF;
    END IF;

    -- 4. Box-Muller transform for standard normal random variable Z ~ N(0, 1)
    --    Zero drift: mean is strictly 0.0, independent of any trades or balances.
    v_u1 := GREATEST(1e-12, LEAST(1.0 - 1e-12, random()));
    v_u2 := random();
    v_z := sqrt(-2.0 * ln(v_u1)) * cos(2.0 * pi() * v_u2);
    v_z := LEAST(4.0, GREATEST(-4.0, v_z));

    -- 5. Convert assets.volatility (percent per 1-second tick) to fractional sigma
    v_vol_pct := LEAST(0.200000, GREATEST(0.001000, r_asset.volatility::double precision));
    v_sigma := (v_vol_pct / 100.0) * v_burst_mult;

    -- 6. Light momentum: 85% fresh random noise + 15% previous tick's move
    v_fresh_noise := v_sigma * v_z;
    v_momentum_move := (0.85 * v_fresh_noise) + (0.15 * COALESCE(r_asset.last_return::double precision, 0.0));

    -- 7. Very gentle mean reversion toward the slow-moving anchor price
    v_deviation := ((v_last_price - v_anchor) / v_anchor)::double precision;
    v_reversion := -0.0015 * v_deviation;

    v_total_return := v_momentum_move + v_reversion;

    -- 8. Compute next price with hard clamp of +/-3% from the anchor price
    v_raw_next := v_last_price * (1.0 + v_total_return)::numeric;
    v_clamped_next := LEAST(v_anchor * 1.030000, GREATEST(v_anchor * 0.970000, v_raw_next));
    v_next_price := GREATEST(v_min_price, ROUND(v_clamped_next, v_decimals));

    -- 9. Persist state on public.assets and insert tick into public.price_ticks
    UPDATE public.assets
    SET
      anchor_price = v_anchor,
      last_return = ROUND(v_momentum_move::numeric, 10),
      burst_until = v_burst_until,
      burst_multiplier = ROUND(v_burst_mult::numeric, 4),
      next_burst_at = v_next_burst_at
    WHERE id = r_asset.id;

    INSERT INTO public.price_ticks (asset_id, price, created_at)
    VALUES (r_asset.id, v_next_price, v_now);
  END LOOP;
END;
$$;

-- Keep public.generate_ticks() as a direct wrapper around public.tick_prices()
-- so existing cron jobs and RPC calls work seamlessly.
CREATE OR REPLACE FUNCTION public.generate_ticks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.tick_prices();
END;
$$;

GRANT EXECUTE ON FUNCTION public.tick_prices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ticks() TO authenticated;

-- =============================================================================
-- 4. VERIFICATION SQL QUERY:
--    Checks average 30-second candle range (high - low) over the last 30 minutes
--    per asset, alongside min/max candle range and percentage range.
-- =============================================================================
/*
WITH candle_buckets AS (
  SELECT
    a.symbol,
    a.volatility AS volatility_pct_per_tick,
    floor(extract(epoch FROM pt.created_at) / 30) * 30 AS bucket_epoch,
    MAX(pt.price) - MIN(pt.price) AS candle_range,
    AVG(pt.price) AS avg_candle_price,
    COUNT(*) AS ticks_in_candle
  FROM public.price_ticks pt
  JOIN public.assets a ON a.id = pt.asset_id
  WHERE pt.created_at >= now() - interval '30 minutes'
  GROUP BY a.symbol, a.volatility, floor(extract(epoch FROM pt.created_at) / 30) * 30
)
SELECT
  symbol,
  volatility_pct_per_tick,
  COUNT(*) AS candle_count_30m,
  ROUND(AVG(ticks_in_candle), 1) AS avg_ticks_per_candle,
  CASE WHEN symbol = 'EUR/USD'
    THEN ROUND(AVG(candle_range), 4)
    ELSE ROUND(AVG(candle_range), 2)
  END AS avg_candle_range_usd,
  CASE WHEN symbol = 'EUR/USD'
    THEN ROUND(MIN(candle_range), 4)
    ELSE ROUND(MIN(candle_range), 2)
  END AS min_candle_range_usd,
  CASE WHEN symbol = 'EUR/USD'
    THEN ROUND(MAX(candle_range), 4)
    ELSE ROUND(MAX(candle_range), 2)
  END AS max_candle_range_usd,
  ROUND(AVG((candle_range / NULLIF(avg_candle_price, 0)) * 100.0), 4) AS avg_candle_range_pct,
  ROUND((volatility_pct_per_tick * sqrt(30.0))::numeric, 4) AS theoretical_sigma_30s_pct
FROM candle_buckets
GROUP BY symbol, volatility_pct_per_tick
ORDER BY symbol;
*/
