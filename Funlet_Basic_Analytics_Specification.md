# Funlet Basic Analytics Specification (Draft v1)

## 1. Purpose

The purpose of basic analytics is to extract simple, internal-only insights from the behavioral logging table to help evaluate whether Funlet's flows are working correctly during beta.

This is not a reporting dashboard or a product-facing analytics feature.

The goals are:

- Verify that behavioral logging is capturing the expected events.
- Measure early patterns in group coordination behavior.
- Support debugging and refinement of organizer and invitee flows.
- Prepare for future behavior reports and agent-facing insights.

Analytics for the beta should be simple SQL queries or Supabase views based on the logging table.

## 2. Core Metrics (Derived Directly From Logs)

Analytics should focus on a small set of high-signal metrics computed from the logging events. These metrics help confirm that flows are operating correctly and provide early behavioral patterns.

### 2.1 Flow Activity

- Number of events created per organizer
- Number of sync-ups created
- Number of crews created
- Number of reminders sent by organizers

### 2.2 Invitee Behavior

- Total invites sent
- RSVP response rates (yes / no / unknown)
- Sync-up vote distribution
- Time to first reply (average & median)
- Time to vote (sync-up)

### 2.3 Flow Completion

- Flow start → flow complete rate
- Flow drop-off counts (based on drop_off events)
- Number of reminders that produce a reply
- Number of invitees who never reply

### 2.4 System Health

- Number of SMS sent vs. SMS received
- Unrecognized replies (invitee_reply_unknown)
- Error events (type + frequency)
- Push notifications received vs. opened

These metrics should be computed using simple SELECT queries over the log table.

## 3. Implementation Approach

Analytics will be implemented in the backend only for beta.

There is no organizer-facing or admin-facing dashboard in this phase.

Implementation requirements:

- Developer creates a set of SQL queries or Supabase views that compute the metrics above.
- All analytics derive from the behavioral logging table defined in the Logging Specification.
- Analytics must not require additional data storage; everything comes directly from logs.
- Outputs can be viewed directly inside Supabase, exported manually, or inspected via simple scripts.
- No visualization layer, charts, or front-end work is required for beta.

The primary purpose is to confirm Funlet's flows behave correctly and to provide early insights for internal evaluation and partner conversations.

