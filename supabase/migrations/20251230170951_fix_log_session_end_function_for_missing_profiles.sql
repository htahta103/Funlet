-- Fix log_session_end_on_logout function to handle missing profiles
-- When a user doesn't have a profile, set organizer_id to NULL instead of failing

CREATE OR REPLACE FUNCTION public.log_session_end_on_logout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  session_id_uuid uuid;
  session_start_time timestamptz;
  session_duration_seconds integer;
  detected_platform text;
  session_start_platform text;
  profile_exists boolean;
  organizer_id_value uuid;
BEGIN
  -- Use the deleted session's id
  session_id_uuid := OLD.id;
  
  -- Check if profile exists for this user
  SELECT EXISTS(
    SELECT 1 
    FROM public.profiles 
    WHERE id = OLD.user_id
  ) INTO profile_exists;
  
  -- Set organizer_id to user_id if profile exists, NULL otherwise
  IF profile_exists THEN
    organizer_id_value := OLD.user_id;
  ELSE
    organizer_id_value := NULL;
  END IF;
  
  -- Bypass RLS for reading from behavioral_logs
  SET LOCAL row_security = off;
  
  -- Check if we already logged session_end for this user in the last 2 seconds
  -- This prevents duplicate logs when multiple sessions are deleted simultaneously
  IF profile_exists AND EXISTS (
    SELECT 1 
    FROM public.behavioral_logs
    WHERE organizer_id = OLD.user_id
      AND event_type = 'session_end'
      AND created_at > NOW() - INTERVAL '2 seconds'
  ) THEN
    -- Already logged a session_end recently for this user, skip this one
    -- This handles the case where multiple sessions are deleted at once
    RETURN OLD;
  END IF;
  
  -- Detect platform from user_agent
  detected_platform := public.detect_platform_from_user_agent(OLD.user_agent);
  
  -- Try to get platform from the original session_start log (only if profile exists)
  IF profile_exists THEN
    SELECT platform::text INTO session_start_platform
    FROM public.behavioral_logs
    WHERE organizer_id = OLD.user_id
      AND session_id = session_id_uuid
      AND event_type = 'session_start'
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Use platform from session_start if available, otherwise use detected platform
    IF session_start_platform IS NOT NULL THEN
      detected_platform := session_start_platform;
    END IF;
    
    -- Find the corresponding session_start to calculate duration
    SELECT created_at INTO session_start_time
    FROM public.behavioral_logs
    WHERE organizer_id = OLD.user_id
      AND session_id = session_id_uuid
      AND event_type = 'session_start'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  
  -- Calculate session duration if we found a start time
  IF session_start_time IS NOT NULL THEN
    session_duration_seconds := EXTRACT(EPOCH FROM (OLD.updated_at - session_start_time))::integer;
  ELSE
    -- Fallback: use session's own created_at and updated_at
    session_duration_seconds := EXTRACT(EPOCH FROM (OLD.updated_at - OLD.created_at))::integer;
  END IF;
  
  -- Insert session_end event into behavioral_logs
  -- organizer_id will be NULL if profile doesn't exist (which is allowed)
  INSERT INTO public.behavioral_logs (
    organizer_id,
    session_id,
    event_type,
    platform,
    timestamp,
    metadata,
    created_at
  ) VALUES (
    organizer_id_value,  -- NULL if no profile, user_id if profile exists
    session_id_uuid,
    'session_end',
    detected_platform::text::platform_type,
    OLD.updated_at,
    jsonb_build_object(
      'auth_session_id', OLD.id::text,
      'session_duration_seconds', session_duration_seconds,
      'logout_method', 'session_deleted',
      'user_agent', COALESCE(OLD.user_agent, 'unknown'),
      'ip_address', COALESCE(OLD.ip::text, 'unknown'),
      'source', 'database_trigger',
      'session_created_at', OLD.created_at::text,
      'session_updated_at', OLD.updated_at::text,
      'profile_exists', profile_exists
    ),
    NOW()
  );
  
  RETURN OLD;
END;
$function$;




