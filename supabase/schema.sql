-- =============================================================================
-- supabase/schema.sql
-- Complete Supabase Backend for PulseOption / QUOTEX Demo Binary-Options Platform
-- Includes:
--   1. Core Trading Tables (profiles, assets, price_ticks, trades, balance_ledger)
--   2. Extended User Profile & Simulated Virtual Wallet (wallet_requests + avatars Storage)
--   3. Triggers, Indexes, Seed Assets & Initial Ticks
--   4. SECURITY DEFINER RPC Functions (generate_ticks, place_trade, settle_expired_trades,
--      reset_demo_balance, request_deposit, request_withdraw, admin_review_request,
--      update_profile, get_leaderboard_7d)
--   5. pg_cron Schedules
--   6. Strict Row Level Security (RLS) & Storage Policies
--   7. Supabase Realtime Publications
--   8. Security Verification Test Suite
--
-- NOTICE: Virtual credits only. No real money.
-- Paste this entire file into the Supabase SQL Editor and click "Run".
-- =============================================================================

-- 0. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA extensions;

-- =============================================================================
-- 1. TABLES & NON-DESTRUCTIVE MIGRATIONS
-- =============================================================================

-- 1.1 profiles (1-to-1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_number integer UNIQUE CHECK (user_number BETWEEN 10000 AND 99999),
  email text,
  name text NOT NULL DEFAULT 'Trader',
  display_name text NOT NULL DEFAULT 'Trader',
  avatar_url text,
  country text DEFAULT 'United States',
  phone text,
  balance numeric(14, 2) NOT NULL DEFAULT 10000.00 CHECK (balance >= 0),
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('user', 'admin', 'USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  is_admin boolean NOT NULL DEFAULT false,
  last_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure columns & updated constraints exist if upgrading an existing profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_number integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Trader';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text DEFAULT 'United States';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Generate unique 5-digit User ID (10000..99999) with up to 50 retry attempts
CREATE OR REPLACE FUNCTION public.generate_user_number()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate integer;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..50 LOOP
    v_candidate := floor(10000 + random() * 90000)::integer;
    IF v_candidate < 10000 THEN
      v_candidate := 10000;
    ELSIF v_candidate > 99999 THEN
      v_candidate := 99999;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE user_number = v_candidate
    ) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Unable to generate a unique 5-digit user_number after 50 attempts';
END;
$$;

DO $$
DECLARE
  r_prof RECORD;
  v_try integer;
  v_num integer;
  v_assigned boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_user_number_range_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_number_range_check
      CHECK (user_number BETWEEN 10000 AND 99999);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_user_number_key'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_number_key UNIQUE (user_number);
  END IF;

  FOR r_prof IN
    SELECT id FROM public.profiles
    WHERE user_number IS NULL OR user_number < 10000 OR user_number > 99999
  LOOP
    v_assigned := false;
    FOR v_try IN 1..50 LOOP
      BEGIN
        v_num := public.generate_user_number();
        UPDATE public.profiles SET user_number = v_num WHERE id = r_prof.id;
        v_assigned := true;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
    IF NOT v_assigned THEN
      RAISE EXCEPTION 'Backfill failed to assign unique 5-digit user_number for %', r_prof.id;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN user_number SET DEFAULT public.generate_user_number(),
  ALTER COLUMN user_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_number
  ON public.profiles (user_number);

CREATE OR REPLACE FUNCTION public.assign_profile_user_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_number IS NULL THEN
    NEW.user_number := public.generate_user_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_profile_user_number ON public.profiles;
CREATE TRIGGER trg_assign_profile_user_number
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_profile_user_number();

CREATE OR REPLACE FUNCTION public.prevent_user_number_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_number IS NOT NULL AND NEW.user_number IS DISTINCT FROM OLD.user_number THEN
    RAISE EXCEPTION 'user_number is immutable and cannot be modified (current: %, attempted: %)', OLD.user_number, NEW.user_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_user_number_change ON public.profiles;
CREATE TRIGGER trg_prevent_user_number_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_number_change();

DO $$
DECLARE
  r_con RECORD;
BEGIN
  FOR r_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%role%' OR pg_get_constraintdef(oid) ILIKE '%status%')
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', r_con.conname);
  END LOOP;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('user', 'admin', 'USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN'));

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_status_check
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Normalize legacy lowercase roles to uppercase RBAC roles
UPDATE public.profiles SET role = 'ADMIN', is_admin = true WHERE role = 'admin';
UPDATE public.profiles SET role = 'USER', is_admin = false WHERE role = 'user' AND is_admin = false;
UPDATE public.profiles SET role = 'ADMIN', is_admin = true WHERE role = 'user' AND is_admin = true;

-- Keep role, status, and is_admin synchronized automatically
CREATE OR REPLACE FUNCTION public.sync_profile_admin_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.role := 'ADMIN';
  ELSIF NEW.role = 'user' THEN
    NEW.role := CASE WHEN NEW.is_admin = true THEN 'ADMIN' ELSE 'USER' END;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('ACTIVE', 'SUSPENDED', 'DISABLED') THEN
    NEW.status := 'ACTIVE';
  END IF;

  IF NEW.role IN ('SUPPORT', 'ADMIN', 'SUPERADMIN') THEN
    NEW.is_admin := true;
  ELSIF NEW.is_admin = true AND NEW.role = 'USER' THEN
    NEW.role := 'ADMIN';
    NEW.is_admin := true;
  ELSE
    NEW.role := 'USER';
    NEW.is_admin := false;
  END IF;

  IF NEW.display_name IS NOT NULL AND TRIM(NEW.display_name) <> '' THEN
    NEW.name := TRIM(NEW.display_name);
  ELSIF NEW.name IS NOT NULL AND TRIM(NEW.name) <> '' THEN
    NEW.display_name := TRIM(NEW.name);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_admin_flags ON public.profiles;
CREATE TRIGGER trg_sync_profile_admin_flags
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_admin_flags();

-- 1.2 assets (volatility is stored as PERCENT PER 1-SECOND TICK, valid range 0.001 to 0.2)
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text UNIQUE NOT NULL,
  name text NOT NULL,
  volatility numeric(10, 6) NOT NULL DEFAULT 0.020000 CHECK (volatility >= 0.001000 AND volatility <= 0.200000),
  payout_percent integer NOT NULL DEFAULT 85 CHECK (payout_percent BETWEEN 1 AND 100),
  anchor_price numeric(18, 6),
  last_return numeric(18, 10) NOT NULL DEFAULT 0,
  burst_until timestamptz,
  burst_multiplier numeric(8, 4) NOT NULL DEFAULT 1.0000,
  next_burst_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Safe idempotent migration for existing assets table
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
  ALTER COLUMN volatility SET DEFAULT 0.020000,
  ADD COLUMN IF NOT EXISTS anchor_price numeric(18, 6),
  ADD COLUMN IF NOT EXISTS last_return numeric(18, 10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS burst_until timestamptz,
  ADD COLUMN IF NOT EXISTS burst_multiplier numeric(8, 4) NOT NULL DEFAULT 1.0000,
  ADD COLUMN IF NOT EXISTS next_burst_at timestamptz;

-- 1.3 price_ticks
CREATE TABLE IF NOT EXISTS public.price_ticks (
  id bigserial PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  price numeric(18, 6) NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.4 trades
CREATE TABLE IF NOT EXISTS public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('CALL', 'PUT')),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0.50 AND amount <= 1000.00),
  entry_price numeric(18, 6) NOT NULL CHECK (entry_price > 0),
  exit_price numeric(18, 6),
  payout_percent integer NOT NULL DEFAULT 85 CHECK (payout_percent BETWEEN 1 AND 100),
  opened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WON', 'LOST', 'DRAW')),
  profit numeric(14, 2)
);

-- 1.5 wallet_requests (Simulated Virtual Credits Wallet: DEPOSIT | WITHDRAW)
CREATE TABLE IF NOT EXISTS public.wallet_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_number integer,
  type text NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAW')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  note text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.wallet_requests ADD COLUMN IF NOT EXISTS user_number integer;

-- 1.6 balance_ledger (Every balance mutation across trades & simulated wallet)
CREATE TABLE IF NOT EXISTS public.balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_number integer,
  trade_id uuid REFERENCES public.trades(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAW', 'TRADE_OPEN', 'TRADE_PAYOUT', 'ADJUSTMENT')),
  entry_type text,
  amount numeric(14, 2) NOT NULL,
  delta numeric(14, 2),
  note text,
  balance_after numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.balance_ledger
  ADD COLUMN IF NOT EXISTS user_number integer,
  ADD COLUMN IF NOT EXISTS entry_type text,
  ADD COLUMN IF NOT EXISTS delta numeric(14, 2),
  ADD COLUMN IF NOT EXISTS note text;

CREATE OR REPLACE FUNCTION public.sync_balance_ledger_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type IS NULL AND NEW.entry_type IS NOT NULL THEN
    NEW.type := NEW.entry_type;
  ELSIF NEW.entry_type IS NULL AND NEW.type IS NOT NULL THEN
    NEW.entry_type := NEW.type;
  END IF;

  IF NEW.amount IS NULL AND NEW.delta IS NOT NULL THEN
    NEW.amount := NEW.delta;
  ELSIF NEW.delta IS NULL AND NEW.amount IS NOT NULL THEN
    NEW.delta := NEW.amount;
  END IF;

  IF NEW.user_number IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT user_number INTO NEW.user_number
    FROM public.profiles
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_balance_ledger_fields ON public.balance_ledger;
CREATE TRIGGER trg_sync_balance_ledger_fields
  BEFORE INSERT OR UPDATE ON public.balance_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_balance_ledger_fields();

-- 1.6b user_notifications (Realtime bell notifications for request reviews & balance adjustments)
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_number integer,
  request_id uuid REFERENCES public.wallet_requests(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN (
    'DEPOSIT_APPROVED',
    'DEPOSIT_REJECTED',
    'WITHDRAW_APPROVED',
    'WITHDRAW_REJECTED',
    'BALANCE_ADJUSTED',
    'SYSTEM'
  )),
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Upgrade existing balance_ledger check constraint if table was created in an earlier step
DO $$
DECLARE
  r_con RECORD;
BEGIN
  FOR r_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.balance_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.balance_ledger DROP CONSTRAINT IF EXISTS %I', r_con.conname);
  END LOOP;

  ALTER TABLE public.balance_ledger
    ADD CONSTRAINT balance_ledger_type_check
    CHECK (type IN ('DEPOSIT', 'WITHDRAW', 'TRADE_OPEN', 'TRADE_PAYOUT', 'ADJUSTMENT'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- 1.7 admin_audit_log (Immutable security & administrative action audit trail)
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.8 admin_login_attempts (Rate limiting: max 5 failed attempts per 15 minutes per email and per IP)
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip_address text NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1.9 platform_settings (Key-value configuration managed by SUPERADMIN)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.platform_settings (key, value)
VALUES (
  'general',
  '{"platform_name":"PulseOption Demo Platform","maintenance_mode":false,"default_demo_balance":10000,"max_open_trades":10,"inactivity_timeout_minutes":30}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. TRIGGER: Auto-create profiles row when a new auth.users row is created
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_user_number integer;
  v_try integer;
  v_inserted boolean := false;
BEGIN
  v_name := COALESCE(
    NULLIF(TRIM(new.raw_user_meta_data->>'display_name'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'name'), ''),
    SPLIT_PART(COALESCE(new.email, 'trader@demo.local'), '@', 1)
  );

  FOR v_try IN 1..50 LOOP
    BEGIN
      v_user_number := public.generate_user_number();

      INSERT INTO public.profiles (id, user_number, email, name, display_name, balance, role, status, is_admin)
      VALUES (new.id, v_user_number, new.email, v_name, v_name, 10000.00, 'USER', 'ACTIVE', false)
      ON CONFLICT (id) DO UPDATE
      SET email = COALESCE(EXCLUDED.email, public.profiles.email);

      v_inserted := true;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM public.profiles WHERE id = new.id) THEN
          UPDATE public.profiles
          SET email = COALESCE(new.email, public.profiles.email)
          WHERE id = new.id;
          v_inserted := true;
          EXIT;
        END IF;
    END;
  END LOOP;

  IF NOT v_inserted THEN
    RAISE EXCEPTION 'Unable to create profile with unique 5-digit user_number after 50 attempts';
  END IF;

  INSERT INTO public.balance_ledger (user_id, trade_id, type, entry_type, amount, delta, note, balance_after)
  VALUES (new.id, NULL, 'ADJUSTMENT', 'ADJUSTMENT', 10000.00, 10000.00, 'Initial demo account virtual balance', 10000.00);

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_trades_user_status
  ON public.trades (user_id, status);

CREATE INDEX IF NOT EXISTS idx_trades_open_expires_at
  ON public.trades (expires_at)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_price_ticks_asset_created_desc
  ON public.price_ticks (asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_balance_ledger_user_created_desc
  ON public.balance_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_requests_user_status_created
  ON public.wallet_requests (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_requests_status_created
  ON public.wallet_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_desc
  ON public.admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email_created
  ON public.admin_login_attempts (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_created
  ON public.admin_login_attempts (ip_address, created_at DESC);

-- =============================================================================
-- 4. SEED ASSETS (BTC/USD, ETH/USD, EUR/USD, GOLD) + STARTING TICKS
--    volatility is PERCENT PER 1-SECOND TICK:
--      BTC/USD: 0.020
--      ETH/USD: 0.025
--      EUR/USD: 0.004
--      GOLD:    0.010
-- =============================================================================

INSERT INTO public.assets (symbol, name, volatility, payout_percent, anchor_price, is_active, next_burst_at)
VALUES
  ('BTC/USD', 'Bitcoin / US Dollar',   0.020000, 85, 89420.500000, true, now() + ((120.0 + random() * 120.0) || ' seconds')::interval),
  ('ETH/USD', 'Ethereum / US Dollar',  0.025000, 85, 3185.250000,  true, now() + ((120.0 + random() * 120.0) || ' seconds')::interval),
  ('EUR/USD', 'Euro / US Dollar',      0.004000, 85, 1.084200,     true, now() + ((120.0 + random() * 120.0) || ' seconds')::interval),
  ('GOLD',    'Gold Spot / US Dollar', 0.010000, 85, 2745.800000,  true, now() + ((120.0 + random() * 120.0) || ' seconds')::interval)
ON CONFLICT (symbol) DO UPDATE
SET
  name = EXCLUDED.name,
  volatility = EXCLUDED.volatility,
  payout_percent = EXCLUDED.payout_percent,
  anchor_price = COALESCE(public.assets.anchor_price, EXCLUDED.anchor_price),
  next_burst_at = COALESCE(public.assets.next_burst_at, EXCLUDED.next_burst_at);

ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_volatility_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_volatility_check
  CHECK (volatility >= 0.001000 AND volatility <= 0.200000);

DO $$
DECLARE
  r_asset RECORD;
  v_base numeric(18, 6);
  v_price numeric(18, 6);
  v_step integer;
  v_u1 double precision;
  v_u2 double precision;
  v_z double precision;
  v_sigma double precision;
  v_prev_move double precision := 0;
  v_move double precision;
  v_decimals integer;
BEGIN
  FOR r_asset IN SELECT id, symbol, volatility FROM public.assets LOOP
    IF NOT EXISTS (SELECT 1 FROM public.price_ticks WHERE asset_id = r_asset.id) THEN
      v_base := CASE r_asset.symbol
        WHEN 'BTC/USD' THEN 89420.500000
        WHEN 'ETH/USD' THEN 3185.250000
        WHEN 'EUR/USD' THEN 1.084200
        WHEN 'GOLD'    THEN 2745.800000
        ELSE 100.000000
      END;
      v_decimals := CASE WHEN r_asset.symbol = 'EUR/USD' THEN 4 ELSE 2 END;
      v_price := v_base;
      v_sigma := (r_asset.volatility::double precision) / 100.0;
      v_prev_move := 0;

      FOR v_step IN REVERSE 60..1 LOOP
        v_u1 := GREATEST(1e-12, LEAST(1.0 - 1e-12, random()));
        v_u2 := random();
        v_z := sqrt(-2.0 * ln(v_u1)) * cos(2.0 * pi() * v_u2);
        v_move := (0.85 * (v_sigma * v_z)) + (0.15 * v_prev_move);
        v_prev_move := v_move;
        v_price := LEAST(v_base * 1.03, GREATEST(v_base * 0.97, ROUND(v_price * (1.0 + v_move)::numeric, v_decimals)));
        INSERT INTO public.price_ticks (asset_id, price, created_at)
        VALUES (
          r_asset.id,
          v_price,
          now() - (v_step || ' seconds')::interval
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 5. CORE PL/PGSQL FUNCTIONS (SECURITY DEFINER, SET search_path = public)
-- =============================================================================

-- 5.0 Helpers to check active admin role hierarchy (SUPPORT < ADMIN < SUPERADMIN)
CREATE OR REPLACE FUNCTION public.get_admin_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_status text;
  v_is_admin boolean;
BEGIN
  SELECT UPPER(role), COALESCE(status, 'ACTIVE'), COALESCE(is_admin, false)
  INTO v_role, v_status, v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RETURN NULL;
  END IF;

  IF v_role IN ('SUPPORT', 'ADMIN', 'SUPERADMIN') THEN
    RETURN v_role;
  ELSIF v_is_admin = true THEN
    RETURN 'ADMIN';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(p_min_role text DEFAULT 'SUPPORT')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actual text;
  v_actual_rank integer := 0;
  v_req_rank integer := 1;
BEGIN
  v_actual := public.get_admin_role();
  IF v_actual IS NULL THEN
    RETURN false;
  END IF;

  v_actual_rank := CASE v_actual
    WHEN 'SUPERADMIN' THEN 3
    WHEN 'ADMIN'      THEN 2
    WHEN 'SUPPORT'    THEN 1
    ELSE 0
  END;

  v_req_rank := CASE UPPER(COALESCE(p_min_role, 'SUPPORT'))
    WHEN 'SUPERADMIN' THEN 3
    WHEN 'ADMIN'      THEN 2
    WHEN 'SUPPORT'    THEN 1
    ELSE 1
  END;

  RETURN v_actual_rank >= v_req_rank;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.has_admin_role('SUPPORT');
END;
$$;

-- 5.1 tick_prices() & generate_ticks():
--     Zero-drift Box-Muller normal random walk for all active assets:
--     - assets.volatility is PERCENT PER 1-SECOND TICK (0.001 to 0.2)
--     - 85% fresh normal noise + 15% previous tick move (light momentum)
--     - Occasional volatility bursts: every 2–4 min, 1.5x–2.5x for 10–20s
--     - Gentle mean reversion toward slow-moving anchor_price + +/-3% hard clamp
--     - Strictly independent of open trades, user balances, or trade direction
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

    -- Slow-moving anchor price (EMA alpha = 0.0003 per 1s tick)
    v_anchor := COALESCE(r_asset.anchor_price, v_last_price);
    IF v_anchor <= 0 THEN
      v_anchor := v_last_price;
    ELSE
      v_anchor := ROUND((0.9997 * v_anchor) + (0.0003 * v_last_price), 6);
    END IF;

    -- Volatility burst management (1.5x to 2.5x for 10 to 20s every 2 to 4 minutes)
    v_burst_until := r_asset.burst_until;
    v_next_burst_at := r_asset.next_burst_at;
    v_burst_mult := COALESCE(r_asset.burst_multiplier, 1.0);

    IF v_burst_until IS NOT NULL AND v_now < v_burst_until THEN
      v_burst_mult := LEAST(2.5, GREATEST(1.5, v_burst_mult));
    ELSE
      IF v_next_burst_at IS NULL THEN
        v_burst_mult := 1.0;
        v_burst_until := NULL;
        v_next_burst_at := v_now + ((120.0 + random() * 120.0) || ' seconds')::interval;
      ELSIF v_now >= v_next_burst_at THEN
        v_burst_mult := 1.5 + (random() * 1.0);
        v_burst_duration := 10.0 + (random() * 10.0);
        v_burst_until := v_now + (v_burst_duration || ' seconds')::interval;
        v_next_burst_at := v_burst_until + ((120.0 + random() * 120.0) || ' seconds')::interval;
      ELSE
        v_burst_mult := 1.0;
        v_burst_until := NULL;
      END IF;
    END IF;

    -- Box-Muller normal distribution Z ~ N(0, 1) with zero drift
    v_u1 := GREATEST(1e-12, LEAST(1.0 - 1e-12, random()));
    v_u2 := random();
    v_z := sqrt(-2.0 * ln(v_u1)) * cos(2.0 * pi() * v_u2);
    v_z := LEAST(4.0, GREATEST(-4.0, v_z));

    -- Convert percent-per-tick volatility to fractional sigma
    v_vol_pct := LEAST(0.200000, GREATEST(0.001000, r_asset.volatility::double precision));
    v_sigma := (v_vol_pct / 100.0) * v_burst_mult;

    -- Light momentum: 85% fresh random noise + 15% previous move
    v_fresh_noise := v_sigma * v_z;
    v_momentum_move := (0.85 * v_fresh_noise) + (0.15 * COALESCE(r_asset.last_return::double precision, 0.0));

    -- Gentle mean reversion toward slow-moving anchor price
    v_deviation := ((v_last_price - v_anchor) / v_anchor)::double precision;
    v_reversion := -0.0015 * v_deviation;

    v_total_return := v_momentum_move + v_reversion;

    -- Apply +/-3% hard clamp around anchor_price and round to asset decimals
    v_raw_next := v_last_price * (1.0 + v_total_return)::numeric;
    v_clamped_next := LEAST(v_anchor * 1.030000, GREATEST(v_anchor * 0.970000, v_raw_next));
    v_next_price := GREATEST(v_min_price, ROUND(v_clamped_next, v_decimals));

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

-- 5.2 place_trade(p_symbol, p_direction, p_amount, p_expiry_seconds)
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
    RAISE EXCEPTION 'Invalid trade amount: must be between 0.50 and 1000.00';
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

  SELECT COUNT(*)
  INTO v_open_count
  FROM public.trades
  WHERE user_id = v_user_id
    AND status = 'OPEN';

  IF v_open_count >= 10 THEN
    RAISE EXCEPTION 'Maximum limit of 10 concurrent open trades reached';
  END IF;

  IF v_profile.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient virtual balance (Available: %, Required: %)', v_profile.balance, p_amount;
  END IF;

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
    status
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
    'OPEN'
  )
  RETURNING * INTO v_trade;

  INSERT INTO public.balance_ledger (
    user_id,
    trade_id,
    type,
    amount,
    balance_after,
    created_at
  )
  VALUES (
    v_user_id,
    v_trade.id,
    'TRADE_OPEN',
    -ROUND(p_amount, 2),
    v_new_balance,
    v_now
  );

  RETURN v_trade;
END;
$$;

-- 5.3 settle_expired_trades(): Idempotent settlement loop using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.settle_expired_trades()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_trade public.trades%ROWTYPE;
  v_exit_price numeric(18, 6);
  v_status text;
  v_profit numeric(14, 2);
  v_credit numeric(14, 2);
  v_new_balance numeric(14, 2);
  v_settled_count integer := 0;
BEGIN
  FOR r_trade IN
    SELECT *
    FROM public.trades
    WHERE status = 'OPEN'
      AND expires_at <= now()
    ORDER BY expires_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT price
    INTO v_exit_price
    FROM public.price_ticks
    WHERE asset_id = r_trade.asset_id
    ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - r_trade.expires_at))) ASC, id DESC
    LIMIT 1;

    IF v_exit_price IS NULL THEN
      v_exit_price := r_trade.entry_price;
    END IF;

    IF r_trade.direction = 'CALL' THEN
      IF v_exit_price > r_trade.entry_price THEN
        v_status := 'WON';
      ELSIF v_exit_price < r_trade.entry_price THEN
        v_status := 'LOST';
      ELSE
        v_status := 'DRAW';
      END IF;
    ELSE
      IF v_exit_price < r_trade.entry_price THEN
        v_status := 'WON';
      ELSIF v_exit_price > r_trade.entry_price THEN
        v_status := 'LOST';
      ELSE
        v_status := 'DRAW';
      END IF;
    END IF;

    IF v_status = 'WON' THEN
      v_profit := ROUND((r_trade.amount * r_trade.payout_percent) / 100.0, 2);
      v_credit := ROUND(r_trade.amount + v_profit, 2);
    ELSIF v_status = 'DRAW' THEN
      v_profit := 0.00;
      v_credit := ROUND(r_trade.amount, 2);
    ELSE
      v_profit := -ROUND(r_trade.amount, 2);
      v_credit := 0.00;
    END IF;

    UPDATE public.trades
    SET
      status = v_status,
      exit_price = v_exit_price,
      profit = v_profit
    WHERE id = r_trade.id
      AND status = 'OPEN';

    IF FOUND THEN
      v_settled_count := v_settled_count + 1;

      IF v_credit > 0 THEN
        UPDATE public.profiles
        SET balance = ROUND(balance + v_credit, 2)
        WHERE id = r_trade.user_id
        RETURNING balance INTO v_new_balance;

        INSERT INTO public.balance_ledger (
          user_id,
          trade_id,
          type,
          amount,
          balance_after,
          created_at
        )
        VALUES (
          r_trade.user_id,
          r_trade.id,
          'TRADE_PAYOUT',
          v_credit,
          v_new_balance,
          now()
        );
      END IF;
    END IF;
  END LOOP;

  RETURN v_settled_count;
END;
$$;

-- 5.4 reset_demo_balance(): Resets user balance to 10,000.00 (Max once per hour)
CREATE OR REPLACE FUNCTION public.reset_demo_balance()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_delta numeric(14, 2);
  v_minutes_left integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.last_reset_at IS NOT NULL
     AND v_profile.last_reset_at > (now() - interval '1 hour') THEN
    v_minutes_left := CEIL(EXTRACT(EPOCH FROM ((v_profile.last_reset_at + interval '1 hour') - now())) / 60.0);
    RAISE EXCEPTION 'Demo balance can only be reset once per hour. Please wait % minute(s).', GREATEST(1, v_minutes_left);
  END IF;

  v_delta := ROUND(10000.00 - v_profile.balance, 2);

  UPDATE public.profiles
  SET
    balance = 10000.00,
    last_reset_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.balance_ledger (
    user_id,
    trade_id,
    type,
    amount,
    balance_after,
    created_at
  )
  VALUES (
    v_user_id,
    NULL,
    'ADJUSTMENT',
    v_delta,
    10000.00,
    now()
  );

  RETURN v_profile;
END;
$$;

-- 5.5 cleanup_old_ticks(): Deletes price_ticks older than 2 hours (retains >= 2 hours for 100 x 30s candles)
CREATE OR REPLACE FUNCTION public.cleanup_old_ticks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.price_ticks
  WHERE created_at < (now() - interval '2 hours');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 5.6 get_leaderboard_7d(): Top 20 traders by total profit over the last 7 days
CREATE OR REPLACE FUNCTION public.get_leaderboard_7d()
RETURNS TABLE (
  rank bigint,
  user_id uuid,
  trader_name text,
  settled_trades bigint,
  total_volume numeric(14, 2),
  total_profit numeric(14, 2),
  current_balance numeric(14, 2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.profit), 0) DESC) AS rank,
    p.id AS user_id,
    COALESCE(NULLIF(p.display_name, ''), p.name) AS trader_name,
    COUNT(t.id) AS settled_trades,
    ROUND(COALESCE(SUM(t.amount), 0), 2) AS total_volume,
    ROUND(COALESCE(SUM(t.profit), 0), 2) AS total_profit,
    p.balance AS current_balance
  FROM public.trades t
  INNER JOIN public.profiles p ON p.id = t.user_id
  WHERE t.status IN ('WON', 'LOST', 'DRAW')
    AND t.expires_at >= (now() - interval '7 days')
    AND t.profit IS NOT NULL
  GROUP BY p.id, p.display_name, p.name, p.balance
  ORDER BY total_profit DESC
  LIMIT 20;
END;
$$;

-- =============================================================================
-- 5.7 NEW SIMULATED WALLET & PROFILE RPC FUNCTIONS
--     ("Virtual credits only. No real money.")
-- =============================================================================

-- 5.7.1 request_deposit(p_amount, p_note):
-- Amount 10 to 10000, max 3 pending requests per user, active accounts only.
CREATE OR REPLACE FUNCTION public.request_deposit(
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS public.wallet_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_pending_count integer;
  v_req public.wallet_requests%ROWTYPE;
  v_clean_note text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to request virtual deposit credits';
  END IF;

  IF p_amount IS NULL OR p_amount < 10.00 OR p_amount > 10000.00 THEN
    RAISE EXCEPTION 'Virtual deposit amount must be between 10.00 and 10,000.00 credits';
  END IF;

  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Virtual deposit amount can have at most 2 decimal places';
  END IF;

  -- Lock profile row to serialize concurrent request creation per user
  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF COALESCE(UPPER(v_profile.status), 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Your account is currently % and cannot submit deposit requests.', v_profile.status;
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND status = 'PENDING';

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'You already have 3 pending virtual wallet requests. Please wait for admin review.';
  END IF;

  v_clean_note := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 280), '');

  INSERT INTO public.wallet_requests (
    user_id,
    user_number,
    type,
    amount,
    status,
    note,
    created_at
  )
  VALUES (
    v_user_id,
    v_profile.user_number,
    'DEPOSIT',
    ROUND(p_amount, 2),
    'PENDING',
    v_clean_note,
    now()
  )
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

-- 5.7.2 request_withdraw(p_amount, p_note):
-- Locks the profile row, checks balance minus pending withdrawals, creates a PENDING request.
CREATE OR REPLACE FUNCTION public.request_withdraw(
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS public.wallet_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_pending_count integer;
  v_pending_withdrawals numeric(14, 2);
  v_available_balance numeric(14, 2);
  v_req public.wallet_requests%ROWTYPE;
  v_clean_note text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to request virtual withdrawal';
  END IF;

  IF p_amount IS NULL OR p_amount < 10.00 OR p_amount > 10000.00 THEN
    RAISE EXCEPTION 'Virtual withdrawal amount must be between 10.00 and 10,000.00 credits';
  END IF;

  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Virtual withdrawal amount can have at most 2 decimal places';
  END IF;

  -- Lock profile row to prevent race conditions across concurrent withdrawals or trades
  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF COALESCE(UPPER(v_profile.status), 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Your account is currently % and cannot submit withdrawal requests.', v_profile.status;
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND status = 'PENDING';

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'You already have 3 pending virtual wallet requests. Please wait for admin review.';
  END IF;

  SELECT COALESCE(SUM(amount), 0.00)
  INTO v_pending_withdrawals
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND type = 'WITHDRAW'
    AND status = 'PENDING';

  v_available_balance := ROUND(v_profile.balance - v_pending_withdrawals, 2);

  IF p_amount > v_available_balance THEN
    RAISE EXCEPTION 'Insufficient available virtual balance. Available after pending withdrawals: % credits', v_available_balance;
  END IF;

  v_clean_note := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 280), '');

  INSERT INTO public.wallet_requests (
    user_id,
    user_number,
    type,
    amount,
    status,
    note,
    created_at
  )
  VALUES (
    v_user_id,
    v_profile.user_number,
    'WITHDRAW',
    ROUND(p_amount, 2),
    'PENDING',
    v_clean_note,
    now()
  )
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

-- 5.7.3 admin_review_request(p_request_id, p_approve, p_admin_note):
-- ADMIN or SUPERADMIN only (SUPPORT is strictly read-only and blocked here).
-- On approval, locks the profile row and applies the change to balance
-- with a balance_ledger row, an admin_audit_log entry, and a user_notifications row. Strictly idempotent.
CREATE OR REPLACE FUNCTION public.admin_review_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text DEFAULT NULL
)
RETURNS public.wallet_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_email text;
  v_req public.wallet_requests%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_new_balance numeric(14, 2);
  v_ledger_amount numeric(14, 2);
  v_clean_admin_note text;
  v_notif_type text;
  v_notif_title text;
  v_notif_msg text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_admin_role('ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required to review virtual wallet requests (SUPPORT is read-only)';
  END IF;

  SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required';
  END IF;

  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Approval decision (true/false) is required';
  END IF;

  -- Lock the wallet_requests row first for idempotency
  SELECT *
  INTO v_req
  FROM public.wallet_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet request % not found', p_request_id;
  END IF;

  -- Idempotency guard: never process a non-PENDING request twice
  IF v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Wallet request % has already been reviewed (current status: %)', p_request_id, v_req.status;
  END IF;

  -- Lock the target user's profile row
  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_req.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  v_clean_admin_note := NULLIF(LEFT(TRIM(COALESCE(p_admin_note, '')), 280), '');

  IF p_approve = true THEN
    IF v_req.type = 'DEPOSIT' THEN
      v_new_balance := ROUND(v_profile.balance + v_req.amount, 2);
      v_ledger_amount := ROUND(v_req.amount, 2);
      v_notif_type := 'DEPOSIT_APPROVED';
      v_notif_title := 'Virtual Deposit Approved';
      v_notif_msg := format(
        'Your virtual deposit request of $%s has been approved. New balance: $%s.',
        TO_CHAR(v_req.amount, 'FM999,999,990.00'),
        TO_CHAR(v_new_balance, 'FM999,999,990.00')
      );
    ELSIF v_req.type = 'WITHDRAW' THEN
      IF v_profile.balance < v_req.amount THEN
        RAISE EXCEPTION 'Cannot approve withdrawal: user current virtual balance (%) is less than requested amount (%)', v_profile.balance, v_req.amount;
      END IF;
      v_new_balance := ROUND(v_profile.balance - v_req.amount, 2);
      v_ledger_amount := -ROUND(v_req.amount, 2);
      v_notif_type := 'WITHDRAW_APPROVED';
      v_notif_title := 'Virtual Withdrawal Approved';
      v_notif_msg := format(
        'Your virtual withdrawal request of $%s has been approved. New balance: $%s.',
        TO_CHAR(v_req.amount, 'FM999,999,990.00'),
        TO_CHAR(v_new_balance, 'FM999,999,990.00')
      );
    ELSE
      RAISE EXCEPTION 'Unsupported request type: %', v_req.type;
    END IF;

    IF v_clean_admin_note IS NOT NULL THEN
      v_notif_msg := v_notif_msg || ' Note: ' || v_clean_admin_note;
    END IF;

    UPDATE public.profiles
    SET balance = v_new_balance
    WHERE id = v_req.user_id;

    UPDATE public.wallet_requests
    SET
      status = 'APPROVED',
      user_number = COALESCE(user_number, v_profile.user_number),
      admin_note = v_clean_admin_note,
      reviewed_at = now(),
      reviewed_by = v_admin_id
    WHERE id = p_request_id
      AND status = 'PENDING'
    RETURNING * INTO v_req;

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
      v_req.user_id,
      v_profile.user_number,
      NULL,
      v_req.type,
      v_req.type,
      v_ledger_amount,
      v_ledger_amount,
      COALESCE(v_clean_admin_note, 'Approved virtual ' || LOWER(v_req.type) || ' request'),
      v_new_balance,
      now()
    );

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
      'WALLET_REQUEST_APPROVED',
      'wallet_request',
      p_request_id::text,
      jsonb_build_object(
        'user_id', v_req.user_id,
        'user_number', v_profile.user_number,
        'type', v_req.type,
        'amount', v_req.amount,
        'balance_after', v_new_balance,
        'admin_note', v_clean_admin_note
      )
    );

    INSERT INTO public.user_notifications (
      user_id,
      user_number,
      request_id,
      type,
      title,
      message
    )
    VALUES (
      v_req.user_id,
      v_profile.user_number,
      v_req.id,
      v_notif_type,
      v_notif_title,
      v_notif_msg
    );
  ELSE
    v_notif_type := CASE WHEN v_req.type = 'DEPOSIT' THEN 'DEPOSIT_REJECTED' ELSE 'WITHDRAW_REJECTED' END;
    v_notif_title := CASE WHEN v_req.type = 'DEPOSIT' THEN 'Virtual Deposit Rejected' ELSE 'Virtual Withdrawal Rejected' END;
    v_notif_msg := format(
      'Your virtual %s request of $%s was rejected.',
      LOWER(v_req.type),
      TO_CHAR(v_req.amount, 'FM999,999,990.00')
    );
    IF v_clean_admin_note IS NOT NULL THEN
      v_notif_msg := v_notif_msg || ' Reason: ' || v_clean_admin_note;
    END IF;

    UPDATE public.wallet_requests
    SET
      status = 'REJECTED',
      user_number = COALESCE(user_number, v_profile.user_number),
      admin_note = v_clean_admin_note,
      reviewed_at = now(),
      reviewed_by = v_admin_id
    WHERE id = p_request_id
      AND status = 'PENDING'
    RETURNING * INTO v_req;

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
      'WALLET_REQUEST_REJECTED',
      'wallet_request',
      p_request_id::text,
      jsonb_build_object(
        'user_id', v_req.user_id,
        'user_number', v_profile.user_number,
        'type', v_req.type,
        'amount', v_req.amount,
        'admin_note', v_clean_admin_note
      )
    );

    INSERT INTO public.user_notifications (
      user_id,
      user_number,
      request_id,
      type,
      title,
      message
    )
    VALUES (
      v_req.user_id,
      v_profile.user_number,
      v_req.id,
      v_notif_type,
      v_notif_title,
      v_notif_msg
    );
  END IF;

  RETURN v_req;
END;
$$;

-- 5.7.4 update_profile(p_display_name, p_country, p_avatar_url, p_phone):
-- Validated, can only edit own row. Never modifies balance, role, user_number, or is_admin.
CREATE OR REPLACE FUNCTION public.update_profile(
  p_display_name text,
  p_country text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_clean_name text;
  v_clean_country text;
  v_clean_avatar text;
  v_clean_phone text;
  v_profile public.profiles%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update profile';
  END IF;

  v_clean_name := TRIM(COALESCE(p_display_name, ''));
  IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 50 THEN
    RAISE EXCEPTION 'Display name must be between 2 and 50 characters';
  END IF;

  v_clean_country := NULLIF(LEFT(TRIM(COALESCE(p_country, '')), 64), '');
  v_clean_avatar := NULLIF(LEFT(TRIM(COALESCE(p_avatar_url, '')), 500), '');
  v_clean_phone := NULLIF(LEFT(TRIM(COALESCE(p_phone, '')), 32), '');

  UPDATE public.profiles
  SET
    display_name = v_clean_name,
    name = v_clean_name,
    country = COALESCE(v_clean_country, country),
    avatar_url = CASE
      WHEN p_avatar_url IS NULL THEN avatar_url
      ELSE v_clean_avatar
    END,
    phone = CASE
      WHEN p_phone IS NULL THEN phone
      ELSE v_clean_phone
    END
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_profile;
END;
$$;

-- 5.7.5 admin_adjust_user_balance(p_target_user_id, p_delta, p_note):
-- ADMIN or SUPERADMIN only (SUPPORT is read-only and blocked).
-- Requires a reason, prevents negative balances, writes balance_ledger, admin_audit_log, and user_notifications.
CREATE OR REPLACE FUNCTION public.admin_adjust_user_balance(
  p_target_user_id uuid,
  p_delta numeric,
  p_note text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_email text;
  v_profile public.profiles%ROWTYPE;
  v_prev_balance numeric(14, 2);
  v_clean_delta numeric(14, 2);
  v_new_balance numeric(14, 2);
  v_clean_note text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_admin_role('ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required to adjust trader virtual balances (SUPPORT is read-only)';
  END IF;

  SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment delta must be a non-zero amount';
  END IF;

  IF ROUND(p_delta, 2) <> p_delta THEN
    RAISE EXCEPTION 'Adjustment amount can have at most 2 decimal places';
  END IF;

  v_clean_note := NULLIF(LEFT(TRIM(COALESCE(p_note, '')), 280), '');
  IF v_clean_note IS NULL OR char_length(v_clean_note) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required for manual credit/debit adjustments';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target trader profile not found';
  END IF;

  v_prev_balance := v_profile.balance;
  v_clean_delta := ROUND(p_delta, 2);
  v_new_balance := ROUND(v_prev_balance + v_clean_delta, 2);

  IF v_new_balance < 0.00 THEN
    RAISE EXCEPTION 'Manual debit rejected: resulting virtual balance ($%) cannot be negative (current balance: $%)', v_new_balance, v_prev_balance;
  END IF;

  IF v_new_balance > 10000000.00 THEN
    RAISE EXCEPTION 'Manual credit rejected: resulting virtual balance cannot exceed $10,000,000.00';
  END IF;

  UPDATE public.profiles
  SET balance = v_new_balance
  WHERE id = p_target_user_id
  RETURNING * INTO v_profile;

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
    p_target_user_id,
    v_profile.user_number,
    NULL,
    'ADJUSTMENT',
    'ADJUSTMENT',
    v_clean_delta,
    v_clean_delta,
    v_clean_note,
    v_new_balance,
    now()
  );

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
    'BALANCE_ADJUSTED',
    'profile',
    p_target_user_id::text,
    jsonb_build_object(
      'user_id', p_target_user_id,
      'user_number', v_profile.user_number,
      'previous_balance', v_prev_balance,
      'new_balance', v_new_balance,
      'delta', v_clean_delta,
      'note', v_clean_note
    )
  );

  INSERT INTO public.user_notifications (
    user_id,
    user_number,
    request_id,
    type,
    title,
    message
  )
  VALUES (
    p_target_user_id,
    v_profile.user_number,
    NULL,
    'BALANCE_ADJUSTED',
    CASE WHEN v_clean_delta > 0 THEN 'Virtual Balance Credited' ELSE 'Virtual Balance Debited' END,
    format(
      'An administrator %s $%s %s your virtual balance (%s). New balance: $%s.',
      CASE WHEN v_clean_delta > 0 THEN 'credited' ELSE 'debited' END,
      TO_CHAR(ABS(v_clean_delta), 'FM999,999,990.00'),
      CASE WHEN v_clean_delta > 0 THEN 'to' ELSE 'from' END,
      v_clean_note,
      TO_CHAR(v_new_balance, 'FM999,999,990.00')
    )
  );

  RETURN v_new_balance;
END;
$$;

-- 5.7.5b admin_search_users(p_query, p_role, p_status, p_limit):
-- Parameterized server-side search restricted to admin roles (SUPPORT+).
CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_query text DEFAULT NULL,
  p_role text DEFAULT 'ALL',
  p_status text DEFAULT 'ALL',
  p_limit integer DEFAULT 100
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text;
  v_is_5digit boolean := false;
  v_exact_num integer := NULL;
  v_role_filter text;
  v_status_filter text;
  v_safe_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_role('SUPPORT') THEN
    RAISE EXCEPTION 'Forbidden: Admin role (SUPPORT, ADMIN, or SUPERADMIN) required to search users';
  END IF;

  v_q := NULLIF(TRIM(COALESCE(p_query, '')), '');
  v_role_filter := UPPER(TRIM(COALESCE(p_role, 'ALL')));
  v_status_filter := UPPER(TRIM(COALESCE(p_status, 'ALL')));
  v_safe_limit := LEAST(500, GREATEST(1, COALESCE(p_limit, 100)));

  IF v_q IS NOT NULL AND v_q ~ '^[0-9]{5}$' THEN
    v_is_5digit := true;
    v_exact_num := v_q::integer;
  END IF;

  RETURN QUERY
  SELECT p.*
  FROM public.profiles p
  WHERE
    (
      v_role_filter = 'ALL'
      OR UPPER(COALESCE(p.role, CASE WHEN p.is_admin THEN 'ADMIN' ELSE 'USER' END)) = v_role_filter
    )
    AND (
      v_status_filter = 'ALL'
      OR UPPER(COALESCE(p.status, 'ACTIVE')) = v_status_filter
    )
    AND (
      v_q IS NULL
      OR (v_is_5digit AND p.user_number = v_exact_num)
      OR p.user_number::text LIKE '%' || v_q || '%'
      OR COALESCE(p.email, '') ILIKE '%' || v_q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || v_q || '%'
      OR COALESCE(p.name, '') ILIKE '%' || v_q || '%'
      OR p.id::text ILIKE '%' || v_q || '%'
    )
  ORDER BY
    CASE
      WHEN v_is_5digit AND p.user_number = v_exact_num THEN 0
      ELSE 1
    END ASC,
    p.created_at DESC
  LIMIT v_safe_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_updated integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_notification_id IS NOT NULL THEN
    UPDATE public.user_notifications
    SET is_read = true
    WHERE id = p_notification_id
      AND user_id = v_user_id
      AND is_read = false;
  ELSE
    UPDATE public.user_notifications
    SET is_read = true
    WHERE user_id = v_user_id
      AND is_read = false;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- 5.7.6 admin_update_user_role_status(p_target_user_id, p_new_status, p_new_role):
-- Status changes require ADMIN+; Role changes require SUPERADMIN.
CREATE OR REPLACE FUNCTION public.admin_update_user_role_status(
  p_target_user_id uuid,
  p_new_status text DEFAULT NULL,
  p_new_role text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_profile public.profiles%ROWTYPE;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_admin_role('ADMIN') THEN
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  IF p_new_role IS NOT NULL AND UPPER(p_new_role) <> UPPER(v_profile.role) THEN
    IF NOT public.has_admin_role('SUPERADMIN') THEN
      RAISE EXCEPTION 'Forbidden: SUPERADMIN role required to change user roles';
    END IF;
    IF UPPER(p_new_role) NOT IN ('USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN') THEN
      RAISE EXCEPTION 'Invalid role: must be USER, SUPPORT, ADMIN, or SUPERADMIN';
    END IF;
  END IF;

  IF p_new_status IS NOT NULL AND UPPER(p_new_status) NOT IN ('ACTIVE', 'SUSPENDED', 'DISABLED') THEN
    RAISE EXCEPTION 'Invalid status: must be ACTIVE, SUSPENDED, or DISABLED';
  END IF;

  UPDATE public.profiles
  SET
    status = COALESCE(UPPER(p_new_status), status),
    role = COALESCE(UPPER(p_new_role), role),
    is_admin = CASE
      WHEN COALESCE(UPPER(p_new_role), UPPER(role)) IN ('SUPPORT', 'ADMIN', 'SUPERADMIN') THEN true
      ELSE false
    END
  WHERE id = p_target_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.admin_audit_log (
    admin_id,
    action,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    v_admin_id,
    'USER_ACCESS_UPDATED',
    'profile',
    p_target_user_id::text,
    jsonb_build_object(
      'new_role', v_profile.role,
      'new_status', v_profile.status
    )
  );

  RETURN v_profile;
END;
$$;

-- =============================================================================
-- 6. PG_CRON SCHEDULES (Every 5 seconds + 10-minute cleanup)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobname)
    FROM cron.job
    WHERE jobname IN (
      'pulseoption_generate_ticks',
      'pulseoption_settle_trades',
      'pulseoption_cleanup_ticks'
    );

    PERFORM cron.schedule(
      'pulseoption_generate_ticks',
      '5 seconds',
      $cron$SELECT public.generate_ticks();$cron$
    );

    PERFORM cron.schedule(
      'pulseoption_settle_trades',
      '5 seconds',
      $cron$SELECT public.settle_expired_trades();$cron$
    );

    PERFORM cron.schedule(
      'pulseoption_cleanup_ticks',
      '*/10 * * * *',
      $cron$SELECT public.cleanup_old_ticks();$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped or requires sub-minute fallback: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS), STORAGE POLICIES & FUNCTION PRIVILEGE HARDENING
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- 7.1 profiles policies:
-- Users can SELECT their own profile row; Admins (SUPPORT/ADMIN/SUPERADMIN) can SELECT all profiles.
-- NO direct INSERT/UPDATE/DELETE of balance, role, status, or is_admin from client.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.has_admin_role('SUPPORT'));

-- Explicitly revoke any direct table writes on profiles, wallet_requests, trades, and balance_ledger
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.trades FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.balance_ledger FROM anon, authenticated;

-- 7.2 wallet_requests policies:
DROP POLICY IF EXISTS "wallet_requests_select_own_or_admin" ON public.wallet_requests;
CREATE POLICY "wallet_requests_select_own_or_admin"
  ON public.wallet_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

-- 7.3 trades policies:
DROP POLICY IF EXISTS "trades_select_own" ON public.trades;
CREATE POLICY "trades_select_own"
  ON public.trades
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

-- 7.4 balance_ledger policies:
DROP POLICY IF EXISTS "balance_ledger_select_own" ON public.balance_ledger;
CREATE POLICY "balance_ledger_select_own"
  ON public.balance_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

-- 7.5 assets policies:
DROP POLICY IF EXISTS "assets_select_authenticated" ON public.assets;
CREATE POLICY "assets_select_authenticated"
  ON public.assets
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "assets_admin_update" ON public.assets;
CREATE POLICY "assets_admin_update"
  ON public.assets
  FOR UPDATE
  TO authenticated
  USING (public.has_admin_role('ADMIN'))
  WITH CHECK (public.has_admin_role('ADMIN'));

-- 7.6 price_ticks policies:
DROP POLICY IF EXISTS "price_ticks_select_authenticated" ON public.price_ticks;
CREATE POLICY "price_ticks_select_authenticated"
  ON public.price_ticks
  FOR SELECT
  TO authenticated
  USING (true);

-- 7.6b admin_audit_log policies (Only SUPERADMIN or ADMIN can SELECT; inserts allowed via server/authenticated audit logger)
DROP POLICY IF EXISTS "admin_audit_log_select_admin" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_select_admin"
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_admin_role('ADMIN'));

DROP POLICY IF EXISTS "admin_audit_log_insert_all" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_insert_all"
  ON public.admin_audit_log
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 7.6c admin_login_attempts policies (Used by server-side rate limiter)
DROP POLICY IF EXISTS "admin_login_attempts_select_all" ON public.admin_login_attempts;
CREATE POLICY "admin_login_attempts_select_all"
  ON public.admin_login_attempts
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_login_attempts_insert_all" ON public.admin_login_attempts;
CREATE POLICY "admin_login_attempts_insert_all"
  ON public.admin_login_attempts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 7.6d platform_settings policies
DROP POLICY IF EXISTS "platform_settings_select_admin" ON public.platform_settings;
CREATE POLICY "platform_settings_select_admin"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (public.has_admin_role('SUPPORT'));

DROP POLICY IF EXISTS "platform_settings_modify_superadmin" ON public.platform_settings;
CREATE POLICY "platform_settings_modify_superadmin"
  ON public.platform_settings
  FOR ALL
  TO authenticated
  USING (public.has_admin_role('SUPERADMIN'))
  WITH CHECK (public.has_admin_role('SUPERADMIN'));

-- 7.7 Supabase Storage Bucket "avatars" & Folder-Isolated Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = true;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_user_insert_own_folder" ON storage.objects;
CREATE POLICY "avatars_user_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_user_update_own_folder" ON storage.objects;
CREATE POLICY "avatars_user_update_own_folder"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_user_delete_own_folder" ON storage.objects;
CREATE POLICY "avatars_user_delete_own_folder"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.user_notifications FROM anon, authenticated;

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

-- 7.8 Function Execution Permissions
REVOKE EXECUTE ON FUNCTION public.cleanup_old_ticks() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tick_prices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ticks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expired_trades() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_user_number() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.place_trade(text, text, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_trade(text, text, numeric, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reset_demo_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_demo_balance() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_deposit(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_deposit(numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_withdraw(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdraw(numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_review_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_request(uuid, boolean, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_user_balance(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_user_balance(uuid, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_search_users(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, text, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_notifications_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_role_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role_status(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_profile(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_7d() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_role(text) TO authenticated;

-- =============================================================================
-- 8. ENABLE REALTIME PUBLICATION ON price_ticks, trades, profiles, wallet_requests, balance_ledger, admin_audit_log, user_notifications
-- =============================================================================

ALTER TABLE public.price_ticks REPLICA IDENTITY FULL;
ALTER TABLE public.trades REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.wallet_requests REPLICA IDENTITY FULL;
ALTER TABLE public.balance_ledger REPLICA IDENTITY FULL;
ALTER TABLE public.admin_audit_log REPLICA IDENTITY FULL;
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'price_ticks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.price_ticks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wallet_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'balance_ledger'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.balance_ledger;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_audit_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_audit_log;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END;
$$;

-- =============================================================================
-- 9. PROMOTE AN EXISTING ACCOUNT TO FIRST SUPERADMIN (Run in Supabase SQL Editor)
-- =============================================================================
-- Replace 'mbist0066@gmail.com' with the email address of your registered user account:
/*
UPDATE public.profiles p
SET
  role = 'SUPERADMIN',
  status = 'ACTIVE',
  is_admin = true,
  email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND LOWER(u.email) = LOWER('mbist0066@gmail.com');
*/



-- =============================================================================
-- CURRENCY SWITCHER (USDT / NPR) — SAFE-TO-RE-RUN IDEMPOTENT SQL MIGRATION
-- Base stored currency: USDT (all balances, trades, wallet_requests, ledger)
-- Display & entry currencies: USDT ($1,000.00) and NPR (Rs 13,450.00)
-- =============================================================================

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

INSERT INTO public.exchange_rates (base, quote, rate, reason, set_by, set_by_email)
SELECT 'USDT', 'NPR', 134.5000, 'Initial default exchange rate (1 USDT = Rs 134.50)', NULL, 'system'
WHERE NOT EXISTS (SELECT 1 FROM public.exchange_rates);

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

REVOKE ALL ON FUNCTION public.get_current_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_rate() TO authenticated, anon;

REVOKE ALL ON FUNCTION public.set_preferred_currency(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_preferred_currency(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_exchange_rate(numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_exchange_rate(numeric, text, boolean) TO authenticated;
