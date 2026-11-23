ALTER TABLE public.api_usage_ledger
  ALTER COLUMN estimated_cost_usd TYPE NUMERIC;

CREATE TABLE public.api_usage_budget_days (
  usage_date DATE PRIMARY KEY
);

CREATE TABLE public.api_usage_reservations (
  request_id TEXT PRIMARY KEY,
  usage_date DATE NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('search_vision', 'search_embed', 'ingest_vision', 'ingest_embed')),
  max_cost_usd NUMERIC NOT NULL CHECK (max_cost_usd >= 0 AND max_cost_usd < 'Infinity'::NUMERIC),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'settled', 'released'))
);

CREATE INDEX idx_api_usage_reservations_held_day
  ON public.api_usage_reservations (usage_date) WHERE status = 'held';

ALTER TABLE public.api_usage_budget_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_reservations ENABLE ROW LEVEL SECURITY;

-- The no-op update serializes writers and causes a serialization error for stale
-- repeatable-read snapshots. Each wrapper call runs as a standalone statement.
CREATE FUNCTION public.lock_api_usage_day(p_day DATE) RETURNS VOID
LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $$
  INSERT INTO public.api_usage_budget_days (usage_date)
  VALUES (p_day)
  ON CONFLICT (usage_date) DO UPDATE SET usage_date = EXCLUDED.usage_date;
$$;

CREATE FUNCTION public.api_usage_cost_for_day(p_day DATE) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT
    COALESCE((SELECT SUM(estimated_cost_usd) FROM public.api_usage_ledger WHERE usage_date = p_day), 0) +
    COALESCE((SELECT SUM(max_cost_usd) FROM public.api_usage_reservations WHERE usage_date = p_day AND status = 'held'), 0);
$$;

CREATE FUNCTION public.reserve_api_usage(
  p_request_id TEXT, p_operation TEXT, p_max_cost NUMERIC, p_cap NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  usage_day DATE := (statement_timestamp() AT TIME ZONE 'UTC')::DATE;
  current_cost NUMERIC;
BEGIN
  PERFORM public.lock_api_usage_day(usage_day);

  IF EXISTS (SELECT 1 FROM public.api_usage_reservations WHERE request_id = p_request_id) THEN
    RETURN 'duplicate';
  END IF;

  current_cost := public.api_usage_cost_for_day(usage_day);
  IF current_cost >= p_cap OR current_cost + p_max_cost > p_cap THEN
    RETURN 'exceeded';
  END IF;

  INSERT INTO public.api_usage_reservations (request_id, usage_date, operation, max_cost_usd)
  VALUES (p_request_id, usage_day, p_operation, p_max_cost)
  ON CONFLICT (request_id) DO NOTHING;

  IF NOT FOUND THEN
    -- A request with the same ID may have reserved under another UTC day lock.
    RETURN 'duplicate';
  END IF;

  RETURN 'reserved';
END;
$$;

CREATE FUNCTION public.add_api_usage(
  p_day DATE, p_operation TEXT, p_input_tokens BIGINT, p_output_tokens BIGINT, p_cost NUMERIC
) RETURNS VOID
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.lock_api_usage_day(p_day);
  INSERT INTO public.api_usage_ledger AS ledger
    (usage_date, operation, request_count, input_tokens, output_tokens, estimated_cost_usd)
  VALUES (p_day, p_operation, 1, p_input_tokens, p_output_tokens, p_cost)
  ON CONFLICT (usage_date, operation) DO UPDATE SET
    request_count = ledger.request_count + EXCLUDED.request_count,
    input_tokens = ledger.input_tokens + EXCLUDED.input_tokens,
    output_tokens = ledger.output_tokens + EXCLUDED.output_tokens,
    estimated_cost_usd = ledger.estimated_cost_usd + EXCLUDED.estimated_cost_usd;
END;
$$;

-- A NULL cost means a confirmed unbilled outcome. Keep its request ID so the
-- same paid call is never dispatched twice, even across midnight.
CREATE FUNCTION public.finish_api_usage(
  p_request_id TEXT, p_input_tokens BIGINT, p_output_tokens BIGINT, p_cost NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  reserved_day DATE;
  reserved_operation TEXT;
BEGIN
  SELECT usage_date INTO reserved_day
  FROM public.api_usage_reservations WHERE request_id = p_request_id AND status = 'held';
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Match reservation's lock ordering. The status update and ledger entry
  -- commit together, so budget readers always count one or the other.
  PERFORM public.lock_api_usage_day(reserved_day);
  UPDATE public.api_usage_reservations
  SET status = CASE WHEN p_cost IS NULL THEN 'released' ELSE 'settled' END
  WHERE request_id = p_request_id AND status = 'held'
  RETURNING operation INTO reserved_operation;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_cost IS NOT NULL THEN
    PERFORM public.add_api_usage(reserved_day, reserved_operation, p_input_tokens, p_output_tokens, p_cost);
  END IF;
  RETURN TRUE;
END;
$$;

DO $$
DECLARE
  role_name TEXT;
  grantee TEXT;
  tables CONSTANT TEXT := 'public.api_usage_budget_days, public.api_usage_reservations';
  functions CONSTANT TEXT := 'public.lock_api_usage_day(DATE), public.api_usage_cost_for_day(DATE), public.reserve_api_usage(TEXT, TEXT, NUMERIC, NUMERIC), public.add_api_usage(DATE, TEXT, BIGINT, BIGINT, NUMERIC), public.finish_api_usage(TEXT, BIGINT, BIGINT, NUMERIC)';
BEGIN
  FOREACH role_name IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated'] LOOP
    IF role_name = 'PUBLIC' THEN
      grantee := 'PUBLIC';
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      grantee := quote_ident(role_name);
    ELSE
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %s', tables, grantee);
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s', functions, grantee);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %s, public.api_usage_ledger TO service_role', tables);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', functions);
  END IF;
END;
$$;
