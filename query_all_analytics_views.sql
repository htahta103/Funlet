-- ============================================================================
-- QUERY ALL ANALYTICS VIEWS
-- ============================================================================
-- This file contains queries for all analytics views created by setup_analytics_views.sql
-- Run individual queries or sections as needed
-- ============================================================================

-- ============================================================================
-- QUICK SUMMARY - Run this first for an overview
-- ============================================================================

SELECT * FROM analytics_summary;

-- ============================================================================
-- FLOW ACTIVITY METRICS
-- ============================================================================

-- Per-organizer flow activity (events, sync-ups, crews, reminders)
SELECT * FROM analytics_flow_activity
ORDER BY events_created DESC, syncups_created DESC, crews_created DESC
LIMIT 50;  -- Adjust limit as needed

-- Aggregate flow activity summary (totals across all organizers)
SELECT * FROM analytics_flow_activity_summary;

-- ============================================================================
-- INVITEE BEHAVIOR METRICS
-- ============================================================================

-- Invitee behavior summary (totals: invites, replies, votes)
SELECT * FROM analytics_invitee_behavior_summary;

-- RSVP response rates (yes/no/unknown percentages)
SELECT * FROM analytics_rsvp_response_rates;

-- RSVP responses broken down by event
SELECT * FROM analytics_rsvp_by_event
ORDER BY total_responses DESC
LIMIT 50;  -- Adjust limit as needed

-- Sync-up vote distribution
SELECT * FROM analytics_syncup_votes
ORDER BY total_votes DESC
LIMIT 50;  -- Adjust limit as needed

-- Time to first reply (average and median in hours)
SELECT * FROM analytics_time_to_reply;

-- Time to vote for sync-ups (average and median in hours)
SELECT * FROM analytics_time_to_vote;

-- ============================================================================
-- FLOW COMPLETION METRICS
-- ============================================================================

-- Flow completion rates by workflow
SELECT * FROM analytics_flow_completion
ORDER BY flows_started DESC;

-- Flow drop-offs by workflow
SELECT * FROM analytics_flow_dropoffs
ORDER BY drop_off_count DESC;

-- Combined flow performance (starts, completions, drop-offs in one table)
SELECT * FROM analytics_flow_performance
ORDER BY flows_started DESC NULLS LAST;

-- Reminder effectiveness (how many reminders produced replies)
SELECT * FROM analytics_reminder_effectiveness;

-- Non-responders (invitees who never replied)
SELECT * FROM analytics_non_responders;

-- ============================================================================
-- SYSTEM HEALTH METRICS
-- ============================================================================

-- System health overview (SMS, errors, unrecognized replies, push notifications)
SELECT * FROM analytics_system_health;

-- Errors by type (frequency of each error type)
SELECT * FROM analytics_errors_by_type
ORDER BY error_count DESC
LIMIT 50;  -- Adjust limit as needed

-- Unrecognized replies over time (last 30 days by default)
SELECT * FROM analytics_unrecognized_replies_timeline
LIMIT 30;  -- Last 30 days

-- ============================================================================
-- COMBINED QUERIES - Multiple Views Together
-- ============================================================================

-- Complete analytics overview (all key metrics)
SELECT 
    'Summary' as view_name,
    (SELECT * FROM analytics_summary) as data
UNION ALL
SELECT 
    'Flow Activity Summary' as view_name,
    (SELECT * FROM analytics_flow_activity_summary) as data
UNION ALL
SELECT 
    'Invitee Behavior Summary' as view_name,
    (SELECT * FROM analytics_invitee_behavior_summary) as data
UNION ALL
SELECT 
    'System Health' as view_name,
    (SELECT * FROM analytics_system_health) as data;

-- ============================================================================
-- DETAILED ANALYSIS QUERIES
-- ============================================================================

-- Top 10 most active organizers
SELECT 
    organizer_id,
    events_created + syncups_created + crews_created as total_activity,
    events_created,
    syncups_created,
    crews_created,
    reminders_sent
FROM analytics_flow_activity
ORDER BY total_activity DESC
LIMIT 10;

-- Workflows with highest drop-off rates (where drop-off rate > 0)
SELECT * FROM analytics_flow_performance
WHERE drop_off_rate > 0
ORDER BY drop_off_rate DESC;

-- Workflows with lowest completion rates
SELECT * FROM analytics_flow_completion
WHERE flows_started > 0
ORDER BY completion_rate_percent ASC
LIMIT 20;

-- Events with highest response rates
SELECT * FROM analytics_rsvp_by_event
WHERE total_responses > 0
ORDER BY (yes_count::float / NULLIF(total_responses, 0)) DESC
LIMIT 20;

-- Most common error types
SELECT * FROM analytics_errors_by_type
WHERE error_count > 0
ORDER BY error_count DESC
LIMIT 20;

-- ============================================================================
-- TIME-BASED ANALYSIS (if you want to add date filters)
-- ============================================================================

-- Note: These queries modify the base views to add time filtering
-- Uncomment and adjust date range as needed

-- Flow activity in last 30 days (example - modify view query)
/*
SELECT 
    organizer_id,
    COUNT(CASE WHEN event_type = 'event_created' THEN 1 END) as events_created,
    COUNT(CASE WHEN event_type = 'syncup_created' THEN 1 END) as syncups_created,
    COUNT(CASE WHEN event_type = 'crew_created' THEN 1 END) as crews_created,
    COUNT(CASE WHEN event_type = 'reminder_sent' THEN 1 END) as reminders_sent
FROM behavioral_logs
WHERE organizer_id IS NOT NULL
  AND timestamp >= NOW() - INTERVAL '30 days'
GROUP BY organizer_id
ORDER BY events_created DESC;
*/

-- ============================================================================
-- EXPORT QUERIES - Ready for CSV/JSON Export
-- ============================================================================

-- Export: Complete analytics summary (single row, all metrics)
-- SELECT * FROM analytics_summary;

-- Export: Flow performance by workflow (for drop-off analysis)
-- SELECT * FROM analytics_flow_performance ORDER BY flows_started DESC;

-- Export: Organizer activity (for engagement analysis)
-- SELECT * FROM analytics_flow_activity ORDER BY events_created DESC;

-- Export: RSVP response rates (for engagement analysis)
-- SELECT * FROM analytics_rsvp_response_rates;

-- Export: Error analysis (for debugging)
-- SELECT * FROM analytics_errors_by_type ORDER BY error_count DESC;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. All views are prefixed with 'analytics_' for easy identification
-- 2. Views can be queried directly: SELECT * FROM [view_name];
-- 3. LIMIT clauses are included in some queries - adjust based on your data volume
-- 4. Results can be exported from Supabase SQL Editor as CSV or JSON
-- 5. Views are computed on-demand (real-time data)
-- 6. For time-based filtering, modify the base queries or create new views
-- ============================================================================














