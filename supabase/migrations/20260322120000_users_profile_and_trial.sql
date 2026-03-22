-- ActAware: employer profile fields, free-trial support, nullable Stripe IDs on trial rows
-- Run in Supabase SQL Editor or: supabase db push

-- ── Users: names, sector, org context (for future sector-specific copy) ─────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_size TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS signup_notes TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.industry IS 'Employer sector — used for future tailored alert context';
COMMENT ON COLUMN public.users.trial_used_at IS 'Set when user starts free trial; blocks duplicate trials on same email';

-- ── Subscriptions: trial window (no Stripe until checkout) ───────────────────
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.trial_ends_at IS 'For plan=trial: digest emails until this instant (UTC)';

-- Trial rows may exist before Stripe checkout
ALTER TABLE public.subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN stripe_subscription_id DROP NOT NULL;

-- Recommended after deduping: CREATE UNIQUE INDEX subscriptions_user_id_unique ON public.subscriptions (user_id);
