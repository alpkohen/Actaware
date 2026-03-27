-- Align public.eval_results with netlify/functions/eval-alerts.js inserts.
--
-- eval-alerts.js writes these columns (both insert paths):
--   case_id, source, digest_tier, model, claude_output, judge_raw, scores,
--   judge_error, summariser_error, golden_snapshot
-- Auto-managed by DB (not in insert): id, created_at
--
-- 20260401120000_eval_results.sql already defines the full table. Use this file if the
-- table was created manually or is missing columns.

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS case_id TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS digest_tier TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS claude_output TEXT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS judge_raw TEXT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS scores JSONB;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS judge_error TEXT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS summariser_error TEXT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS golden_snapshot JSONB;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS accuracy_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS completeness_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS actionability_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS clarity_score SMALLINT;

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.eval_results.case_id IS 'Golden dataset case_id';
COMMENT ON COLUMN public.eval_results.source IS 'Source label (e.g. GOV.UK)';
COMMENT ON COLUMN public.eval_results.digest_tier IS 'standard | professional';
COMMENT ON COLUMN public.eval_results.model IS 'Claude model id used for summariser + judge';
COMMENT ON COLUMN public.eval_results.claude_output IS 'Digest-format summariser output';
COMMENT ON COLUMN public.eval_results.judge_raw IS 'Raw judge LLM response (JSON text)';
COMMENT ON COLUMN public.eval_results.scores IS 'Parsed judge scores JSON';
COMMENT ON COLUMN public.eval_results.judge_error IS 'Judge parse/API error message';
COMMENT ON COLUMN public.eval_results.summariser_error IS 'Summariser Claude error message';
COMMENT ON COLUMN public.eval_results.golden_snapshot IS 'Expected fields + input snapshot';

COMMENT ON COLUMN public.eval_results.accuracy_score IS 'Judge 1–5';
COMMENT ON COLUMN public.eval_results.completeness_score IS 'Judge 1–5';
COMMENT ON COLUMN public.eval_results.actionability_score IS 'Judge 1–5';
COMMENT ON COLUMN public.eval_results.clarity_score IS 'Judge 1–5';
