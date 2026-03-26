-- S-1: API rate limiting (service role only via RPC)
-- S-5: Prevent duplicate cron runs (daily / weekly / critical pulse)
-- S-4: Faster ILIKE search on sent_alerts (dashboard-alerts)

-- ── Rate limit buckets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_rate_buckets (
  bucket_key text NOT NULL,
  window_epoch bigint NOT NULL,
  hit_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_epoch)
);

ALTER TABLE public.api_rate_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.actaware_consume_rate(
  p_bucket text,
  p_window_seconds int,
  p_max int
)
RETURNS TABLE(allowed boolean, hit_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w_epoch bigint;
  c int;
BEGIN
  w_epoch := floor(extract(epoch from now()) / p_window_seconds)::bigint;
  INSERT INTO public.api_rate_buckets (bucket_key, window_epoch, hit_count)
  VALUES (p_bucket, w_epoch, 1)
  ON CONFLICT (bucket_key, window_epoch)
  DO UPDATE SET hit_count = api_rate_buckets.hit_count + 1
  RETURNING api_rate_buckets.hit_count INTO c;
  RETURN QUERY SELECT (c <= p_max), c;
END;
$$;

REVOKE ALL ON FUNCTION public.actaware_consume_rate(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actaware_consume_rate(text, int, int) TO service_role;

-- ── Digest / cron run lock (one successful run per lock_key) ───────────────
CREATE TABLE IF NOT EXISTS public.digest_run_lock (
  lock_key text PRIMARY KEY,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.digest_run_lock ENABLE ROW LEVEL SECURITY;

-- ── Trigram indexes for alert search (ILIKE %term%) ─────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS sent_alerts_title_trgm
  ON public.sent_alerts USING gin (alert_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS sent_alerts_summary_trgm
  ON public.sent_alerts USING gin (alert_summary gin_trgm_ops);
