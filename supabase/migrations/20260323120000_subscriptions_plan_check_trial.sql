-- Allow plan = trial (and keep paid slugs) on subscriptions.plan
-- Run if register-trial fails with: violates check constraint "subscriptions_plan_check"

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('starter', 'professional', 'agency', 'trial'));
