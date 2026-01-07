-- Create Analytics Views and Indexes
-- This migration creates reusable views for analytics metrics and adds indexes for performance

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index on event_type (most common filter)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_event_type ON behavioral_logs(event_type);

-- Index on timestamp (for time-based queries)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_timestamp ON behavioral_logs(timestamp);

-- Index on organizer_id (for organizer-specific queries)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_organizer_id ON behavioral_logs(organizer_id);

-- Index on event_id (for event-specific queries)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_event_id ON behavioral_logs(event_id) WHERE event_id IS NOT NULL;

-- Index on sync_up_id (for sync-up queries)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_sync_up_id ON behavioral_logs(sync_up_id) WHERE sync_up_id IS NOT NULL;

-- Index on invitee_contact_id (for invitee queries)
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_invitee_contact_id ON behavioral_logs(invitee_contact_id) WHERE invitee_contact_id IS NOT NULL;

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_event_type_timestamp ON behavioral_logs(event_type, timestamp);

-- ============================================================================
-- VIEW: Analytics Flow Activity
-- ============================================================================

CREATE OR REPLACE VIEW analytics_flow_activity AS
SELECT 
    organizer_id,
    COUNT(CASE WHEN event_type = 'event_created' THEN 1 END) as events_created,
    COUNT(CASE WHEN event_type = 'syncup_created' THEN 1 END) as syncups_created,
    COUNT(CASE WHEN event_type = 'crew_created' THEN 1 END) as crews_created,
    COUNT(CASE WHEN event_type = 'reminder_sent' THEN 1 END) as reminders_sent
FROM behavioral_logs
WHERE organizer_id IS NOT NULL
GROUP BY organizer_id;

-- Aggregate flow activity summary
CREATE OR REPLACE VIEW analytics_flow_activity_summary AS
SELECT 
    COUNT(CASE WHEN event_type = 'event_created' THEN 1 END) as total_events_created,
    COUNT(DISTINCT CASE WHEN event_type = 'event_created' THEN organizer_id END) as organizers_who_created_events,
    COUNT(CASE WHEN event_type = 'syncup_created' THEN 1 END) as total_syncups_created,
    COUNT(DISTINCT CASE WHEN event_type = 'syncup_created' THEN organizer_id END) as organizers_who_created_syncups,
    COUNT(CASE WHEN event_type = 'crew_created' THEN 1 END) as total_crews_created,
    COUNT(DISTINCT CASE WHEN event_type = 'crew_created' THEN organizer_id END) as organizers_who_created_crews,
    COUNT(CASE WHEN event_type = 'reminder_sent' THEN 1 END) as total_reminders_sent,
    COUNT(DISTINCT CASE WHEN event_type = 'reminder_sent' THEN organizer_id END) as organizers_who_sent_reminders
FROM behavioral_logs;

-- ============================================================================
-- VIEW: Analytics Invitee Behavior
-- ============================================================================

CREATE OR REPLACE VIEW analytics_invitee_behavior_summary AS
SELECT 
    COUNT(CASE WHEN event_type = 'invite_sent' THEN 1 END) as total_invites_sent,
    COUNT(DISTINCT CASE WHEN event_type = 'invite_sent' THEN event_id END) as events_with_invites,
    COUNT(DISTINCT CASE WHEN event_type = 'invite_sent' THEN sync_up_id END) as syncups_with_invites,
    COUNT(CASE WHEN event_type = 'invitee_reply_yes' THEN 1 END) as total_yes_replies,
    COUNT(CASE WHEN event_type = 'invitee_reply_no' THEN 1 END) as total_no_replies,
    COUNT(CASE WHEN event_type = 'invitee_reply_unknown' THEN 1 END) as total_unknown_replies,
    COUNT(CASE WHEN event_type = 'invitee_vote' THEN 1 END) as total_votes
FROM behavioral_logs;

-- RSVP response rates
CREATE OR REPLACE VIEW analytics_rsvp_response_rates AS
SELECT 
    event_type,
    COUNT(*) as response_count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as percentage
FROM behavioral_logs
WHERE event_type IN ('invitee_reply_yes', 'invitee_reply_no', 'invitee_reply_unknown')
GROUP BY event_type
ORDER BY response_count DESC;

-- RSVP response rates by event
CREATE OR REPLACE VIEW analytics_rsvp_by_event AS
SELECT 
    event_id,
    COUNT(CASE WHEN event_type = 'invitee_reply_yes' THEN 1 END) as yes_count,
    COUNT(CASE WHEN event_type = 'invitee_reply_no' THEN 1 END) as no_count,
    COUNT(CASE WHEN event_type = 'invitee_reply_unknown' THEN 1 END) as unknown_count,
    COUNT(CASE WHEN event_type IN ('invitee_reply_yes', 'invitee_reply_no', 'invitee_reply_unknown') THEN 1 END) as total_responses
FROM behavioral_logs
WHERE event_id IS NOT NULL
GROUP BY event_id
ORDER BY total_responses DESC;

-- Sync-up vote distribution
CREATE OR REPLACE VIEW analytics_syncup_votes AS
SELECT 
    sync_up_id,
    COUNT(*) as total_votes,
    COUNT(DISTINCT invitee_contact_id) as unique_voters
FROM behavioral_logs
WHERE event_type = 'invitee_vote'
GROUP BY sync_up_id
ORDER BY total_votes DESC;

-- Time to first reply (helper view)
CREATE OR REPLACE VIEW analytics_time_to_reply AS
WITH invite_times AS (
    SELECT 
        event_id,
        invitee_contact_id,
        timestamp as invite_sent_time
    FROM behavioral_logs
    WHERE event_type = 'invite_sent'
),
first_replies AS (
    SELECT 
        event_id,
        invitee_contact_id,
        MIN(timestamp) as first_reply_time
    FROM behavioral_logs
    WHERE event_type IN ('invitee_reply_yes', 'invitee_reply_no', 'invitee_reply_unknown')
    GROUP BY event_id, invitee_contact_id
)
SELECT 
    AVG(EXTRACT(EPOCH FROM (fr.first_reply_time - it.invite_sent_time)) / 3600) as avg_hours_to_reply,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fr.first_reply_time - it.invite_sent_time)) / 3600) as median_hours_to_reply,
    COUNT(*) as invitees_with_replies
FROM invite_times it
INNER JOIN first_replies fr ON it.event_id = fr.event_id AND it.invitee_contact_id = fr.invitee_contact_id;

-- Time to vote (helper view)
CREATE OR REPLACE VIEW analytics_time_to_vote AS
WITH syncup_invites AS (
    SELECT 
        sync_up_id,
        invitee_contact_id,
        timestamp as invite_sent_time
    FROM behavioral_logs
    WHERE event_type = 'invite_sent' AND sync_up_id IS NOT NULL
),
first_votes AS (
    SELECT 
        sync_up_id,
        invitee_contact_id,
        MIN(timestamp) as first_vote_time
    FROM behavioral_logs
    WHERE event_type = 'invitee_vote'
    GROUP BY sync_up_id, invitee_contact_id
)
SELECT 
    AVG(EXTRACT(EPOCH FROM (fv.first_vote_time - si.invite_sent_time)) / 3600) as avg_hours_to_vote,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fv.first_vote_time - si.invite_sent_time)) / 3600) as median_hours_to_vote,
    COUNT(*) as invitees_who_voted
FROM syncup_invites si
INNER JOIN first_votes fv ON si.sync_up_id = fv.sync_up_id AND si.invitee_contact_id = fv.invitee_contact_id;

-- ============================================================================
-- VIEW: Analytics Flow Completion
-- ============================================================================

-- Flow completion rates by workflow
CREATE OR REPLACE VIEW analytics_flow_completion AS
SELECT 
    workflow_name,
    COUNT(CASE WHEN event_type = 'flow_started' THEN 1 END) as flows_started,
    COUNT(CASE WHEN event_type = 'flow_completed' THEN 1 END) as flows_completed,
    ROUND(100.0 * COUNT(CASE WHEN event_type = 'flow_completed' THEN 1 END) / 
          NULLIF(COUNT(CASE WHEN event_type = 'flow_started' THEN 1 END), 0), 2) as completion_rate_percent
FROM behavioral_logs
WHERE event_type IN ('flow_started', 'flow_completed')
GROUP BY workflow_name
ORDER BY flows_started DESC;

-- Flow drop-offs
CREATE OR REPLACE VIEW analytics_flow_dropoffs AS
SELECT 
    workflow_name,
    COUNT(*) as drop_off_count
FROM behavioral_logs
WHERE event_type = 'drop_off'
GROUP BY workflow_name
ORDER BY drop_off_count DESC;

-- Reminder effectiveness (helper view)
CREATE OR REPLACE VIEW analytics_reminder_effectiveness AS
WITH reminders AS (
    SELECT 
        event_id,
        sync_up_id,
        invitee_contact_id,
        timestamp as reminder_time
    FROM behavioral_logs
    WHERE event_type = 'reminder_sent'
),
replies_after_reminder AS (
    SELECT 
        r.event_id,
        r.sync_up_id,
        r.invitee_contact_id,
        COUNT(*) as reply_count
    FROM reminders r
    INNER JOIN behavioral_logs bl ON (
        (r.event_id IS NOT NULL AND bl.event_id = r.event_id) OR
        (r.sync_up_id IS NOT NULL AND bl.sync_up_id = r.sync_up_id)
    )
    WHERE bl.event_type IN ('invitee_reply_yes', 'invitee_reply_no', 'invitee_reply_unknown', 'invitee_vote')
      AND bl.timestamp > r.reminder_time
      AND (r.invitee_contact_id IS NULL OR bl.invitee_contact_id = r.invitee_contact_id)
    GROUP BY r.event_id, r.sync_up_id, r.invitee_contact_id
)
SELECT 
    COUNT(*) as reminders_that_produced_reply,
    (SELECT COUNT(*) FROM reminders) as total_reminders,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM reminders), 0), 2) as reminder_response_rate_percent
FROM replies_after_reminder;

-- Non-responders (helper view)
CREATE OR REPLACE VIEW analytics_non_responders AS
WITH all_invites AS (
    SELECT DISTINCT
        event_id,
        sync_up_id,
        invitee_contact_id
    FROM behavioral_logs
    WHERE event_type = 'invite_sent'
),
invitees_who_replied AS (
    SELECT DISTINCT
        event_id,
        sync_up_id,
        invitee_contact_id
    FROM behavioral_logs
    WHERE event_type IN ('invitee_reply_yes', 'invitee_reply_no', 'invitee_reply_unknown', 'invitee_vote', 'invitee_confirmed')
)
SELECT 
    COUNT(*) as invitees_who_never_replied,
    (SELECT COUNT(*) FROM all_invites) as total_invites_sent,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM all_invites), 0), 2) as no_reply_rate_percent
FROM all_invites ai
LEFT JOIN invitees_who_replied iwr ON 
    ai.event_id = iwr.event_id AND 
    ai.invitee_contact_id = iwr.invitee_contact_id
WHERE iwr.invitee_contact_id IS NULL;

-- ============================================================================
-- VIEW: Analytics System Health
-- ============================================================================

CREATE OR REPLACE VIEW analytics_system_health AS
SELECT 
    -- SMS metrics
    COUNT(CASE WHEN event_type = 'sms_sent' THEN 1 END) as sms_sent,
    COUNT(CASE WHEN event_type = 'sms_received' THEN 1 END) as sms_received,
    ROUND(1.0 * COUNT(CASE WHEN event_type = 'sms_sent' THEN 1 END) / 
          NULLIF(COUNT(CASE WHEN event_type = 'sms_received' THEN 1 END), 0), 2) as sms_sent_to_received_ratio,
    
    -- Unrecognized replies
    COUNT(CASE WHEN event_type = 'invitee_reply_unknown' THEN 1 END) as unrecognized_replies,
    COUNT(DISTINCT CASE WHEN event_type = 'invitee_reply_unknown' THEN invitee_contact_id END) as unique_invitees_with_unrecognized_replies,
    
    -- Errors
    COUNT(CASE WHEN event_type = 'error' THEN 1 END) as total_errors,
    COUNT(DISTINCT CASE WHEN event_type = 'error' THEN metadata->>'error_type' END) as unique_error_types,
    
    -- Push notifications
    COUNT(CASE WHEN event_type = 'push_received' THEN 1 END) as pushes_received,
    COUNT(CASE WHEN event_type = 'push_opened' THEN 1 END) as pushes_opened,
    ROUND(100.0 * COUNT(CASE WHEN event_type = 'push_opened' THEN 1 END) / 
          NULLIF(COUNT(CASE WHEN event_type = 'push_received' THEN 1 END), 0), 2) as push_open_rate_percent
FROM behavioral_logs;

-- Error events by type
CREATE OR REPLACE VIEW analytics_errors_by_type AS
SELECT 
    metadata->>'error_type' as error_type,
    COUNT(*) as error_count
FROM behavioral_logs
WHERE event_type = 'error'
GROUP BY metadata->>'error_type'
ORDER BY error_count DESC;

-- Unrecognized replies over time
CREATE OR REPLACE VIEW analytics_unrecognized_replies_timeline AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as unrecognized_replies
FROM behavioral_logs
WHERE event_type = 'invitee_reply_unknown'
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- ============================================================================
-- VIEW: Analytics Summary (All Key Metrics)
-- ============================================================================

CREATE OR REPLACE VIEW analytics_summary AS
SELECT 
    -- Flow Activity
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'event_created') as total_events_created,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'syncup_created') as total_syncups_created,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'crew_created') as total_crews_created,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'reminder_sent') as total_reminders_sent,
    
    -- Invitee Behavior
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'invite_sent') as total_invites_sent,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'invitee_reply_yes') as total_yes_replies,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'invitee_reply_no') as total_no_replies,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'invitee_reply_unknown') as total_unknown_replies,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'invitee_vote') as total_votes,
    
    -- Flow Completion
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'flow_started') as total_flows_started,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'flow_completed') as total_flows_completed,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'drop_off') as total_drop_offs,
    
    -- System Health
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'sms_sent') as total_sms_sent,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'sms_received') as total_sms_received,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'error') as total_errors,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'push_received') as total_pushes_received,
    (SELECT COUNT(*) FROM behavioral_logs WHERE event_type = 'push_opened') as total_pushes_opened;
















