-- ============================================
-- Migration 009 -- AI-sector focus: disable crypto digest + weekly earnings preview
-- ============================================
-- Context: portfolio focus moved from SOFI to the AI sector, and all crypto
-- positions were closed — so the scheduled crypto news digest is retired.
-- A new weekly digest (Monday morning) lists which top / watched stocks
-- report earnings during the coming week (alerts function, ?mode=earnings-week).
--
-- Before running the cron section, REPLACE:
--   <YOUR_PROJECT_REF>      -> your Supabase project reference
--   <YOUR_SERVICE_ROLE_KEY> -> Dashboard > Settings > API > service_role key
-- ============================================

-- 1. Stop the scheduled crypto digest (function stays deployed for manual runs).
DO $cleanup$ BEGIN
  PERFORM cron.unschedule('analyze-crypto-every-2h');
EXCEPTION WHEN OTHERS THEN NULL;
END $cleanup$;

-- 2. Weekly earnings preview -- Monday 01:00 UTC (08:00 Asia/Bangkok).
SELECT cron.schedule(
  'weekly-earnings-digest',
  '0 1 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/alerts?mode=earnings-week',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
