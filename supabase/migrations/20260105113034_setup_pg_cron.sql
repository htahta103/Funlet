-- Setup pg_cron for Auto Sync job processing
-- This schedules the Edge Function to run every minute via HTTP

-- Ensure pg_cron extension is enabled (should already be enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Ensure pg_net extension is enabled for HTTP calls (should already be enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant usage to postgres role (if needed)
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net TO postgres;

-- IMPORTANT: Before running this migration, you need to set your service role key
-- Option 1: Set it as a database setting (recommended for security)
-- Run this command first (replace with your actual service role key):
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key-here';

-- Option 2: Store in Supabase Vault and reference it
-- Option 3: Use the hardcoded version below (less secure, for testing only)

-- Unschedule existing job if it exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-auto-sync-jobs') THEN
    PERFORM cron.unschedule('process-auto-sync-jobs');
  END IF;
END $$;

-- Schedule job to run every minute
-- Calls Edge Function via HTTP
-- NOTE: Replace 'YOUR_SERVICE_ROLE_KEY' with your actual service role key
-- You can find it in Supabase Dashboard > Settings > API > service_role key
SELECT cron.schedule(
  'process-auto-sync-jobs',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url := 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/process-auto-sync-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjI1NTE5OCwiZXhwIjoyMDY3ODMxMTk4fQ.uic4jIEBQyhi9z830LUjsuWCOisBVa5H_1y7YjiQi-4' -- Replace this with your actual key or set app.settings.service_role_key
        )
      ),
      body := jsonb_build_object('trigger', 'cron')
    ) AS request_id;
  $$
);

-- Note: The Edge Function handles all job processing including:
-- - Sending reminder SMS to non-responders
-- - Scheduling pause check jobs  
-- - Pausing auto syncs when needed
-- - All duplicate prevention and idempotent checks

-- To update the service role key after migration:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-new-key';
-- Then restart the cron job or wait for next run

