-- Debug helper: returns what PostgreSQL actually sees for the current request.
-- Use from the app menu to confirm whether auth.uid() and JWT claims are set.
-- Safe to leave in place; readable by any authenticated or anon user.
-- Drop with: DROP FUNCTION IF EXISTS public.debug_auth();

CREATE OR REPLACE FUNCTION public.debug_auth()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'uid',        auth.uid()::text,
    'role',       current_setting('role', true),
    'has_claims', (nullif(current_setting('request.jwt.claims', true), '')) IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.debug_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.debug_auth() TO anon;
