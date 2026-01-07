-- Add google_calendar_event_link column to events table
-- This field stores the Google Calendar event HTML link when a calendar event is created

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS google_calendar_event_link TEXT;

COMMENT ON COLUMN public.events.google_calendar_event_link IS 'Google Calendar event HTML link. Set when a calendar event is created via Google Calendar API.';

