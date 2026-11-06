-- =============================================================================
-- PULSEOPTION TRADING PLATFORM — IDEMPOTENT WALLET & 5-DIGIT USER ID REPAIR SCRIPT
-- Safe to re-run multiple times in the Supabase SQL Editor.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. ENSURE profiles TABLE & COLUMNS EXIST
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_number integer UNIQUE,
  email text,
  display_name text NOT NULL DEFAULT 'Trader',
  name text NOT NULL DEFAULT 'Trader',
  balance numeric(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  role text NOT NULL DEFAULT 'USER',
  status text NOT NULL DEFAULT 'ACTIVE',
  is_admin boolean NOT NULL DEFAULT false,
  last_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_number integer,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Trader',
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Trader',
  ADD COLUMN IF NOT EXISTS balance numeric(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profiles
  ALTER COLUMN balance SET DEFAULT 0.00;

UPDATE public.profiles SET status = 'ACTIVE' WHERE status IS NULL;
UPDATE public.profiles SET role = CASE WHEN is_admin THEN 'ADMIN' ELSE 'USER' END WHERE role IS NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (UPPER(role) IN ('USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (UPPER(status) IN ('ACTIVE', 'SUSPENDED', 'DISABLED'));

-- =============================================================================
-- 2. 5-DIGIT USER ID GENERATOR, BACKFILL & IMMUTABILITY TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_user_number()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate integer;
  v_exists boolean;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Unable to generate a unique 5-digit user_number after 50 attempts';
    END IF;

    v_candidate := floor(random() * (99999 - 10000 + 1) + 10000)::integer;

    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE user_number = v_candidate
    ) INTO v_exists;

    IF NOT v_exists THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
END;
$$;

-- Temporarily drop immutability trigger before backfilling
DROP TRIGGER IF EXISTS trg_prevent_user_number_update ON public.profiles;

-- Ensure every auth.users record has a corresponding public.profiles row
INSERT INTO public.profiles (id, user_number, email, display_name, name, balance, role, status, is_admin)
SELECT
  u.id,
  public.generate_user_number(),
  u.email,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'display_name'), ''), NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''), split_part(COALESCE(u.email, 'trader'), '@', 1), 'Trader'),
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''), NULLIF(TRIM(u.raw_user_meta_data->>'display_name'), ''), split_part(COALESCE(u.email, 'trader'), '@', 1), 'Trader'),
  0.00,
  'USER',
  'ACTIVE',
  false
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- Backfill user_number for any existing profile missing a valid 5-digit number
DO $$
DECLARE
  r RECORD;
  v_assigned boolean;
  v_retry integer;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
    WHERE user_number IS NULL OR user_number < 10000 OR user_number > 99999
  LOOP
    v_assigned := false;
    v_retry := 0;
    WHILE NOT v_assigned AND v_retry < 50 LOOP
      v_retry := v_retry + 1;
      BEGIN
        UPDATE public.profiles
        SET user_number = public.generate_user_number()
        WHERE id = r.id;
        v_assigned := true;
      EXCEPTION
        WHEN unique_violation THEN
          v_assigned := false;
      END;
    END LOOP;

    IF NOT v_assigned THEN
      RAISE EXCEPTION 'Failed to backfill unique 5-digit user_number for profile % after 50 attempts', r.id;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN user_number SET DEFAULT public.generate_user_number(),
  ALTER COLUMN user_number SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_number_range_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_number_range_check
  CHECK (user_number BETWEEN 10000 AND 99999);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_number_unique
  ON public.profiles (user_number);

CREATE INDEX IF NOT EXISTS idx_profiles_user_number
  ON public.profiles (user_number);

-- Immutability trigger: reject any UPDATE changing user_number
CREATE OR REPLACE FUNCTION public.prevent_user_number_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_number IS NOT NULL AND NEW.user_number IS DISTINCT FROM OLD.user_number THEN
    RAISE EXCEPTION 'user_number is immutable and cannot be modified once assigned';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_user_number_update ON public.profiles;
CREATE TRIGGER trg_prevent_user_number_update
  BEFORE UPDATE OF user_number ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_number_update();

-- =============================================================================
-- 3. ENSURE wallet_requests, balance_ledger, user_notifications & admin_audit_log
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wallet_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_number integer,
  type text NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAW')),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 10.00 AND amount <= 10000.00),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  note text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.wallet_requests
  ADD COLUMN IF NOT EXISTS user_number integer,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.wallet_requests
  DROP CONSTRAINT IF EXISTS wallet_requests_type_check;
ALTER TABLE public.wallet_requests
  ADD CONSTRAINT wallet_requests_type_check
  CHECK (type IN ('DEPOSIT', 'WITHDRAW'));

ALTER TABLE public.wallet_requests
  DROP CONSTRAINT IF EXISTS wallet_requests_status_check;
ALTER TABLE public.wallet_requests
  ADD CONSTRAINT wallet_requests_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));

ALTER TABLE public.wallet_requests
  DROP CONSTRAINT IF EXISTS wallet_requests_amount_check;
ALTER TABLE public.wallet_requests
  ADD CONSTRAINT wallet_requests_amount_check
  CHECK (amount >= 10.00 AND amount <= 10000.00);

UPDATE public.wallet_requests wr
SET user_number = p.user_number
FROM public.profiles p
WHERE wr.user_id = p.id
  AND wr.user_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_requests_user_status_created
  ON public.wallet_requests (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_requests_user_number
  ON public.wallet_requests (user_number);

CREATE TABLE IF NOT EXISTS public.balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_number integer,
  trade_id uuid,
  type text NOT NULL DEFAULT 'ADJUSTMENT',
  entry_type text NOT NULL DEFAULT 'ADJUSTMENT',
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  delta numeric(14, 2) NOT NULL DEFAULT 0,
  balance_after numeric(14, 2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.balance_ledger
  ADD COLUMN IF NOT EXISTS user_number integer,
  ADD COLUMN IF NOT EXISTS trade_id uuid,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'ADJUSTMENT',
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'ADJUSTMENT',
  ADD COLUMN IF NOT EXISTS amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delta numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_after numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.balance_ledger
  DROP CONSTRAINT IF EXISTS balance_ledger_type_check;
ALTER TABLE public.balance_ledger
  ADD CONSTRAINT balance_ledger_type_check
  CHECK (type IN ('INITIAL_CREDIT', 'TRADE_DEBIT', 'TRADE_OPEN', 'TRADE_PAYOUT', 'TRADE_REFUND', 'DEPOSIT', 'WITHDRAW', 'RESET', 'ADJUSTMENT'));

ALTER TABLE public.balance_ledger
  DROP CONSTRAINT IF EXISTS balance_ledger_entry_type_check;
ALTER TABLE public.balance_ledger
  ADD CONSTRAINT balance_ledger_entry_type_check
  CHECK (entry_type IN ('INITIAL_CREDIT', 'TRADE_DEBIT', 'TRADE_OPEN', 'TRADE_PAYOUT', 'TRADE_REFUND', 'DEPOSIT', 'WITHDRAW', 'RESET', 'ADJUSTMENT'));

UPDATE public.balance_ledger bl
SET user_number = p.user_number
FROM public.profiles p
WHERE bl.user_id = p.id
  AND bl.user_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_balance_ledger_user_created
  ON public.balance_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'INFO',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON public.user_notifications (user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_email text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- =============================================================================
-- 4. SIGNUP TRIGGER: AUTO-CREATE PROFILE + 5-DIGIT USER NUMBER + INITIAL LEDGER
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
  v_user_number integer;
  v_inserted boolean := false;
  v_attempt integer := 0;
BEGIN
  v_display_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(COALESCE(NEW.email, 'trader'), '@', 1),
    'Trader'
  );

  WHILE NOT v_inserted AND v_attempt < 50 LOOP
    v_attempt := v_attempt + 1;
    v_user_number := public.generate_user_number();
    BEGIN
      INSERT INTO public.profiles (
        id,
        user_number,
        email,
        display_name,
        name,
        balance,
        role,
        status,
        is_admin
      )
      VALUES (
        NEW.id,
        v_user_number,
        NEW.email,
        v_display_name,
        v_display_name,
        0.00,
        'USER',
        'ACTIVE',
        false
      )
      ON CONFLICT (id) DO UPDATE
        SET email = COALESCE(EXCLUDED.email, public.profiles.email)
      RETURNING user_number INTO v_user_number;

      v_inserted := true;
    EXCEPTION
      WHEN unique_violation THEN
        v_inserted := false;
    END;
  END LOOP;

  IF NOT v_inserted THEN
    RAISE EXCEPTION 'Could not assign a unique 5-digit user_number during registration after 50 attempts';
  END IF;

  INSERT INTO public.balance_ledger (
    user_id,
    user_number,
    type,
    entry_type,
    amount,
    delta,
    balance_after,
    note
  )
  VALUES (
    NEW.id,
    v_user_number,
    'INITIAL_CREDIT',
    'INITIAL_CREDIT',
    0.00,
    0.00,
    0.00,
    'Live trading account opened ($0.00 starting balance) — User ID: ' || v_user_number
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 5. ADMIN ROLE HELPER FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION public.has_admin_role(p_min_role text DEFAULT 'SUPPORT')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_status text;
  v_is_admin boolean;
  v_user_rank integer := 0;
  v_req_rank integer := 1;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT UPPER(COALESCE(role, 'USER')), UPPER(COALESCE(status, 'ACTIVE')), COALESCE(is_admin, false)
  INTO v_role, v_status, v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RETURN false;
  END IF;

  IF v_role = 'SUPERADMIN' THEN
    v_user_rank := 3;
  ELSIF v_role = 'ADMIN' OR v_is_admin = true THEN
    v_user_rank := 2;
  ELSIF v_role = 'SUPPORT' THEN
    v_user_rank := 1;
  ELSE
    v_user_rank := 0;
  END IF;

  IF UPPER(p_min_role) = 'SUPERADMIN' THEN
    v_req_rank := 3;
  ELSIF UPPER(p_min_role) = 'ADMIN' THEN
    v_req_rank := 2;
  ELSE
    v_req_rank := 1;
  END IF;

  RETURN v_user_rank >= v_req_rank;
END;
$$;

-- =============================================================================
-- 6. DEPOSIT & WITHDRAWAL RPC FUNCTIONS (SECURITY DEFINER)
-- =============================================================================

-- 6A. request_deposit(p_amount numeric, p_note text DEFAULT NULL)
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
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_pending_count integer;
  v_request public.wallet_requests;
  v_clean_note text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: please sign in to submit a deposit request';
  END IF;

  p_amount := round(COALESCE(p_amount, 0), 2);
  IF p_amount < 10.00 OR p_amount > 10000.00 THEN
    RAISE EXCEPTION 'Virtual deposit amount must be between $10.00 and $10,000.00';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  -- Auto-provision profile if auth.users exists before trigger creation
  IF NOT FOUND THEN
    INSERT INTO public.profiles (
      id,
      user_number,
      email,
      display_name,
      name,
      balance,
      role,
      status,
      is_admin
    )
    SELECT
      u.id,
      public.generate_user_number(),
      u.email,
      COALESCE(split_part(u.email, '@', 1), 'Trader'),
      COALESCE(split_part(u.email, '@', 1), 'Trader'),
      10000.00,
      'USER',
      'ACTIVE',
      false
    FROM auth.users u
    WHERE u.id = v_user_id
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found for authenticated session';
    END IF;
  END IF;

  IF UPPER(COALESCE(v_profile.status, 'ACTIVE')) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Account is %. Only ACTIVE accounts can create deposit requests.', v_profile.status;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND status = 'PENDING';

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'Maximum 3 pending wallet requests allowed at a time. Please wait for admin review.';
  END IF;

  v_clean_note := COALESCE(NULLIF(TRIM(p_note), ''), 'User ID: ' || v_profile.user_number);

  INSERT INTO public.wallet_requests (
    user_id,
    user_number,
    type,
    amount,
    status,
    note
  )
  VALUES (
    v_user_id,
    v_profile.user_number,
    'DEPOSIT',
    p_amount,
    'PENDING',
    v_clean_note
  )
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

-- 6B. request_withdraw(p_amount numeric, p_note text DEFAULT NULL)
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
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_pending_count integer;
  v_pending_withdrawals numeric(14, 2);
  v_available numeric(14, 2);
  v_request public.wallet_requests;
  v_clean_note text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: please sign in to submit a withdrawal request';
  END IF;

  p_amount := round(COALESCE(p_amount, 0), 2);
  IF p_amount < 10.00 OR p_amount > 10000.00 THEN
    RAISE EXCEPTION 'Virtual withdrawal amount must be between $10.00 and $10,000.00';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  -- Auto-provision profile if auth.users exists before trigger creation
  IF NOT FOUND THEN
    INSERT INTO public.profiles (
      id,
      user_number,
      email,
      display_name,
      name,
      balance,
      role,
      status,
      is_admin
    )
    SELECT
      u.id,
      public.generate_user_number(),
      u.email,
      COALESCE(split_part(u.email, '@', 1), 'Trader'),
      COALESCE(split_part(u.email, '@', 1), 'Trader'),
      10000.00,
      'USER',
      'ACTIVE',
      false
    FROM auth.users u
    WHERE u.id = v_user_id
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found for authenticated session';
    END IF;
  END IF;

  IF UPPER(COALESCE(v_profile.status, 'ACTIVE')) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Account is %. Only ACTIVE accounts can create withdrawal requests.', v_profile.status;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND status = 'PENDING';

  IF v_pending_count >= 3 THEN
    RAISE EXCEPTION 'Maximum 3 pending wallet requests allowed at a time. Please wait for admin review.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_pending_withdrawals
  FROM public.wallet_requests
  WHERE user_id = v_user_id
    AND status = 'PENDING'
    AND type = 'WITHDRAW';

  v_available := v_profile.balance - v_pending_withdrawals;

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient available virtual balance ($% available after $% in pending withdrawals)',
      round(v_available, 2), round(v_pending_withdrawals, 2);
  END IF;

  v_clean_note := COALESCE(NULLIF(TRIM(p_note), ''), 'User ID: ' || v_profile.user_number);

  INSERT INTO public.wallet_requests (
    user_id,
    user_number,
    type,
    amount,
    status,
    note
  )
  VALUES (
    v_user_id,
    v_profile.user_number,
    'WITHDRAW',
    p_amount,
    'PENDING',
    v_clean_note
  )
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

-- 6C. admin_review_request(p_request_id uuid, p_approve boolean, p_admin_note text DEFAULT NULL)
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
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  v_req public.wallet_requests;
  v_user_profile public.profiles;
  v_new_balance numeric(14, 2);
  v_delta numeric(14, 2);
BEGIN
  IF v_admin_id IS NOT NULL THEN
    IF NOT public.has_admin_role('ADMIN') THEN
      RAISE EXCEPTION 'Unauthorized: ADMIN or SUPERADMIN role required to review wallet requests';
    END IF;
    SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;
  END IF;

  SELECT * INTO v_req
  FROM public.wallet_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet request not found';
  END IF;

  IF v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Request has already been reviewed (current status: %)', v_req.status;
  END IF;

  SELECT * INTO v_user_profile
  FROM public.profiles
  WHERE id = v_req.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  IF p_approve THEN
    IF v_req.type = 'DEPOSIT' THEN
      v_delta := v_req.amount;
      v_new_balance := round(v_user_profile.balance + v_req.amount, 2);
    ELSE
      IF v_user_profile.balance < v_req.amount THEN
        RAISE EXCEPTION 'Insufficient user balance ($%) to approve withdrawal of $%',
          v_user_profile.balance, v_req.amount;
      END IF;
      v_delta := -v_req.amount;
      v_new_balance := round(v_user_profile.balance - v_req.amount, 2);
    END IF;

    UPDATE public.profiles
    SET balance = v_new_balance
    WHERE id = v_user_profile.id;

    UPDATE public.wallet_requests
    SET status = 'APPROVED',
        user_number = COALESCE(v_req.user_number, v_user_profile.user_number),
        admin_note = COALESCE(NULLIF(TRIM(p_admin_note), ''), admin_note),
        reviewed_at = now(),
        reviewed_by = v_admin_id
    WHERE id = v_req.id
    RETURNING * INTO v_req;

    INSERT INTO public.balance_ledger (
      user_id,
      user_number,
      type,
      entry_type,
      amount,
      delta,
      balance_after,
      note
    )
    VALUES (
      v_user_profile.id,
      v_user_profile.user_number,
      v_req.type,
      v_req.type,
      v_delta,
      v_delta,
      v_new_balance,
      'Admin approved virtual ' || lower(v_req.type) || ' request' ||
      CASE
        WHEN p_admin_note IS NOT NULL AND TRIM(p_admin_note) <> '' THEN ': ' || TRIM(p_admin_note)
        ELSE ''
      END
    );

    INSERT INTO public.user_notifications (
      user_id,
      title,
      message,
      type
    )
    VALUES (
      v_user_profile.id,
      initcap(lower(v_req.type)) || ' Request Approved',
      'Your virtual ' || lower(v_req.type) || ' request of $' || round(v_req.amount, 2) ||
      ' (User ID: ' || v_user_profile.user_number || ') was approved. New virtual balance: $' || v_new_balance || '.',
      'REQUEST_APPROVED'
    );

    INSERT INTO public.admin_audit_log (
      admin_id,
      admin_user_id,
      admin_email,
      action,
      target_type,
      target_id,
      metadata
    )
    VALUES (
      v_admin_id,
      v_admin_id,
      v_admin_email,
      'WALLET_REQUEST_APPROVED',
      'wallet_request',
      v_req.id::text,
      jsonb_build_object(
        'request_type', v_req.type,
        'amount', v_req.amount,
        'target_user_id', v_user_profile.id,
        'target_user_number', v_user_profile.user_number,
        'balance_after', v_new_balance,
        'admin_note', p_admin_note
      )
    );
  ELSE
    UPDATE public.wallet_requests
    SET status = 'REJECTED',
        user_number = COALESCE(v_req.user_number, v_user_profile.user_number),
        admin_note = COALESCE(NULLIF(TRIM(p_admin_note), ''), admin_note),
        reviewed_at = now(),
        reviewed_by = v_admin_id
    WHERE id = v_req.id
    RETURNING * INTO v_req;

    INSERT INTO public.user_notifications (
      user_id,
      title,
      message,
      type
    )
    VALUES (
      v_user_profile.id,
      initcap(lower(v_req.type)) || ' Request Rejected',
      'Your virtual ' || lower(v_req.type) || ' request of $' || round(v_req.amount, 2) ||
      ' (User ID: ' || v_user_profile.user_number || ') was rejected.' ||
      CASE
        WHEN p_admin_note IS NOT NULL AND TRIM(p_admin_note) <> '' THEN ' Reason: ' || TRIM(p_admin_note)
        ELSE ''
      END,
      'REQUEST_REJECTED'
    );

    INSERT INTO public.admin_audit_log (
      admin_id,
      admin_user_id,
      admin_email,
      action,
      target_type,
      target_id,
      metadata
    )
    VALUES (
      v_admin_id,
      v_admin_id,
      v_admin_email,
      'WALLET_REQUEST_REJECTED',
      'wallet_request',
      v_req.id::text,
      jsonb_build_object(
        'request_type', v_req.type,
        'amount', v_req.amount,
        'target_user_id', v_user_profile.id,
        'target_user_number', v_user_profile.user_number,
        'admin_note', p_admin_note
      )
    );
  END IF;

  RETURN v_req;
END;
$$;

-- 6D. admin_adjust_user_balance(p_target_user_id uuid, p_delta numeric, p_note text DEFAULT NULL)
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
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  v_user_profile public.profiles;
  v_new_balance numeric(14, 2);
  v_clean_note text;
BEGIN
  IF v_admin_id IS NOT NULL THEN
    IF NOT public.has_admin_role('ADMIN') THEN
      RAISE EXCEPTION 'Unauthorized: ADMIN or SUPERADMIN role required to adjust user balance';
    END IF;
    SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;
  END IF;

  p_delta := round(COALESCE(p_delta, 0), 2);
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment delta must be non-zero';
  END IF;

  v_clean_note := COALESCE(NULLIF(TRIM(p_note), ''), 'Manual admin balance adjustment');

  SELECT * INTO v_user_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  v_new_balance := round(COALESCE(v_user_profile.balance, 0) + p_delta, 2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Resulting balance ($%) cannot be negative (current balance: $%)',
      v_new_balance, v_user_profile.balance;
  END IF;

  UPDATE public.profiles
  SET balance = v_new_balance
  WHERE id = v_user_profile.id;

  INSERT INTO public.balance_ledger (
    user_id,
    user_number,
    type,
    entry_type,
    amount,
    delta,
    balance_after,
    note
  )
  VALUES (
    v_user_profile.id,
    v_user_profile.user_number,
    'ADJUSTMENT',
    'ADJUSTMENT',
    p_delta,
    p_delta,
    v_new_balance,
    v_clean_note
  );

  INSERT INTO public.user_notifications (
    user_id,
    title,
    message,
    type
  )
  VALUES (
    v_user_profile.id,
    CASE WHEN p_delta > 0 THEN 'Balance Credited by Admin' ELSE 'Balance Adjusted by Admin' END,
    'An administrator ' || CASE WHEN p_delta > 0 THEN 'credited $' ELSE 'debited $' END ||
    round(abs(p_delta), 2) || ' (User ID: ' || v_user_profile.user_number || '). Reason: ' ||
    v_clean_note || '. New balance: $' || v_new_balance || '.',
    'BALANCE_ADJUSTED'
  );

  INSERT INTO public.admin_audit_log (
    admin_id,
    admin_user_id,
    admin_email,
    action,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    v_admin_id,
    v_admin_id,
    v_admin_email,
    'MANUAL_BALANCE_ADJUSTMENT',
    'profile',
    v_user_profile.id::text,
    jsonb_build_object(
      'delta', p_delta,
      'balance_before', v_user_profile.balance,
      'balance_after', v_new_balance,
      'target_user_number', v_user_profile.user_number,
      'note', v_clean_note
    )
  );

  RETURN v_new_balance;
END;
$$;

-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.has_admin_role('SUPPORT'));

DROP POLICY IF EXISTS "wallet_requests_select_own_or_admin" ON public.wallet_requests;
CREATE POLICY "wallet_requests_select_own_or_admin"
  ON public.wallet_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

DROP POLICY IF EXISTS "balance_ledger_select_own_or_admin" ON public.balance_ledger;
CREATE POLICY "balance_ledger_select_own_or_admin"
  ON public.balance_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_audit_log_select_superadmin" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_select_superadmin"
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_admin_role('SUPERADMIN'));

-- =============================================================================
-- 8. FUNCTION EXECUTION GRANTS (AUTHENTICATED ONLY, REVOKE ANON)
-- =============================================================================
REVOKE ALL ON FUNCTION public.generate_user_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_user_number() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_admin_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_role(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_deposit(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_deposit(numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_withdraw(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdraw(numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_review_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_request(uuid, boolean, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_user_balance(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_user_balance(uuid, numeric, text) TO authenticated, service_role;

-- =============================================================================
-- 9. REALTIME PUBLICATION & POSTGREST SCHEMA RELOAD
-- =============================================================================
DO $$
BEGIN
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
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
