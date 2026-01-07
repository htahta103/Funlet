# Funlet Analytics Queries Documentation

This document explains the SQL queries and database views that compute metrics from the `behavioral_logs` table as specified in `Funlet_Basic_Analytics_Specification.md`.

## Files Overview

- **`analytics_queries.sql`** - Original queries (for reference)
- **`analytics_dashboard_queries.sql`** - Dashboard-ready queries optimized for Supabase SQL Editor ⭐ **RECOMMENDED**
- **`supabase/migrations/[timestamp]_create_analytics_views.sql`** - Database migration that creates reusable views and indexes
- **`analytics_report_template.md`** - Template for documenting analytics results

## Table Structure

The `behavioral_logs` table contains the following key columns:

- `organizer_id` (uuid, nullable) - The organizer/user who initiated the action
- `event_type` (enum) - Type of event (see event types below)
- `crew_id` (uuid, nullable) - Related crew
- `event_id` (uuid, nullable) - Related event
- `sync_up_id` (uuid, nullable) - Related sync-up
- `invitee_contact_id` (uuid, nullable) - Invitee contact (for invitee events)
- `contact_id` (uuid, nullable) - Organizer contact (for organizer events)
- `workflow_name` (string) - Name of the workflow
- `workflow_step` (string) - Step within the workflow
- `metadata` (jsonb) - Additional metadata including workflow details
- `timestamp` (timestamp) - When the event occurred
- `platform` (string) - Platform (typically 'sms')

## Event Types

### Organizer Events
- `flow_started` - Flow begins
- `flow_completed` - Flow completes successfully
- `flow_step` - Step within a flow
- `drop_off` - Flow started but not completed
- `crew_created` - Crew created
- `crew_updated` - Crew members added/removed
- `event_created` - Event created
- `syncup_created` - Sync-up created
- `reminder_sent` - Organizer sends reminder
- `finalize_triggered` - Organizer finalizes event/sync-up
- `push_received` - Push notification received
- `push_opened` - Push notification opened

### Invitee Events
- `invite_sent` - SMS invite sent to invitee
- `invitee_reply_yes` - Invitee replies YES
- `invitee_reply_no` - Invitee replies NO
- `invitee_reply_unknown` - Message not recognized
- `invitee_vote` - Vote on sync-up option
- `invitee_timeout` - No reply after timeout
- `invitee_confirmed` - Invitee confirms after follow-up

### System Events
- `sms_sent` - Outbound SMS delivered
- `sms_received` - Inbound SMS handled
- `error` - Backend or flow error
- `latency` - Round-trip processing time

## Query Categories

### 2.1 Flow Activity Metrics

Queries that measure organizer activity:
- Events created per organizer
- Sync-ups created per organizer
- Crews created per organizer
- Reminders sent by organizers

**Usage**: Run these queries to understand organizer engagement and feature usage.

### 2.2 Invitee Behavior Metrics

Queries that measure invitee responses:
- Total invites sent
- RSVP response rates (yes/no/unknown)
- Sync-up vote distribution
- Time to first reply (average & median)
- Time to vote (sync-up)

**Usage**: Run these queries to understand invitee engagement and response patterns.

**Note**: Time-based queries use CTEs to match invite events with reply/vote events. They compute time differences in hours.

### 2.3 Flow Completion Metrics

Queries that measure flow success rates:
- Flow start → flow complete rate (by workflow)
- Flow drop-off counts
- Reminders that produce replies
- Invitees who never reply

**Usage**: Run these queries to identify where users drop off and which flows need improvement.

**Note**: The reminder response query finds reminders and checks if replies occurred after the reminder timestamp.

### 2.4 System Health Metrics

Queries that measure system performance:
- SMS sent vs. received
- Unrecognized replies
- Error events (type + frequency)
- Push notification open rates

**Usage**: Run these queries to monitor system health and identify issues.

## How to Use

### Step 1: Apply Migration (One-Time Setup)

First, apply the migration to create views and indexes:

1. Go to Supabase Dashboard → SQL Editor
2. Open the migration file: `supabase/migrations/[timestamp]_create_analytics_views.sql`
3. Copy and paste the entire migration into SQL Editor
4. Run the migration (this creates all views and indexes)

Alternatively, if using Supabase CLI:
```bash
supabase db push
```

### Step 2: Use Dashboard Queries (Recommended)

**For Supabase Dashboard (Easiest):**

1. Open Supabase Dashboard → SQL Editor
2. Open `analytics_dashboard_queries.sql`
3. Copy and paste individual queries or sections as needed
4. Run queries directly in the dashboard
5. View results, export as CSV/JSON, or save queries for later

**Quick Start - Run Summary:**
```sql
SELECT * FROM analytics_summary;
```

### Option 1: Use Pre-Built Views (Fastest)

After running the migration, you can query views directly:

```sql
-- Quick summary of all metrics
SELECT * FROM analytics_summary;

-- Flow activity per organizer
SELECT * FROM analytics_flow_activity ORDER BY events_created DESC;

-- Invitee behavior summary
SELECT * FROM analytics_invitee_behavior_summary;

-- Flow completion rates
SELECT * FROM analytics_flow_completion ORDER BY flows_started DESC;

-- System health overview
SELECT * FROM analytics_system_health;
```

**Available Views:**
- `analytics_summary` - All key metrics in one row
- `analytics_flow_activity` - Per-organizer activity
- `analytics_flow_activity_summary` - Aggregate flow activity
- `analytics_invitee_behavior_summary` - Invitee metrics summary
- `analytics_rsvp_response_rates` - RSVP breakdown
- `analytics_rsvp_by_event` - RSVP by event
- `analytics_syncup_votes` - Sync-up vote distribution
- `analytics_time_to_reply` - Time to reply metrics
- `analytics_time_to_vote` - Time to vote metrics
- `analytics_flow_completion` - Flow completion rates
- `analytics_flow_dropoffs` - Drop-off counts
- `analytics_reminder_effectiveness` - Reminder response rates
- `analytics_non_responders` - Non-responder metrics
- `analytics_system_health` - System health overview
- `analytics_errors_by_type` - Errors by type
- `analytics_unrecognized_replies_timeline` - Unrecognized replies over time

### Option 2: Run Individual Queries

Copy and paste individual queries from `analytics_dashboard_queries.sql` into the Supabase SQL Editor. Each query is clearly commented and can be run independently.

### Option 3: Export Results

1. Run queries in Supabase SQL Editor
2. Click "Export" button to download as CSV or JSON
3. Analyze in spreadsheet or data analysis tools
4. Use `analytics_report_template.md` to document findings

## Quick Reference

### Most Common Queries

**Quick Summary (Run this first):**
```sql
SELECT * FROM analytics_summary;
```

**Flow Activity:**
```sql
SELECT * FROM analytics_flow_activity_summary;
SELECT * FROM analytics_flow_activity ORDER BY events_created DESC LIMIT 10;
```

**Invitee Behavior:**
```sql
SELECT * FROM analytics_invitee_behavior_summary;
SELECT * FROM analytics_rsvp_response_rates;
SELECT * FROM analytics_time_to_reply;
```

**Flow Completion:**
```sql
SELECT * FROM analytics_flow_completion ORDER BY flows_started DESC;
SELECT * FROM analytics_flow_dropoffs ORDER BY drop_off_count DESC;
```

**System Health:**
```sql
SELECT * FROM analytics_system_health;
SELECT * FROM analytics_errors_by_type ORDER BY error_count DESC LIMIT 10;
```

### Dashboard Usage Tips

1. **Bookmark Queries:** Save frequently-used queries in Supabase SQL Editor
2. **Create Favorites:** Pin important views for quick access
3. **Schedule Reports:** Use the template to document regular reports
4. **Export Data:** Download results for deeper analysis in Excel/Sheets
5. **Share Queries:** Copy query URLs to share with team members

## Database Indexes

The migration creates indexes for optimal performance:
- `idx_behavioral_logs_event_type` - Fast filtering by event type
- `idx_behavioral_logs_timestamp` - Fast time-based queries
- `idx_behavioral_logs_organizer_id` - Fast organizer queries
- `idx_behavioral_logs_event_id` - Fast event-specific queries
- `idx_behavioral_logs_sync_up_id` - Fast sync-up queries
- `idx_behavioral_logs_invitee_contact_id` - Fast invitee queries
- `idx_behavioral_logs_event_type_timestamp` - Composite index for common patterns

## Notes

- All queries filter by `event_type` to ensure accurate metrics
- Time-based calculations use PostgreSQL's `EXTRACT(EPOCH FROM ...)` to compute differences in seconds, then convert to hours
- Some queries use CTEs (Common Table Expressions) to match related events
- Percentages are rounded to 2 decimal places
- `NULLIF` is used to prevent division by zero errors
- Views are automatically updated as new data is logged
- All views use `CREATE OR REPLACE` so they can be updated without dropping

## Troubleshooting

If queries return no results:
1. Verify that `behavioral_logs` table exists and has data
2. Check that event types match exactly (case-sensitive)
3. Ensure timestamps are in the expected format
4. Verify that `organizer_id`, `event_id`, `sync_up_id`, or `invitee_contact_id` columns contain expected values

If queries are slow:
- Ensure the migration has been applied (indexes are created automatically)
- Filter by date range if analyzing large datasets: `WHERE timestamp >= NOW() - INTERVAL '30 days'`
- Use views instead of raw queries for better performance
- Check that indexes exist: `\d behavioral_logs` in psql or check in Supabase dashboard

## Future Enhancements

Consider creating:
- Materialized views for frequently-accessed metrics
- Scheduled reports via Supabase Edge Functions
- Automated alerts for error thresholds
- Time-series analysis for trends over time

