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

-- 2. Schedule the stock analysis every 30 minutes
-- Runs at :00 and :30 of every hour
SELECT cron.schedule(
  'analyze-stocks-every-30min',
  '*/30 * * * *',
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
--   SELECT cron.unschedule('analyze-stocks-every-30min');
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
