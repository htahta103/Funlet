-- Fix the reset-monthly-usage cron job authentication issue
-- First unschedule the existing job
SELECT cron.unschedule('reset-monthly-usage');

-- Schedule the function with hardcoded service role key
SELECT cron.schedule(
  'reset-monthly-usage',
  '0 8 * * *',  -- Every day at 8:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/reset-monthly-usage',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjI1NTE5OCwiZXhwIjoyMDY3ODMxMTk4fQ.uic4jIEBQyhi9z830LUjsuWCOisBVa5H_1y7YjiQi-4'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- Verify the new schedule
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'reset-monthly-usage';
