-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests (required for calling edge functions)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing cron job if it exists (in case we're updating)
SELECT cron.unschedule('reset-monthly-usage');

-- Schedule the daily billing cycle reset function to run at 8:00 AM UTC every day
SELECT cron.schedule(
  'reset-monthly-usage',
  '0 8 * * *',  -- Every day at 8:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/reset-monthly-usage',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);

-- View all scheduled cron jobs to verify
-- SELECT * FROM cron.job;

