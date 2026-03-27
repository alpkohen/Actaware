-- Judge numeric scores as queryable columns (eval-alerts.js maps parsed JSON here).

ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS accuracy_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS completeness_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS actionability_score SMALLINT;
ALTER TABLE public.eval_results ADD COLUMN IF NOT EXISTS clarity_score SMALLINT;

COMMENT ON COLUMN public.eval_results.accuracy_score IS 'Judge 1–5 (from scores.accuracy)';
COMMENT ON COLUMN public.eval_results.completeness_score IS 'Judge 1–5 (from scores.completeness)';
COMMENT ON COLUMN public.eval_results.actionability_score IS 'Judge 1–5 (from scores.actionability)';
COMMENT ON COLUMN public.eval_results.clarity_score IS 'Judge 1–5 (from scores.clarity)';
