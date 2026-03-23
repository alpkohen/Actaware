-- Used by Netlify check-auth-email (service role) to show honest forgot-password UX.
-- Not granted to anon/authenticated (email enumeration is an accepted product trade-off here).

CREATE OR REPLACE FUNCTION public.auth_email_exists(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(trim(email::text)) = lower(trim(p_email))
  );
$$;

COMMENT ON FUNCTION public.auth_email_exists(TEXT) IS 'True if Supabase Auth has this email; server-only via service_role.';

REVOKE ALL ON FUNCTION public.auth_email_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_email_exists(TEXT) TO service_role;
