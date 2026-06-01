-- ============================================
-- Stock News Analysis Pipeline — Database Setup
-- ============================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. Table: seen_articles
-- Stores hashes of processed articles to avoid duplicate analysis.
-- Auto-cleans entries older than 7 days.
CREATE TABLE IF NOT EXISTS public.seen_articles (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_hash  TEXT NOT NULL UNIQUE,
  title         TEXT,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast hash lookups
CREATE INDEX IF NOT EXISTS idx_seen_articles_hash ON public.seen_articles (article_hash);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_seen_articles_created ON public.seen_articles (created_at);

-- 2. Table: analysis_log
-- Stores each analysis run for history and debugging.
-- Auto-cleans entries older than 30 days.
CREATE TABLE IF NOT EXISTS public.analysis_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  articles_found  INT DEFAULT 0,
  new_articles    INT DEFAULT 0,
  summary         TEXT,
  sentiment       TEXT,
  raw_response    JSONB,
  notification_sent BOOLEAN DEFAULT false,
  error           TEXT
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_analysis_log_run_at ON public.analysis_log (run_at);

-- 3. Auto-cleanup function
-- Removes old records to keep the database small on free tier.
CREATE OR REPLACE FUNCTION public.cleanup_old_records()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Remove seen articles older than 7 days
  DELETE FROM public.seen_articles
  WHERE created_at < now() - INTERVAL '7 days';

  -- Remove analysis logs older than 30 days
  DELETE FROM public.analysis_log
  WHERE run_at < now() - INTERVAL '30 days';
END;
$$;

-- 4. Enable Row Level Security (good practice)
ALTER TABLE public.seen_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access on seen_articles"
  ON public.seen_articles
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on analysis_log"
  ON public.analysis_log
  FOR ALL
  USING (true)
  WITH CHECK (true);
