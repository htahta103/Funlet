-- Store the service role key as a database setting
-- This allows pg_cron jobs to authenticate with edge functions
-- 
-- IMPORTANT: You need to replace 'YOUR_SERVICE_ROLE_KEY_HERE' with your actual service role key
-- You can find your service role key at: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/settings/api
--
-- Run this command manually after deployment:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-actual-service-role-key';

-- Note: We can't set the actual key in a migration file for security reasons
-- This is just a placeholder migration to document the required step
-- Execute the ALTER DATABASE command manually through the Supabase SQL Editor

