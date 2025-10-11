-- Create function to handle auto-launch onboarding on user signup
CREATE OR REPLACE FUNCTION handle_new_user_signup()
RETURNS TRIGGER AS $$
DECLARE
  user_phone TEXT;
  user_first_name TEXT;
  user_email TEXT;
BEGIN
  -- Extract user data from auth.users
  SELECT 
    COALESCE(raw_user_meta_data->>'phone_number', raw_user_meta_data->>'phone'),
    COALESCE(raw_user_meta_data->>'first_name', raw_user_meta_data->>'name', 'User'),
    COALESCE(raw_user_meta_data->>'email', email)
  INTO user_phone, user_first_name, user_email
  FROM auth.users 
  WHERE id = NEW.id;

  -- Only proceed if we have a phone number
  IF user_phone IS NOT NULL AND user_phone != '' THEN
    -- Call the auto-launch onboarding function
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/auto-launch-onboarding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'user_id', NEW.id,
        'phone_number', user_phone,
        'first_name', user_first_name,
        'email', user_email
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users insert
DROP TRIGGER IF EXISTS trigger_auto_launch_onboarding ON auth.users;
CREATE TRIGGER trigger_auto_launch_onboarding
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_signup();

-- Add settings for the trigger (these should be set in your Supabase dashboard)
-- You'll need to set these in your Supabase project settings:
-- app.settings.supabase_url = 'https://your-project.supabase.co'
-- app.settings.service_role_key = 'your-service-role-key'
