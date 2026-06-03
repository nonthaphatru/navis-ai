-- ============================================
-- Migration 008 -- Auto-cleanup cron (3 days)
-- ============================================

-- Update cleanup to 3 days for all tables
CREATE OR REPLACE FUNCTION public.cleanup_old_records()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.seen_articles
  WHERE created_at < now() - INTERVAL '3 days';

  DELETE FROM public.analysis_log
  WHERE run_at < now() - INTERVAL '3 days';
END;
$$;

-- Enable pg_cron and schedule daily at 4 AM UTC (11 AM Thailand)
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'cleanup-old-logs',
  '0 4 * * *',
  $$ SELECT public.cleanup_old_records(); $$
);
