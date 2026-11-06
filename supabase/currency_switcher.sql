-- =============================================================================
-- CURRENCY SWITCHER (USDT / NPR) — SAFE-TO-RE-RUN IDEMPOTENT SQL MIGRATION
-- Base stored currency: USDT (all balances, trades, wallet_requests, ledger)
-- Display & entry currencies: USDT ($1,000.00) and NPR (Rs 13,450.00)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. TABLE: public.currencies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY CHECK (code IN ('USDT', 'NPR')),
  symbol text NOT NULL,
  decimals integer NOT NULL DEFAULT 2 CHECK (decimals = 2),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 1
);

INSERT INTO public.currencies (code, symbol, decimals, is_active, display_order)
VALUES
  ('USDT', '$',   2, true, 1),
  ('NPR',  'Rs ', 2, true, 2)
ON CONFLICT (code) DO UPDATE
SET
  symbol = EXCLUDED.symbol,
  decimals = EXCLUDED.decimals,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;

-- -----------------------------------------------------------------------------
-- 2. TABLE: public.exchange_rates (Append-Only; latest row is active rate)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base text NOT NULL DEFAULT 'USDT' CHECK (base = 'USDT'),
  quote text NOT NULL DEFAULT 'NPR' CHECK (quote = 'NPR'),
  rate numeric(12, 4) NOT NULL CHECK (rate > 0 AND rate BETWEEN 1 AND 1000),
  reason text NOT NULL DEFAULT 'Initial exchange rate seed',
  set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  set_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'Initial exchange rate seed';

ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS set_by_email text;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_created_desc
  ON public.exchange_rates (created_at DESC, id DESC);

-- Enforce append-only immutability on exchange_rates
CREATE OR REPLACE FUNCTION public.prevent_exchange_rates_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'exchange_rates is append-only: UPDATE and DELETE are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trg_exchange_rates_immutable ON public.exchange_rates;
CREATE TRIGGER trg_exchange_rates_immutable
  BEFORE UPDATE OR DELETE ON public.exchange_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_exchange_rates_mutation();

-- Seed default rate 1 USDT = Rs 134.50 if no rate exists yet
INSERT INTO public.exchange_rates (base, quote, rate, reason, set_by, set_by_email)
SELECT 'USDT', 'NPR', 134.5000, 'Initial default exchange rate (1 USDT = Rs 134.50)', NULL, 'system'
WHERE NOT EXISTS (SELECT 1 FROM public.exchange_rates);

-- -----------------------------------------------------------------------------
-- 3. COLUMNS ON public.profiles AND public.trades
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_currency text NOT NULL DEFAULT 'USDT';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_currency_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_currency_check
  CHECK (preferred_currency IN ('USDT', 'NPR'));

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS display_currency text NOT NULL DEFAULT 'USDT';

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_display_currency_check;

ALTER TABLE public.trades
  ADD CONSTRAINT trades_display_currency_check
  CHECK (display_currency IN ('USDT', 'NPR'));

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS fx_rate_used numeric(12, 4) NOT NULL DEFAULT 134.5000;

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_fx_rate_used_check;

ALTER TABLE public.trades
  ADD CONSTRAINT trades_fx_rate_used_check
  CHECK (fx_rate_used > 0);

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) & TABLE GRANTS
-- -----------------------------------------------------------------------------
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS currencies_select_authenticated ON public.currencies;
CREATE POLICY currencies_select_authenticated
  ON public.currencies
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS exchange_rates_select_authenticated ON public.exchange_rates;
CREATE POLICY exchange_rates_select_authenticated
  ON public.exchange_rates
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS exchange_rates_insert_admin ON public.exchange_rates;
CREATE POLICY exchange_rates_insert_admin
  ON public.exchange_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_admin_role('ADMIN'));

GRANT SELECT ON public.currencies TO authenticated, anon;
GRANT SELECT ON public.exchange_rates TO authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.currencies FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.exchange_rates FROM anon;

-- -----------------------------------------------------------------------------
-- 5. FUNCTIONS: get_current_rate, set_preferred_currency, admin_set_exchange_rate
-- -----------------------------------------------------------------------------

-- 5.1 get_current_rate(): Returns latest active USDT -> NPR rate
CREATE OR REPLACE FUNCTION public.get_current_rate()
RETURNS numeric(12, 4)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric(12, 4);
BEGIN
  SELECT rate
  INTO v_rate
  FROM public.exchange_rates
  WHERE base = 'USDT' AND quote = 'NPR'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'Active exchange rate is missing';
  END IF;

  RETURN v_rate;
END;
$$;

-- 5.2 set_preferred_currency(p_code): Users can change only their own preferred_currency
CREATE OR REPLACE FUNCTION public.set_preferred_currency(
  p_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_clean_code text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to change preferred currency';
  END IF;

  v_clean_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_clean_code NOT IN ('USDT', 'NPR') THEN
    RAISE EXCEPTION 'Invalid currency code: must be USDT or NPR';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.currencies WHERE code = v_clean_code AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Currency % is not active', v_clean_code;
  END IF;

  UPDATE public.profiles
  SET preferred_currency = v_clean_code
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  RETURN v_clean_code;
END;
$$;

-- 5.3 admin_set_exchange_rate(p_rate, p_reason, p_superadmin_confirm):
-- ADMIN or SUPERADMIN only. Rate must be between 1 and 1000.
-- Rejects changes > 20% from current rate unless caller is SUPERADMIN and p_superadmin_confirm = true.
-- Writes an admin_audit_log row with before/after rate and reason.
CREATE OR REPLACE FUNCTION public.admin_set_exchange_rate(
  p_rate numeric,
  p_reason text,
  p_superadmin_confirm boolean DEFAULT false
)
RETURNS public.exchange_rates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_email text;
  v_is_superadmin boolean;
  v_clean_rate numeric(12, 4);
  v_clean_reason text;
  v_current_rate numeric(12, 4);
  v_pct_change numeric(12, 4) := 0;
  v_inserted public.exchange_rates%ROWTYPE;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_admin_role('ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required to set exchange rate';
  END IF;

  v_is_superadmin := public.has_admin_role('SUPERADMIN');
  SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;

  IF p_rate IS NULL OR p_rate < 1 OR p_rate > 1000 THEN
    RAISE EXCEPTION 'Invalid exchange rate: must be between 1.0000 and 1000.0000';
  END IF;

  v_clean_rate := ROUND(p_rate, 4);

  v_clean_reason := NULLIF(LEFT(TRIM(COALESCE(p_reason, '')), 280), '');
  IF v_clean_reason IS NULL OR char_length(v_clean_reason) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required when updating the exchange rate';
  END IF;

  SELECT rate
  INTO v_current_rate
  FROM public.exchange_rates
  WHERE base = 'USDT' AND quote = 'NPR'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_current_rate IS NOT NULL AND v_current_rate > 0 THEN
    v_pct_change := ROUND((ABS(v_clean_rate - v_current_rate) / v_current_rate) * 100.0, 4);

    IF v_pct_change > 20.0000 THEN
      IF NOT v_is_superadmin THEN
        RAISE EXCEPTION 'Exchange rate change of %% exceeds the 20%% safety threshold. Only a SUPERADMIN can confirm changes larger than 20%%.', TO_CHAR(v_pct_change, 'FM990.00');
      END IF;

      IF COALESCE(p_superadmin_confirm, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'SUPERADMIN confirmation required: rate change of %% exceeds 20%%. Pass p_superadmin_confirm = true to confirm.', TO_CHAR(v_pct_change, 'FM990.00');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.exchange_rates (
    base,
    quote,
    rate,
    reason,
    set_by,
    set_by_email,
    created_at
  )
  VALUES (
    'USDT',
    'NPR',
    v_clean_rate,
    v_clean_reason,
    v_admin_id,
    v_admin_email,
    now()
  )
  RETURNING * INTO v_inserted;

  INSERT INTO public.admin_audit_log (
    admin_id,
    admin_email,
    action,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    v_admin_id,
    v_admin_email,
    'EXCHANGE_RATE_UPDATED',
    'exchange_rates',
    v_inserted.id::text,
    jsonb_build_object(
      'base', 'USDT',
      'quote', 'NPR',
      'before_rate', v_current_rate,
      'after_rate', v_clean_rate,
      'percent_change', v_pct_change,
      'reason', v_clean_reason,
      'superadmin_confirmed', COALESCE(p_superadmin_confirm, false)
    )
  );

  RETURN v_inserted;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. UPDATE place_trade: Client sends amount in BASE UNITS (USDT) only.
--    Server snapshots fx_rate_used and display_currency on the trade row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_trade(
  p_symbol text,
  p_direction text,
  p_amount numeric,
  p_expiry_seconds integer
)
RETURNS public.trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_asset public.assets%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_entry_price numeric(18, 6);
  v_open_count integer;
  v_new_balance numeric(14, 2);
  v_fx_rate numeric(12, 4);
  v_display_currency text;
  v_trade public.trades%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to place a trade';
  END IF;

  IF p_direction NOT IN ('CALL', 'PUT') THEN
    RAISE EXCEPTION 'Invalid direction: must be CALL or PUT';
  END IF;

  IF p_amount IS NULL OR p_amount < 0.50 OR p_amount > 1000.00 THEN
    RAISE EXCEPTION 'Invalid trade amount: must be between 0.50 and 1000.00 USDT';
  END IF;

  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Invalid trade amount: maximum 2 decimal places allowed';
  END IF;

  IF p_expiry_seconds NOT IN (30, 60, 120, 300) THEN
    RAISE EXCEPTION 'Invalid expiry: allowed values are 30, 60, 120, or 300 seconds';
  END IF;

  SELECT *
  INTO v_asset
  FROM public.assets
  WHERE symbol = p_symbol
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % is not found or currently inactive', p_symbol;
  END IF;

  SELECT price
  INTO v_entry_price
  FROM public.price_ticks
  WHERE asset_id = v_asset.id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_entry_price IS NULL OR v_entry_price <= 0 THEN
    RAISE EXCEPTION 'Server price feed unavailable for %', p_symbol;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trader profile not found';
  END IF;

  IF COALESCE(v_profile.status, 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Your account status is %. Only ACTIVE accounts can place trades.', v_profile.status;
  END IF;

  SELECT COUNT(*)
  INTO v_open_count
  FROM public.trades
  WHERE user_id = v_user_id
    AND status = 'OPEN';

  IF v_open_count >= 10 THEN
    RAISE EXCEPTION 'Maximum limit of 10 concurrent open trades reached';
  END IF;

  IF v_profile.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance (Available: % USDT, Required: % USDT)', v_profile.balance, p_amount;
  END IF;

  v_fx_rate := public.get_current_rate();
  v_display_currency := CASE
    WHEN v_profile.preferred_currency IN ('USDT', 'NPR') THEN v_profile.preferred_currency
    ELSE 'USDT'
  END;

  v_new_balance := ROUND(v_profile.balance - p_amount, 2);

  UPDATE public.profiles
  SET balance = v_new_balance
  WHERE id = v_user_id;

  INSERT INTO public.trades (
    user_id,
    asset_id,
    direction,
    amount,
    entry_price,
    payout_percent,
    opened_at,
    expires_at,
    status,
    display_currency,
    fx_rate_used
  )
  VALUES (
    v_user_id,
    v_asset.id,
    p_direction,
    ROUND(p_amount, 2),
    v_entry_price,
    v_asset.payout_percent,
    v_now,
    v_now + (p_expiry_seconds || ' seconds')::interval,
    'OPEN',
    v_display_currency,
    v_fx_rate
  )
  RETURNING * INTO v_trade;

  INSERT INTO public.balance_ledger (
    user_id,
    user_number,
    trade_id,
    type,
    entry_type,
    amount,
    delta,
    note,
    balance_after,
    created_at
  )
  VALUES (
    v_user_id,
    v_profile.user_number,
    v_trade.id,
    'TRADE_OPEN',
    'TRADE_OPEN',
    -ROUND(p_amount, 2),
    -ROUND(p_amount, 2),
    format('Opened %s trade on %s (%s @ %s)', p_direction, p_symbol, v_display_currency, v_fx_rate),
    v_new_balance,
    v_now
  );

  RETURN v_trade;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. FUNCTION GRANTS & REALTIME PUBLICATION
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_current_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_rate() TO authenticated, anon;

REVOKE ALL ON FUNCTION public.set_preferred_currency(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_preferred_currency(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_exchange_rate(numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_exchange_rate(numeric, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.place_trade(text, text, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_trade(text, text, numeric, integer) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'exchange_rates'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.exchange_rates;
    END IF;
  END IF;
END;
$$;

COMMIT;
