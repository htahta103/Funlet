-- Remove default timezone from handle_new_user function
-- preferred_timezone should be NULL initially, set during Auto Sync if empty

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  normalized_phone TEXT;
  from_google BOOLEAN;
BEGIN
  -- Normalize phone number
  normalized_phone := COALESCE(NEW.raw_user_meta_data->>'phone_number', '');
  
  IF normalized_phone LIKE '+1%' THEN
    normalized_phone := SUBSTRING(normalized_phone FROM 3);
  ELSIF normalized_phone LIKE '1%' AND LENGTH(normalized_phone) = 11 THEN
    normalized_phone := SUBSTRING(normalized_phone FROM 2);
  END IF;

  -- Check if user has google provider
  from_google := FALSE;
  IF NEW.raw_app_meta_data->'providers' ? 'google' THEN
    from_google := TRUE;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    first_name,
    phone_number,
    subscription_status,
    sms_sent_count,
    created_at,
    updated_at,
    preferred_timezone,
    notification_preferences,
    ai_settings,
    conversation_context,
    user_behavior_patterns,
    sms_consent,
    from_google
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'first_name',
      split_part(NEW.raw_user_meta_data->>'name', ' ', 1),
      'User'
    ),
    normalized_phone,
    'trial',
    0,
    NOW(),
    NOW(),
    NULL,  -- Changed from 'America/Los_Angeles' to NULL
    '{"sms": true, "push": false, "email": true}'::jsonb,
    '{"voice_enabled": false, "proactive_suggestions": true}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    from_google
  );

  RETURN NEW;
END;
$$;




