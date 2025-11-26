-- Add subscription tracking columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS ai_messages_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sms_sent_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS events_created INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS billing_cycle_start DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'standard', 'pro', 'enterprise'));

-- Create function to check usage limits
CREATE OR REPLACE FUNCTION check_usage_limits(
  user_phone TEXT,
  action_type TEXT DEFAULT 'ai_message'
)
RETURNS JSON AS $$
DECLARE
  user_profile RECORD;
  tier_limits RECORD;
  result JSON;
BEGIN
  -- Get user profile
  SELECT * INTO user_profile
  FROM profiles 
  WHERE phone_number = user_phone
  LIMIT 1;

  IF user_profile IS NULL THEN
    RETURN json_build_object(
      'allowed', false,
      'error', 'User not found'
    );
  END IF;

  -- Get tier limits from stripe_products table
  SELECT * INTO tier_limits
  FROM stripe_products 
  WHERE tier = user_profile.subscription_tier AND is_active = true
  LIMIT 1;

  IF tier_limits IS NULL THEN
    -- Default to free tier if no tier found
    SELECT * INTO tier_limits
    FROM stripe_products 
    WHERE tier = 'free' AND is_active = true
    LIMIT 1;
  END IF;

  -- Check if user has exceeded limits
  DECLARE
    ai_limit_exceeded BOOLEAN := FALSE;
    sms_limit_exceeded BOOLEAN := FALSE;
    events_limit_exceeded BOOLEAN := FALSE;
    limit_exceeded_type TEXT := NULL;
  BEGIN
    -- Check AI messages limit
    IF user_profile.ai_messages_used >= tier_limits.ai_messages_limit THEN
      ai_limit_exceeded := TRUE;
      limit_exceeded_type := 'ai_messages';
    END IF;

    -- Check SMS limit
    IF user_profile.sms_sent_count >= tier_limits.sms_messages_limit THEN
      sms_limit_exceeded := TRUE;
      limit_exceeded_type := 'sms_messages';
    END IF;

    -- Check events limit
    IF user_profile.events_created >= tier_limits.events_limit THEN
      events_limit_exceeded := TRUE;
      limit_exceeded_type := 'events';
    END IF;

    -- Build result
    result := json_build_object(
      'allowed', NOT (ai_limit_exceeded OR sms_limit_exceeded OR events_limit_exceeded),
      'plan', user_profile.subscription_tier,
      'limits', json_build_object(
        'ai_messages', tier_limits.ai_messages_limit,
        'sms_messages', tier_limits.sms_messages_limit,
        'events', tier_limits.events_limit
      ),
      'usage', json_build_object(
        'ai_messages_used', user_profile.ai_messages_used,
        'sms_messages_used', user_profile.sms_sent_count,
        'events_created', user_profile.events_created
      ),
      'limit_exceeded', limit_exceeded_type
    );
  END;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create function to increment usage
CREATE OR REPLACE FUNCTION increment_usage(
  user_phone TEXT,
  action_type TEXT DEFAULT 'ai_message'
)
RETURNS JSON AS $$
DECLARE
  user_profile RECORD;
  updated_profile RECORD;
BEGIN
  -- Get user profile
  SELECT * INTO user_profile
  FROM profiles 
  WHERE phone_number = user_phone
  LIMIT 1;

  IF user_profile IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Increment appropriate counter based on action type
  IF action_type = 'ai_message' THEN
    UPDATE profiles 
    SET ai_messages_used = ai_messages_used + 1,
        updated_at = NOW()
    WHERE phone_number = user_phone;
  ELSIF action_type = 'sms_message' THEN
    UPDATE profiles 
    SET sms_sent_count = sms_sent_count + 1,
        updated_at = NOW()
    WHERE phone_number = user_phone;
  ELSIF action_type = 'event_created' THEN
    UPDATE profiles 
    SET events_created = events_created + 1,
        updated_at = NOW()
    WHERE phone_number = user_phone;
  END IF;

  -- Get updated profile
  SELECT * INTO updated_profile
  FROM profiles 
  WHERE phone_number = user_phone
  LIMIT 1;

  RETURN json_build_object(
    'success', true,
    'usage', json_build_object(
      'ai_messages_used', updated_profile.ai_messages_used,
      'sms_messages_used', updated_profile.sms_sent_count,
      'events_created', updated_profile.events_created
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Create function to reset monthly usage (for billing cycle resets)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Reset usage counters for all users
  UPDATE profiles 
  SET ai_messages_used = 0,
      sms_sent_count = 0,
      events_created = 0,
      billing_cycle_start = CURRENT_DATE,
      updated_at = NOW();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;
