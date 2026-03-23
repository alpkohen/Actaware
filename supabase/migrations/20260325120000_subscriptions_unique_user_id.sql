-- Ensure each user can only have one subscription row.
-- Step 1: Remove duplicates — keep the most recently created row per user_id.
DELETE FROM public.subscriptions
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM public.subscriptions
  ORDER BY user_id, created_at DESC NULLS LAST, id DESC
);

-- Step 2: Add the unique constraint (safe now that duplicates are gone).
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
