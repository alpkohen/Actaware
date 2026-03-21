-- ActAware: audit + error logging for send-alerts-background.js
-- Run once in Supabase SQL Editor, or via: supabase db push (if project is linked)

-- Parsed RSS items sent to Anthropic (one row per feed per run)
CREATE TABLE IF NOT EXISTS public.raw_feed_logs (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL,
  feed_name   TEXT NOT NULL,
  feed_url    TEXT NOT NULL,
  item_count  INTEGER NOT NULL DEFAULT 0,
  items_json  JSONB,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.raw_feed_logs IS 'Per-feed parsed items before Claude; correlates with run_id from send-alerts-background';

CREATE INDEX IF NOT EXISTS idx_raw_feed_logs_run_id ON public.raw_feed_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_raw_feed_logs_fetched_at ON public.raw_feed_logs (fetched_at DESC);

-- Feed fetch / HTTP failures (one row per failed feed attempt)
CREATE TABLE IF NOT EXISTS public.feed_fetch_errors (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL,
  feed_name       TEXT NOT NULL,
  feed_url        TEXT,
  error_message   TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.feed_fetch_errors IS 'RSS/HTTP errors from send-alerts-background; optional ALERT_EMAIL for Resend alerts';

CREATE INDEX IF NOT EXISTS idx_feed_fetch_errors_run_id ON public.feed_fetch_errors (run_id);
CREATE INDEX IF NOT EXISTS idx_feed_fetch_errors_occurred_at ON public.feed_fetch_errors (occurred_at DESC);

-- Lock down from browser/anon: Netlify uses service_role key (bypasses RLS)
ALTER TABLE public.raw_feed_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_fetch_errors ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (server) can access; anon/authenticated cannot read audit data by default
