-- =============================================================================
-- supabase/user_id_and_wallet_migration.sql
-- Complete, Idempotent Migration for:
--   PART 1: 5-Digit Unique Immutable User ID (profiles.user_number: 10000..99999)
--   PART 2: Functional Virtual Deposit & Withdrawal System, Notifications,
--           Atomic/Idempotent Admin Review, Manual Credit/Debit & Admin Search
--
-- Safe to run on an existing database that already has users, trades, and requests.
-- Virtual credits only. No real money.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1: 5-DIGIT USER ID (profiles.user_number)
-- =============================================================================

-- 1.1 Add user_number column as nullable first so existing profiles can be backfilled
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_number integer;

-- 1.2 Create generate_user_number():
--     Picks a random integer from 10000 to 99999, retries up to 50 attempts
--     until it finds one not already used, otherwise raises a clear error.
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
      SELECT 1
      FROM public.profiles
      WHERE user_number = v_candidate
    ) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Unable to generate a unique 5-digit user_number after 50 attempts';
END;
$$;

-- 1.3 Ensure UNIQUE index and range CHECK constraint exist before backfill so
--     backfill can catch unique_violation if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_user_number_range_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_number_range_check
      CHECK (user_number BETWEEN 10000 AND 99999);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_user_number_key'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_number_key
      UNIQUE (user_number);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_number
  ON public.profiles (user_number);

-- 1.4 BACKFILL: Assign a unique 5-digit user_number to every existing profile
--     that does not have one or is out of bounds, handling race conditions.
DO $$
DECLARE
  r_prof RECORD;
  v_assigned boolean;
  v_try integer;
  v_num integer;
BEGIN
  FOR r_prof IN
    SELECT id
    FROM public.profiles
    WHERE user_number IS NULL
       OR user_number < 10000
       OR user_number > 99999
    ORDER BY created_at ASC, id ASC
  LOOP
    v_assigned := false;
    FOR v_try IN 1..50 LOOP
      BEGIN
        v_num := public.generate_user_number();
        UPDATE public.profiles
        SET user_number = v_num
        WHERE id = r_prof.id;
        v_assigned := true;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          -- Retry on collision
          NULL;
      END;
    END LOOP;

    IF NOT v_assigned THEN
      RAISE EXCEPTION 'Backfill failed to assign unique 5-digit user_number for profile % after 50 attempts', r_prof.id;
    END IF;
  END LOOP;
END;
$$;

-- 1.5 Enforce NOT NULL and default on profiles.user_number
ALTER TABLE public.profiles
  ALTER COLUMN user_number SET DEFAULT public.generate_user_number(),
  ALTER COLUMN user_number SET NOT NULL;

-- 1.6 Auto-assign user_number on BEFORE INSERT if omitted
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

-- 1.7 Make user_number strictly IMMUTABLE (rejects any UPDATE changing it, even for admins)
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

-- 1.8 Update handle_new_user() signup trigger so every new account in auth.users
--     gets a unique 5-digit user_number automatically at account creation,
--     catching unique_violation and retrying up to 50 times.
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

      INSERT INTO public.profiles (
        id,
        user_number,
        email,
        name,
        display_name,
        balance,
        role,
        status,
        is_admin
      )
      VALUES (
        new.id,
        v_user_number,
        new.email,
        v_name,
        v_name,
        10000.00,
        'USER',
        'ACTIVE',
        false
      )
      ON CONFLICT (id) DO UPDATE
      SET email = COALESCE(EXCLUDED.email, public.profiles.email);

      v_inserted := true;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- If the conflict was on user_number, retry with a fresh 5-digit number
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
-- PART 2: WALLET REQUESTS, LEDGER & NOTIFICATIONS SCHEMA ENHANCEMENTS
-- =============================================================================

-- 2.1 Include user_number on wallet_requests so support can immediately identify it
ALTER TABLE public.wallet_requests
  ADD COLUMN IF NOT EXISTS user_number integer;

UPDATE public.wallet_requests wr
SET user_number = p.user_number
FROM public.profiles p
WHERE wr.user_id = p.id
  AND wr.user_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_requests_user_number
  ON public.wallet_requests (user_number);

-- 2.2 Ensure balance_ledger has note, entry_type, delta, and user_number columns
--     and keeps them synchronized automatically via trigger
ALTER TABLE public.balance_ledger
  ADD COLUMN IF NOT EXISTS entry_type text,
  ADD COLUMN IF NOT EXISTS delta numeric(14, 2),
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS user_number integer;

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

UPDATE public.balance_ledger bl
SET
  entry_type = COALESCE(bl.entry_type, bl.type),
  delta = COALESCE(bl.delta, bl.amount),
  user_number = COALESCE(bl.user_number, p.user_number)
FROM public.profiles p
WHERE bl.user_id = p.id
  AND (bl.entry_type IS NULL OR bl.delta IS NULL OR bl.user_number IS NULL);

-- 2.3 Create user_notifications table for realtime bell notifications when a
--     deposit/withdrawal request is reviewed or balance is adjusted
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

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created_desc
  ON public.user_notifications (user_id, is_read, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.user_notifications FROM anon, authenticated;

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_admin_role('SUPPORT'));

-- RPC to mark user notifications as read
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

-- =============================================================================
-- PART 3: DEPOSIT, WITHDRAW, ADMIN REVIEW, MANUAL CREDIT/DEBIT & SEARCH RPCs
-- =============================================================================

-- 3.1 request_deposit(p_amount, p_note):
--     - Enforces amount 10.00 to 10000.00 (max 2 decimals)
--     - Blocks SUSPENDED or DISABLED users
--     - Enforces max 3 PENDING requests per user
--     - Includes user_number on the request row
--     - Does NOT credit balance until admin approval
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

  -- Block suspended or disabled/banned users
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

-- 3.2 request_withdraw(p_amount, p_note):
--     - Locks profile row FOR UPDATE
--     - Blocks SUSPENDED or DISABLED users
--     - Enforces amount 10.00 to 10000.00 (max 2 decimals)
--     - Enforces max 3 PENDING requests per user
--     - Validates p_amount <= (balance - pending_withdrawals)
--     - Includes user_number on the request row
--     - Does NOT deduct balance until admin approval
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

  -- Block suspended or disabled/banned users
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

-- 3.3 admin_review_request(p_request_id, p_approve, p_admin_note):
--     - Restricted to ADMIN or SUPERADMIN via auth.uid()
--     - Atomic and strictly idempotent: locks wallet_requests FOR UPDATE and profiles FOR UPDATE
--     - Only acts if status = 'PENDING'
--     - Applies balance change, writes balance_ledger row, writes admin_audit_log row,
--       and inserts a user_notifications row
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
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required to review virtual wallet requests';
  END IF;

  SELECT email INTO v_admin_email FROM public.profiles WHERE id = v_admin_id;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required';
  END IF;

  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Approval decision (true/false) is required';
  END IF;

  -- Lock the wallet_requests row first for strict idempotency
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

  -- Lock the target user's profile row FOR UPDATE
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
        RAISE EXCEPTION 'Cannot approve withdrawal: user current virtual balance ($%) is less than requested amount ($%)', v_profile.balance, v_req.amount;
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

-- 3.4 admin_adjust_user_balance(p_target_user_id, p_delta, p_note):
--     - ADMIN or SUPERADMIN only
--     - Requires non-empty reason (p_note)
--     - Prevents negative balances (balance + p_delta >= 0)
--     - Locks profile FOR UPDATE, updates balance, writes balance_ledger,
--       writes admin_audit_log, and sends user_notifications
DROP FUNCTION IF EXISTS public.admin_adjust_user_balance(uuid, numeric, text);

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
    RAISE EXCEPTION 'Forbidden: ADMIN or SUPERADMIN role required to adjust trader virtual balances';
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

-- 3.5 admin_search_users(p_query, p_role, p_status):
--     Parameterized server-side search restricted to admin roles (SUPPORT+).
--     Searches by:
--       1. Exact 5-digit User ID number (user_number) — prioritized first when input is 5 digits
--       2. Email (partial, case-insensitive)
--       3. Display name / name (partial, case-insensitive)
--       4. UUID (exact or prefix/partial)
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

-- =============================================================================
-- PART 4: PERMISSIONS & REALTIME PUBLICATIONS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.generate_user_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_user_number() TO authenticated;

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

ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END;
$$;

COMMIT;
