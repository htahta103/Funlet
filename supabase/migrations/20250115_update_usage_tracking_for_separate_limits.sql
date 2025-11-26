-- Update check_usage_limits function to handle separate AI and SMS limits
CREATE OR REPLACE FUNCTION check_usage_limits(
  user_phone TEXT,
  action_type TEXT DEFAULT 'ai_interaction'
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

  -- Check specific limit based on action_type
  DECLARE
    limit_exceeded BOOLEAN := FALSE;
    limit_exceeded_type TEXT := NULL;
  BEGIN
    -- Check AI interactions limit
    IF action_type = 'ai_interaction' THEN
      IF user_profile.ai_messages_used >= tier_limits.ai_messages_limit THEN
        limit_exceeded := TRUE;
        limit_exceeded_type := 'ai_interaction';
      END IF;
    -- Check SMS sent limit
    ELSIF action_type = 'sms_sent' THEN
      IF user_profile.sms_sent_count >= tier_limits.sms_messages_limit THEN
        limit_exceeded := TRUE;
        limit_exceeded_type := 'sms_sent';
      END IF;
    -- Check events limit (for backward compatibility)
    ELSIF action_type = 'create_event' THEN
      IF user_profile.events_created >= tier_limits.events_limit THEN
        limit_exceeded := TRUE;
        limit_exceeded_type := 'create_event';
      END IF;
    END IF;

    -- Build result
    result := json_build_object(
      'allowed', NOT limit_exceeded,
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

-- Update increment_usage function to handle new action types
CREATE OR REPLACE FUNCTION increment_usage(
  user_phone TEXT,
  action_type TEXT DEFAULT 'ai_interaction'
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
  IF action_type = 'ai_interaction' THEN
    UPDATE profiles 
    SET ai_messages_used = ai_messages_used + 1,
        updated_at = NOW()
    WHERE phone_number = user_phone;
  ELSIF action_type = 'sms_sent' THEN
    UPDATE profiles 
    SET sms_sent_count = sms_sent_count + 1,
        updated_at = NOW()
    WHERE phone_number = user_phone;
  ELSIF action_type = 'create_event' THEN
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
