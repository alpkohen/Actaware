-- Idempotent: dedupe subscriptions by user_id and add UNIQUE(user_id) if missing.
-- Safe to run even if 20260325120000_subscriptions_unique_user_id.sql was already applied.
-- Uses id ordering only (no dependency on subscriptions.created_at).

DELETE FROM public.subscriptions s
WHERE s.id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM public.subscriptions
  ORDER BY user_id, id DESC
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscriptions_user_id_unique'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
  END IF;
END $$;
