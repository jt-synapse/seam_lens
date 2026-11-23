-- Enforce a size band's ownership through its parent pattern.
ALTER TABLE public.patterns
  ADD CONSTRAINT patterns_id_maker_id_key UNIQUE (id, maker_id);

ALTER TABLE public.pattern_size_bands
  ADD CONSTRAINT pattern_size_bands_pattern_maker_fkey
  FOREIGN KEY (pattern_id, maker_id) REFERENCES public.patterns (id, maker_id)
  ON DELETE CASCADE NOT VALID;

DO $$
DECLARE
  mismatch RECORD;
BEGIN
  SELECT b.id AS band_id, p.id AS pattern_id, b.maker_id AS band_maker_id,
         p.maker_id AS pattern_maker_id, count(*) OVER () AS total
    INTO mismatch
    FROM public.pattern_size_bands b
    JOIN public.patterns p ON p.id = b.pattern_id
   WHERE b.maker_id <> p.maker_id
   ORDER BY b.id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Legacy pattern size band maker ownership is inconsistent',
      DETAIL = format('%s mismatched band(s). First band %s has maker %s, while pattern %s has maker %s.',
        mismatch.total, mismatch.band_id, mismatch.band_maker_id,
        mismatch.pattern_id, mismatch.pattern_maker_id),
      HINT = 'Review and correct size bands whose maker_id differs from the parent pattern before rerunning this migration.';
  END IF;
END;
$$;

ALTER TABLE public.pattern_size_bands
  VALIDATE CONSTRAINT pattern_size_bands_pattern_maker_fkey;

ALTER TABLE public.pattern_size_bands
  DROP CONSTRAINT pattern_size_bands_pattern_id_fkey;

CREATE FUNCTION public.enforce_ingestion_batch_maker_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.maker_id IS NOT DISTINCT FROM OLD.maker_id THEN
    RETURN NEW;
  END IF;

  -- Keep approval stable until the enqueue or reassignment commits.
  PERFORM 1 FROM public.makers
   WHERE id = NEW.maker_id AND vetted_status = 'approved'
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot import for maker %: maker must be approved', NEW.maker_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ingestion_batches_maker_approval
  BEFORE INSERT OR UPDATE OF maker_id ON public.ingestion_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ingestion_batch_maker_approval();

DO $$
DECLARE
  grantee TEXT;
  role_name TEXT;
  catalog_tables CONSTANT TEXT := 'public.patterns, public.pattern_size_bands, public.pattern_views, public.curated_archetypes';
  service_tables CONSTANT TEXT := 'public.query_sessions, public.ingestion_batches, public.ingestion_items, public.search_events, public.outbound_clicks, public.api_usage_ledger, public.admin_users, public.rate_limit_windows';
BEGIN
  -- Supabase default grants can include operations outside RLS, such as TRUNCATE.
  FOREACH role_name IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated'] LOOP
    IF role_name = 'PUBLIC' THEN
      grantee := 'PUBLIC';
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      grantee := quote_ident(role_name);
    ELSE
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.makers, %s, %s FROM %s',
      catalog_tables, service_tables, grantee);
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (id, slug, name, storefront_url, platform_type, vetted_status, permission_evidence_note, utm_campaign_slug, affiliate_query_param, created_at, updated_at) ON public.makers FROM %s',
      grantee
    );

    IF role_name <> 'PUBLIC' THEN
      EXECUTE format('GRANT SELECT (id, slug, name, storefront_url, vetted_status) ON public.makers TO %s', grantee);
      EXECUTE format('GRANT SELECT ON TABLE %s TO %s', catalog_tables, grantee);
    END IF;
  END LOOP;
END;
$$;
