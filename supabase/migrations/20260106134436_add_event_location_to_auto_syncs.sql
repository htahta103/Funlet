-- Add event_location column to auto_syncs table
-- This field stores the optional location for the Auto Sync event
-- Used when creating calendar events and regular events

ALTER TABLE public.auto_syncs
ADD COLUMN IF NOT EXISTS event_location TEXT;

COMMENT ON COLUMN public.auto_syncs.event_location IS 'Optional location for the Auto Sync event. Used when creating calendar events and sending invites.';

