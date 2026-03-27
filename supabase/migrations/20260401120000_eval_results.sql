-- Golden-dataset eval runs (eval-alerts Netlify function). Service role writes; no anon policies.

CREATE TABLE IF NOT EXISTS public.eval_results (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  case_id TEXT NOT NULL,
  source TEXT,
  digest_tier TEXT NOT NULL DEFAULT 'standard',
  model TEXT NOT NULL,
  claude_output TEXT,
  judge_raw TEXT,
  scores JSONB,
  judge_error TEXT,
  summariser_error TEXT,
  golden_snapshot JSONB
);

COMMENT ON TABLE public.eval_results IS 'Digest summariser eval: golden cases, Claude output, judge JSON scores';

CREATE INDEX IF NOT EXISTS idx_eval_results_created_at ON public.eval_results (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_results_case_id ON public.eval_results (case_id);

ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;
