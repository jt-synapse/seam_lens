-- Edge middleware uses the caller's public Supabase client and verified session.
-- Standalone PostgreSQL performs the same allowlist check in the Node entry points.
DO $migration$
BEGIN
  IF to_regprocedure('auth.uid()') IS NOT NULL AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE OR REPLACE FUNCTION public.is_seamlens_admin()
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS 'SELECT EXISTS (SELECT FROM public.admin_users WHERE user_id = auth.uid())';
    REVOKE ALL ON FUNCTION public.is_seamlens_admin() FROM PUBLIC;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.is_seamlens_admin() FROM anon;
    END IF;
    GRANT EXECUTE ON FUNCTION public.is_seamlens_admin() TO authenticated;
  END IF;
END
$migration$;
