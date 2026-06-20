-- ============================================
-- pg_cron Schedule Setup
-- ============================================
-- Run this in the Supabase SQL Editor AFTER deploying the edge function.
--
-- ⚠️ REPLACE these placeholders before running:
--   <YOUR_PROJECT_REF>   → your Supabase project reference (e.g., "abcdefghijkl")
--   <YOUR_SERVICE_ROLE_KEY> → found in Dashboard > Settings > API > service_role key
-- ============================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Schedule the stock analysis every hour
-- Runs at :00 of every hour.
-- (Drop the old 30-min job first if this migration was run before, so we don't
--  leave a duplicate firing on the half-hour.)
DO $cleanup$ BEGIN
  PERFORM cron.unschedule('analyze-stocks-every-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $cleanup$;

SELECT cron.schedule(
  'analyze-stocks-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/analyze-stocks',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 3. Schedule daily cleanup at 3:00 AM UTC
SELECT cron.schedule(
  'cleanup-old-records-daily',
  '0 3 * * *',
  $$
  SELECT public.cleanup_old_records();
  $$
);

-- ============================================
-- Useful commands:
-- ============================================
-- View all scheduled jobs:
--   SELECT * FROM cron.job;
--
-- View recent job runs:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- Unschedule a job:
--   SELECT cron.unschedule('analyze-stocks-hourly');
--
-- Manually trigger the edge function (for testing):
--   SELECT net.http_post(
--     url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/analyze-stocks',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
