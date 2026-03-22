-- Included seats per subscription (pricing page: Professional 3, Agency 15, Starter 1).
-- Enforcement (invite flow) can be added later; webhook sets defaults on checkout.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS seat_limit INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.subscriptions.seat_limit IS 'Max ActAware users covered; Professional=3, Agency=15, Starter=1 by webhook';
