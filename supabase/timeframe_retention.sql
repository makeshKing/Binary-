-- =============================================================================
-- supabase/timeframe_retention.sql
-- Ensures price_ticks retention is at least 2 hours so 100 x 30s candles
-- (~50 minutes of history) and tab resyncs can always load from public.price_ticks.
-- =============================================================================

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

REVOKE EXECUTE ON FUNCTION public.cleanup_old_ticks() FROM PUBLIC, anon, authenticated;
