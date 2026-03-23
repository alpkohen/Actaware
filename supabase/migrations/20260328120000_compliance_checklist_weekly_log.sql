-- Professional dashboard: checklist progress + weekly summary dedupe

CREATE TABLE IF NOT EXISTS public.user_compliance_checklist (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  item_id text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_compliance_checklist_user
  ON public.user_compliance_checklist (user_id);

COMMENT ON TABLE public.user_compliance_checklist IS 'Per-user checklist items for compliance score (Professional/Agency); updated via Netlify dashboard-compliance';

CREATE TABLE IF NOT EXISTS public.weekly_summary_log (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  period_ending date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_ending)
);

COMMENT ON TABLE public.weekly_summary_log IS 'Prevents duplicate Friday weekly digest emails; period_ending is Friday date Europe/London';

ALTER TABLE public.user_compliance_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_summary_log ENABLE ROW LEVEL SECURITY;
