-- Add digest_tier if eval_results was created without it (e.g. manual table or older script).

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS digest_tier TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.eval_results.digest_tier IS 'standard | professional — matches digest summariser tier used for the eval run';
