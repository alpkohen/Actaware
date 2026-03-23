-- Review log for compliance checklist + store weekly recap text in DB for dashboard

CREATE TABLE IF NOT EXISTS public.compliance_checklist_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  item_id text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccr_user_item ON public.compliance_checklist_reviews (user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_ccr_user_created ON public.compliance_checklist_reviews (user_id, created_at DESC);

COMMENT ON TABLE public.compliance_checklist_reviews IS 'Per-item review audit trail (Professional/Agency); optional note each time';

ALTER TABLE public.compliance_checklist_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.weekly_summary_log
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS summary_html text;

COMMENT ON COLUMN public.weekly_summary_log.summary_text IS 'Plain weekly recap for dashboard';
COMMENT ON COLUMN public.weekly_summary_log.summary_html IS 'HTML fragment matching email body for print/PDF';
