-- Keep the source of a size-band merge for historical click and import attribution.
ALTER TABLE public.patterns
  ADD COLUMN merged_into_pattern_id uuid,
  ADD CONSTRAINT merged_pattern_same_maker
    FOREIGN KEY (merged_into_pattern_id, maker_id) REFERENCES public.patterns(id, maker_id),
  ADD CONSTRAINT merged_pattern_unpublished
    CHECK (merged_into_pattern_id IS NULL OR (merged_into_pattern_id <> id AND status = 'unpublished'));
CREATE INDEX patterns_merge_target ON public.patterns(merged_into_pattern_id)
  WHERE merged_into_pattern_id IS NOT NULL;

-- A revision covers the view and the shared parent fields and bands in its form.
-- The parent is updated on ingestion, save, publication changes and band merges.
CREATE FUNCTION public.advance_pattern_view_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
CREATE TRIGGER advance_pattern_view_revision BEFORE UPDATE ON public.pattern_views
  FOR EACH ROW EXECUTE FUNCTION public.advance_pattern_view_revision();

CREATE FUNCTION public.invalidate_pattern_view_revisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.pattern_views SET updated_at = clock_timestamp() WHERE pattern_id = NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_pattern_view_revisions AFTER UPDATE ON public.patterns
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_pattern_view_revisions();
