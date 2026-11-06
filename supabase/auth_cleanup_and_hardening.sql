-- =============================================================================
-- PULSEOPTION TRADING PLATFORM — AUTHENTICATION CLEANUP & HARDENING SQL
-- Safe to re-run in the Supabase SQL Editor (uses IF NOT EXISTS, CREATE OR REPLACE,
-- DROP POLICY IF EXISTS).
-- =============================================================================
-- DASHBOARD SETTING REQUIRED:
-- In your Supabase Dashboard, go to:
--   Authentication -> Providers -> Anonymous Sign-Ins -> Turn OFF "Enable Anonymous Sign-Ins"
-- =============================================================================

-- =============================================================================
-- STEP 1: INSPECTION QUERY (RUN THIS FIRST TO REVIEW GUEST/ANONYMOUS USERS)
-- Shows every anonymous or guest user in auth.users and counts their rows across
-- profiles, trades, wallet_requests, balance_ledger, and user_notifications.
-- =============================================================================
SELECT
  u.id AS user_id,
  u.email,
  u.is_anonymous,
  u.created_at AS auth_created_at,
  p.user_number,
  p.display_name,
  p.balance,
  (SELECT COUNT(*) FROM public.trades t WHERE t.user_id = u.id) AS trades_count,
  (SELECT COUNT(*) FROM public.wallet_requests wr WHERE wr.user_id = u.id) AS wallet_requests_count,
  (SELECT COUNT(*) FROM public.balance_ledger bl WHERE bl.user_id = u.id) AS ledger_rows_count,
  (SELECT COUNT(*) FROM public.user_notifications un WHERE un.user_id = u.id) AS notifications_count
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.is_anonymous IS TRUE
   OR u.email ILIKE '%@demo.local'
   OR u.email ILIKE 'guest%@%'
ORDER BY u.created_at DESC;

-- =============================================================================
-- STEP 2: DELETE EXISTING GUEST / ANONYMOUS USERS AND ALL DEPENDENT ROWS
-- Deletes notifications, ledger entries, wallet requests, trades, profiles,
-- and auth.users rows where is_anonymous = true (or demo.local guest rows).
-- =============================================================================
BEGIN;

-- 2a. Delete user_notifications for anonymous/guest users
DELETE FROM public.user_notifications
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE is_anonymous IS TRUE
     OR email ILIKE '%@demo.local'
);

-- 2b. Delete balance_ledger rows for anonymous/guest users
DELETE FROM public.balance_ledger
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE is_anonymous IS TRUE
     OR email ILIKE '%@demo.local'
);

-- 2c. Delete wallet_requests rows for anonymous/guest users
DELETE FROM public.wallet_requests
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE is_anonymous IS TRUE
     OR email ILIKE '%@demo.local'
);

-- 2d. Delete trades rows for anonymous/guest users
DELETE FROM public.trades
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE is_anonymous IS TRUE
     OR email ILIKE '%@demo.local'
);

-- 2e. Delete profiles rows for anonymous/guest users
DELETE FROM public.profiles
WHERE id IN (
  SELECT id FROM auth.users
  WHERE is_anonymous IS TRUE
     OR email ILIKE '%@demo.local'
);

-- 2f. Delete the anonymous/guest users from auth.users
DELETE FROM auth.users
WHERE is_anonymous IS TRUE
   OR email ILIKE '%@demo.local';

COMMIT;

-- =============================================================================
-- STEP 3: BLOCK ANONYMOUS USERS AT DATABASE LEVEL & HARDEN SIGNUP TRIGGER
-- Ensures:
-- 1. Any attempt to insert an anonymous user in auth.users is rejected by trigger.
-- 2. Every real registered user gets a profile, a unique 5-digit user_number
--    (10000..99999), and $0.00 starting balance until deposit approval.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_real_authenticated_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

GRANT EXECUTE ON FUNCTION public.is_real_authenticated_user() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_real_authenticated_user() FROM anon, public;

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
  -- Reject anonymous sign-ins at the database trigger level
  IF COALESCE(NEW.is_anonymous, false) IS TRUE THEN
    RAISE EXCEPTION 'Anonymous guest accounts are disabled. Please sign up with a valid email and password.';
  END IF;

  v_display_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(COALESCE(NEW.email, 'Trader'), '@', 1),
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
  SELECT
    NEW.id,
    v_user_number,
    'INITIAL_CREDIT',
    'INITIAL_CREDIT',
    0.00,
    0.00,
    0.00,
    'Live trading account opened ($0.00 starting balance) — User ID: ' || v_user_number
  WHERE NOT EXISTS (
    SELECT 1 FROM public.balance_ledger bl
    WHERE bl.user_id = NEW.id AND bl.type = 'INITIAL_CREDIT'
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
-- STEP 4: HARDEN RLS POLICIES SO ANONYMOUS SESSIONS CANNOT READ OR WRITE DATA
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Revoke table access from anon role completely on user data tables
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.trades FROM anon;
REVOKE ALL ON public.wallet_requests FROM anon;
REVOKE ALL ON public.balance_ledger FROM anon;
REVOKE ALL ON public.user_notifications FROM anon;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_real_authenticated_user()
    AND (auth.uid() = id OR public.is_support_or_admin())
  );

DROP POLICY IF EXISTS "wallet_requests_select_own_or_admin" ON public.wallet_requests;
CREATE POLICY "wallet_requests_select_own_or_admin"
  ON public.wallet_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_real_authenticated_user()
    AND (auth.uid() = user_id OR public.is_support_or_admin())
  );

DROP POLICY IF EXISTS "balance_ledger_select_own_or_admin" ON public.balance_ledger;
CREATE POLICY "balance_ledger_select_own_or_admin"
  ON public.balance_ledger
  FOR SELECT
  TO authenticated
  USING (
    public.is_real_authenticated_user()
    AND (auth.uid() = user_id OR public.is_support_or_admin())
  );

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own"
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (
    public.is_real_authenticated_user()
    AND auth.uid() = user_id
  );

DROP POLICY IF EXISTS "user_notifications_update_own" ON public.user_notifications;
CREATE POLICY "user_notifications_update_own"
  ON public.user_notifications
  FOR UPDATE
  TO authenticated
  USING (
    public.is_real_authenticated_user()
    AND auth.uid() = user_id
  )
  WITH CHECK (
    public.is_real_authenticated_user()
    AND auth.uid() = user_id
  );

-- Verification check: confirm 0 anonymous users remain
SELECT COUNT(*) AS remaining_anonymous_users
FROM auth.users
WHERE is_anonymous IS TRUE;
