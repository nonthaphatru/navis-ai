-- ============================================
-- Migration 003 -- Event Alerts (+ crypto log fix)
-- ============================================
-- Run in the Supabase SQL Editor, OR apply via the Management API.
--
-- NOTE: crypto_seen_articles / crypto_analysis_log already exist in this
-- project (created during initial setup), so this migration does NOT recreate
-- them -- it only adds the `error` column the hardened analyze-crypto function
-- now writes to. It creates the genuinely-new alert state tables and schedules
-- the crypto / alerts / heartbeat cron jobs.
--
-- Before running the cron section, REPLACE:
--   <YOUR_PROJECT_REF>      -> your Supabase project reference
--   <YOUR_SERVICE_ROLE_KEY> -> Dashboard > Settings > API > service_role key
-- ============================================

-- 1. Make sure the crypto log can record errors (added by the failure-alert change).
ALTER TABLE public.crypto_analysis_log ADD COLUMN IF NOT EXISTS error TEXT;

-- 2. Alert state tables -----------------------------------------------------

-- One row per ticker -- remembers the last price alert so we don't repeat the
-- same direction multiple times in a day.
CREATE TABLE IF NOT EXISTS public.price_alert_state (
  ticker          TEXT PRIMARY KEY,
  last_alert_date DATE,
  last_direction  TEXT,   -- 'up' | 'down'
  last_pct        NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe SEC filings by accession number.
CREATE TABLE IF NOT EXISTS public.seen_filings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession_no  TEXT NOT NULL UNIQUE,
  ticker        TEXT,
  form_type     TEXT,
  filed_at      DATE,
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seen_filings_acc ON public.seen_filings (accession_no);
CREATE INDEX IF NOT EXISTS idx_seen_filings_created ON public.seen_filings (created_at);

-- Dedupe earnings reminders so each upcoming report is announced once.
CREATE TABLE IF NOT EXISTS public.sent_earnings_reminders (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker        TEXT NOT NULL,
  earnings_date DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, earnings_date)
);
CREATE INDEX IF NOT EXISTS idx_earnings_reminders_created ON public.sent_earnings_reminders (created_at);

-- 3. Row Level Security for the new tables (service role bypasses RLS) -------

ALTER TABLE public.price_alert_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seen_filings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_earnings_reminders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_alert_state', 'seen_filings', 'sent_earnings_reminders'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access on %1$s" ON public.%1$s;', t);
    EXECUTE format('CREATE POLICY "Service role full access on %1$s" ON public.%1$s FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- 4. Extend cleanup to prune all tables (uses each table's real timestamp col)

CREATE OR REPLACE FUNCTION public.cleanup_old_records()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Stock tables
  DELETE FROM public.seen_articles WHERE created_at < now() - INTERVAL '7 days';
  DELETE FROM public.analysis_log  WHERE run_at     < now() - INTERVAL '30 days';

  -- Crypto tables (crypto_seen_articles uses seen_at)
  DELETE FROM public.crypto_seen_articles WHERE seen_at < now() - INTERVAL '7 days';
  DELETE FROM public.crypto_analysis_log  WHERE run_at  < now() - INTERVAL '30 days';

  -- Alert state
  DELETE FROM public.seen_filings            WHERE created_at < now() - INTERVAL '21 days';
  DELETE FROM public.sent_earnings_reminders WHERE created_at < now() - INTERVAL '60 days';
END;
$$;

-- 5. Cron schedule ----------------------------------------------------------
-- REPLACE <YOUR_PROJECT_REF> and <YOUR_SERVICE_ROLE_KEY> first.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Crypto analysis -- every 30 min, 15 min after the stock job.
SELECT cron.schedule(
  'analyze-crypto-every-30min',
  '15,45 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/analyze-crypto',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Event alerts -- every 30 min, 10 min after the stock job.
SELECT cron.schedule(
  'market-alerts-every-30min',
  '10,40 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/alerts',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Daily heartbeat at 13:00 UTC.
SELECT cron.schedule(
  'navis-heartbeat-daily',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/alerts?mode=heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
