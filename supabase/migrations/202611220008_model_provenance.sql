-- Older rows have unknown provenance. Write model IDs only when producing new vectors.
ALTER TABLE public.query_sessions
  ADD COLUMN vision_model text,
  ADD COLUMN embedding_model text;

ALTER TABLE public.pattern_views ADD COLUMN embedding_model text;
