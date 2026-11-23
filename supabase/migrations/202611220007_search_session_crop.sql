-- Browser-prepared crops have no server-side crop coordinates. Existing sessions
-- retain their original crop_box and interpretation.
ALTER TABLE public.query_sessions ADD COLUMN client_cropped boolean NOT NULL DEFAULT false;
CREATE INDEX query_sessions_expiry ON public.query_sessions (expires_at);
