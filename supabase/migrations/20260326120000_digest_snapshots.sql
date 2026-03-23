-- One row per London calendar day: standard-tier digest text for dashboard fallback
-- when a user has no sent_alerts rows yet (new signups, same-day sign-in, etc.).

CREATE TABLE IF NOT EXISTS public.digest_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  digest_date   DATE NOT NULL,
  run_id        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('digest', 'quiet_day')),
  alert_title   TEXT NOT NULL,
  alert_summary TEXT NOT NULL,
  alert_source  TEXT,
  importance    TEXT NOT NULL DEFAULT 'high',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_snapshots_digest_date_key UNIQUE (digest_date)
);

COMMENT ON TABLE public.digest_snapshots IS 'Daily standard digest copy for My Alerts when sent_alerts is empty; written by send-alerts-background';

CREATE INDEX IF NOT EXISTS idx_digest_snapshots_digest_date ON public.digest_snapshots (digest_date DESC);

ALTER TABLE public.digest_snapshots ENABLE ROW LEVEL SECURITY;
