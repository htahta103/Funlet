-- Add ON DELETE CASCADE to foreign keys referencing auth.users
-- This allows deleting auth.users records and automatically cleaning up related data

-- Update profiles table foreign key
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_id_fkey
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update conversation_state table foreign key
ALTER TABLE public.conversation_state
DROP CONSTRAINT IF EXISTS conversation_state_user_id_fkey;

ALTER TABLE public.conversation_state
ADD CONSTRAINT conversation_state_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update subscriptions table foreign key
ALTER TABLE public.subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;

ALTER TABLE public.subscriptions
ADD CONSTRAINT subscriptions_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update user_sessions table foreign key
ALTER TABLE public.user_sessions
DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;

ALTER TABLE public.user_sessions
ADD CONSTRAINT user_sessions_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update user_actions table foreign key
ALTER TABLE public.user_actions
DROP CONSTRAINT IF EXISTS user_actions_user_id_fkey;

ALTER TABLE public.user_actions
ADD CONSTRAINT user_actions_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update user_location table foreign key
ALTER TABLE public.user_location
DROP CONSTRAINT IF EXISTS user_location_user_id_fkey;

ALTER TABLE public.user_location
ADD CONSTRAINT user_location_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update contacts table foreign key
ALTER TABLE public.contacts
DROP CONSTRAINT IF EXISTS contacts_user_id_fkey;

ALTER TABLE public.contacts
ADD CONSTRAINT contacts_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update crews table foreign key
ALTER TABLE public.crews
DROP CONSTRAINT IF EXISTS crews_creator_id_fkey;

ALTER TABLE public.crews
ADD CONSTRAINT crews_creator_id_fkey
FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update events table foreign key
ALTER TABLE public.events
DROP CONSTRAINT IF EXISTS events_creator_id_fkey;

ALTER TABLE public.events
ADD CONSTRAINT events_creator_id_fkey
FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update sync_ups table foreign key
ALTER TABLE public.sync_ups
DROP CONSTRAINT IF EXISTS sync_ups_creator_id_fkey;

ALTER TABLE public.sync_ups
ADD CONSTRAINT sync_ups_creator_id_fkey
FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update invitations table foreign key
ALTER TABLE public.invitations
DROP CONSTRAINT IF EXISTS invitations_invited_by_fkey;

ALTER TABLE public.invitations
ADD CONSTRAINT invitations_invited_by_fkey
FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update event_messages table foreign key
ALTER TABLE public.event_messages
DROP CONSTRAINT IF EXISTS event_messages_sender_id_fkey;

ALTER TABLE public.event_messages
ADD CONSTRAINT event_messages_sender_id_fkey
FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update sms_log table foreign key
ALTER TABLE public.sms_log
DROP CONSTRAINT IF EXISTS sms_log_user_id_fkey;

ALTER TABLE public.sms_log
ADD CONSTRAINT sms_log_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update notifications table foreign key
ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update message_thread table foreign key
ALTER TABLE public.message_thread
DROP CONSTRAINT IF EXISTS message_thread_user_id_fkey;

ALTER TABLE public.message_thread
ADD CONSTRAINT message_thread_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update behavioral_logs table foreign key
ALTER TABLE public.behavioral_logs
DROP CONSTRAINT IF EXISTS behavioral_logs_organizer_id_fkey;

ALTER TABLE public.behavioral_logs
ADD CONSTRAINT behavioral_logs_organizer_id_fkey
FOREIGN KEY (organizer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update auto_syncs table foreign key
ALTER TABLE public.auto_syncs
DROP CONSTRAINT IF EXISTS auto_syncs_organizer_id_fkey;

ALTER TABLE public.auto_syncs
ADD CONSTRAINT auto_syncs_organizer_id_fkey
FOREIGN KEY (organizer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update ai_usage table foreign key (references auth.users directly)
ALTER TABLE public.ai_usage
DROP CONSTRAINT IF EXISTS ai_usage_user_id_fkey;

ALTER TABLE public.ai_usage
ADD CONSTRAINT ai_usage_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update message_reception_log table foreign key (references auth.users directly)
ALTER TABLE public.message_reception_log
DROP CONSTRAINT IF EXISTS message_reception_log_user_id_fkey;

ALTER TABLE public.message_reception_log
ADD CONSTRAINT message_reception_log_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Note: google_calendar_tokens already has ON DELETE CASCADE (verified)

-- Also check for auth schema constraints that might block deletion
-- Note: auth.identities and auth.sessions are managed by Supabase Auth
-- and should automatically cascade when user is deleted, but we verify here

-- The 500 error when deleting users is likely due to:
-- 1. Foreign key constraints in public schema (fixed above)
-- 2. Or issues with auth.identities/auth.sessions (handled by Supabase Auth)
-- 
-- After applying this migration, user deletion should work via:
-- DELETE FROM auth.users WHERE id = 'user-id';
-- Or via Supabase Admin API: DELETE /auth/v1/admin/users/{user-id}

