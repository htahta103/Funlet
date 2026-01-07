# Auto Sync Implementation Plan

## Overview
This document outlines a step-by-step implementation plan for the Auto Sync feature based on the specification in `Auto_Sync_Specification.md`. The implementation will be built on top of the existing Funlet SMS handler infrastructure.

## Architecture Overview

### Key Differences from Current Sync-Up System
- **Auto Sync** is a new system separate from the existing `sync_up` functionality
- Auto Sync focuses on background coordination with automatic state transitions
- Supports multiple concurrent Auto Syncs per organizer
- Has explicit states: Running, Paused, Stopped, Completed
- Includes automatic reminders and pause logic

### Database Schema Requirements

#### New Tables Needed

1. **`auto_syncs`** - Main Auto Sync records
   - `id` (uuid, primary key)
   - `organizer_id` (uuid, foreign key to profiles)
   - `crew_id` (uuid, foreign key to crews)
   - `event_name` (text, required)
   - `status` (enum: 'running', 'paused', 'stopped', 'completed')
   - `response_goal` (enum: 'everyone', 'critical_mass')
   - `timezone` (text, required for no-calendar mode)
   - `calendar_connected` (boolean)
   - `created_at` (timestamp)
   - `started_at` (timestamp)
   - `paused_at` (timestamp, nullable)
   - `completed_at` (timestamp, nullable)
   - `stopped_at` (timestamp, nullable)
   - `last_reminder_sent_at` (timestamp, nullable)
   - `metadata` (jsonb) - for storing calendar mode, time windows, etc.

2. **`auto_sync_options`** - Time options for each Auto Sync
   - `id` (uuid, primary key)
   - `auto_sync_id` (uuid, foreign key to auto_syncs)
   - `idx` (integer, 1-3)
   - `start_time` (timestamp)
   - `end_time` (timestamp, nullable)
   - `timezone` (text)
   - `created_at` (timestamp)

3. **`auto_sync_responses`** - Invitee responses
   - `id` (uuid, primary key)
   - `auto_sync_id` (uuid, foreign key to auto_syncs)
   - `contact_id` (uuid, foreign key to contacts)
   - `option_ids` (uuid[], array of selected option IDs)
   - `response_type` (enum: 'available', 'not_available')
   - `responded_at` (timestamp)
   - `updated_at` (timestamp) - for "last reply wins" logic

4. **`auto_sync_messages`** - Track messages sent to invitees
   - `id` (uuid, primary key)
   - `auto_sync_id` (uuid, foreign key to auto_syncs)
   - `contact_id` (uuid, foreign key to contacts)
   - `message_type` (enum: 'initial', 'reminder')
   - `sent_at` (timestamp)
   - `is_resolved` (boolean) - for binding replies to most recent message

---

## Implementation Phases

### Phase 1: Database Schema & Infrastructure (Week 1)

#### Step 1.1: Create Database Migration
- [ ] Create migration file for `auto_syncs` table
- [ ] Create migration file for `auto_sync_options` table
- [ ] Create migration file for `auto_sync_responses` table
- [ ] Create migration file for `auto_sync_messages` table
- [ ] Add indexes for performance:
  - `auto_syncs(organizer_id, status)` - for listing active Auto Syncs
  - `auto_sync_responses(auto_sync_id, contact_id)` - for response lookups
  - `auto_sync_messages(auto_sync_id, contact_id, is_resolved)` - for message binding
- [ ] Add foreign key constraints
- [ ] Add check constraints for status transitions
- [ ] Test migration on local Supabase instance

#### Step 1.2: Create TypeScript Types
- [ ] Create `types/auto_sync.ts` with TypeScript interfaces
- [ ] Define AutoSyncStatus enum
- [ ] Define ResponseGoal enum
- [ ] Define MessageType enum
- [ ] Define ResponseType enum

#### Step 1.3: Create Helper Functions Module
- [ ] Create `auto_sync/helpers.ts` with utility functions:
  - `formatAutoSyncStatus()` - format status for display
  - `formatTimeOptionsForInvitee()` - format options with timezone
  - `formatInviteeMessage()` - build invitee SMS message
  - `formatPausedStateSummary()` - build paused state message
  - `calculateResponseStats()` - calculate responded/total/available/not_available counts
  - `checkAllOptionsPassed()` - check if all options have passed
  - `getMostRecentUnresolvedMessage()` - find message for reply binding

---

### Phase 2: Pattern Matching & Entry Points (Week 1-2)

#### Step 2.1: Add Pattern Matching Functions
- [ ] Add `checkAutoSyncPattern()` to pattern matching
  - Match: "auto sync", "auto sync [crew name]"
- [ ] Add `checkAutoSyncCheckPattern()` 
  - Match: "auto sync check"
- [ ] Add `checkAutoSyncStopPattern()`
  - Match: "stop auto sync", "stop"
- [ ] Add `checkAutoSyncReminderPattern()`
  - Match: "1" (in paused state context)
- [ ] Add `checkAutoSyncSendInvitesPattern()`
  - Match: "2" (in paused state context), "send invites"

#### Step 2.2: Add Conversation State Handling
- [ ] Add new conversation state types:
  - `AUTO_SYNC_CREW_SELECTION`
  - `AUTO_SYNC_EVENT_NAME`
  - `AUTO_SYNC_TIME_DEFINITION`
  - `AUTO_SYNC_OPTION_PROPOSAL` (calendar mode)
  - `AUTO_SYNC_SAVING_OPTIONS`
  - `AUTO_SYNC_RESPONSE_GOAL`
  - `AUTO_SYNC_CONFIRMATION`
  - `AUTO_SYNC_TIMEZONE` (no-calendar mode)
  - `AUTO_SYNC_PAUSED_MENU`
  - `AUTO_SYNC_STOP_CONFIRMATION`

---

### Phase 3: Phase 1 - Auto Sync Setup (Week 2)

#### Step 3.1: Entry & Crew Selection
- [ ] Implement `handleAutoSyncEntry()`
  - Parse "Auto Sync" or "Auto Sync [Crew Name]"
  - If crew name provided, validate and select
  - If no crew name, show crew selection menu
  - Handle "no crews exist" case
  - Handle "crew not recognized" case
  - Set conversation state to `AUTO_SYNC_CREW_SELECTION` or `AUTO_SYNC_EVENT_NAME`

#### Step 3.2: Event Name Collection
- [ ] Implement `handleAutoSyncEventName()`
  - Prompt: "Event name?"
  - Validate non-empty input
  - Handle empty input with error message
  - Store event name in conversation state
  - Check calendar connection status
  - Transition to time definition phase

#### Step 3.3: Calendar Access Detection
- [ ] Implement `checkCalendarConnection()`
  - Query user's calendar connection status
  - Store `calendar_connected` flag in conversation state
  - Route to calendar mode or no-calendar mode

---

### Phase 4: Phase 2 - Auto Sync Configuration (Week 2-3)

#### Step 4.1: Time Definition (No-Calendar Mode)
- [ ] Implement `handleNoCalendarTimeDefinition()`
  - Accept 1-3 concrete date/time options
  - Use existing `parseReSyncTimeOptions()` or create similar parser
  - Validate input format
  - Store options in conversation state
  - Handle insufficient input with clarifying question
  - Allow exit at any time (discard Auto Sync)

#### Step 4.2: Time Definition (Calendar Mode)
- [ ] Implement `handleCalendarTimeDefinition()`
  - Accept natural language time windows
  - Integrate with Google Calendar API
  - Evaluate calendar availability
  - Generate time proposals
  - Handle calendar access failures

#### Step 4.3: Option Proposal (Calendar Mode Only)
- [ ] Implement `handleOptionProposal()`
  - Show one option at a time
  - Display week-level calendar visual (text-based for SMS)
  - Accept: "yes" to save, "next" for another option, or time adjustments
  - Validate adjustments against calendar conflicts
  - Handle "no open windows" case
  - Store accepted option

#### Step 4.4: Saving Options
- [ ] Implement `handleSavingOptions()`
  - Save option to conversation state
  - Enforce 1-3 option limit
  - After each save: "Saved. [Day], [Date] at [Time]. Send Auto Sync, add another option, or exit?"
  - After 3rd option: "Saved. You've added the maximum number of options. Reply send to start Auto Sync, or exit."

#### Step 4.5: Response Goal
- [ ] Implement `handleResponseGoal()`
  - Prompt: "What's the response goal? Reply 1 for Everyone, 2 for Critical mass."
  - Accept: "1" or "2"
  - Store in conversation state (for future use, v1 behaves identically)

#### Step 4.6: Send Confirmation & Timezone
- [ ] Implement `handleAutoSyncConfirmation()`
  - Prompt: "Ready to start Auto Sync? Reply send or exit."
  - Accept: "send", "yes", "y"
  - If no calendar and no timezone: prompt for timezone
  - Handle timezone selection (numbered list)
  - If exit during timezone: cancel and discard
  - Create Auto Sync record in database
  - Transition to execution phase

---

### Phase 5: Phase 3 - Auto Sync Execution (Week 3-4)

#### Step 5.1: Auto Sync Initialization
- [ ] Implement `initializeAutoSync()`
  - Create `auto_syncs` record with status 'running'
  - Create `auto_sync_options` records (1-3)
  - Get all crew members (contacts)
  - Create `auto_sync_messages` records for each invitee
  - Send initial invitee messages
  - Send organizer confirmation: "Auto Sync sent to [TOTAL] people."
  - Schedule 24-hour reminder (using Supabase cron or edge function)
  - Schedule 48-hour pause check

#### Step 5.2: Invitee Message Formatting
- [ ] Implement `formatInviteeAvailabilityMessage()`
  - Header: "[Organizer name] is finding a time for [Event name]."
  - Body: List all options with timezone
  - Format: "Which of these work for you?\n1. [Option 1]\n2. [Option 2]\n3. [Option 3]\nReply with the number(s) that work, or none if nothing works."

#### Step 5.3: Invitee Reply Handling
- [ ] Implement `handleInviteeAutoSyncReply()`
  - Find most recent unresolved `auto_sync_messages` for contact
  - Extract valid numbers from reply (1, 2, 3, 12, 23, 123, etc.)
  - Handle "none" variations
  - Validate input format
  - If invalid: "Reply with the number(s) that work for you, or none if nothing works."
  - If valid: Create or update `auto_sync_responses` record
  - Implement "last reply wins" logic (update existing response)
  - Mark message as resolved
  - No confirmation message to invitee (silent update)

#### Step 5.4: Automatic Reminder (24 hours)
- [ ] Implement `sendAutoSyncReminder()`
  - Query Auto Syncs with status 'running' and `started_at` >= 24 hours ago
  - Find invitees with no response or unresolved messages
  - Send reminder message (same format as initial)
  - Update `last_reminder_sent_at`
  - Send organizer update: "Reminder sent for [EVENT NAME] to [PENDING] of [TOTAL] people. Reply auto sync check to manage."
  - Create Supabase Edge Function or cron job for scheduling

#### Step 5.5: Automatic Pause (48 hours)
- [ ] Implement `pauseAutoSyncAfter48Hours()`
  - Query Auto Syncs with status 'running' and `started_at` >= 48 hours ago
  - Update status to 'paused'
  - Set `paused_at` timestamp
  - Calculate and send paused state summary to organizer
  - Create Supabase Edge Function or cron job for scheduling

#### Step 5.6: Paused State Summary
- [ ] Implement `sendPausedStateSummary()`
  - Calculate response stats (responded/total/available/not_available)
  - Format message: "Auto Sync paused for [EVENT NAME]. Responses so far ([RESPONDED]/[TOTAL]):\nAvailable: [X]\nNot available: [X]\nNo response: [X]\nReply 1 to send another reminder, 2 to send invites, or exit."

#### Step 5.7: User-Initiated Reminder
- [ ] Implement `handleAutoSyncReminder()`
  - Validate Auto Sync is in 'paused' state
  - Update status to 'running'
  - Clear `paused_at`
  - Send reminder to pending invitees
  - Schedule next pause check (24 hours later)
  - Send confirmation to organizer

#### Step 5.8: Send Invites
- [ ] Implement `handleAutoSyncSendInvites()`
  - Validate Auto Sync is in 'running' or 'paused' state
  - Determine best time option (based on responses or organizer selection)
  - Create event record (reuse existing event creation logic)
  - Send calendar invites to all invitees
  - Update Auto Sync status to 'completed'
  - Set `completed_at` timestamp
  - Archive Auto Sync (exclude from active listings)
  - Send confirmation: "You're invited to [EVENT NAME] on [Date] at [Time]. Calendar invite sent."
  - Handle late replies with: "Got it — thanks."

#### Step 5.9: Stop Auto Sync
- [ ] Implement `handleAutoSyncStop()`
  - Prompt: "Stop Auto Sync for [EVENT NAME]? Reply yes to confirm, or exit."
  - On confirmation: Update status to 'stopped'
  - Set `stopped_at` timestamp
  - Archive Auto Sync
  - Send confirmation: "Auto Sync stopped for [EVENT NAME]."
  - No invitee messages sent

#### Step 5.10: Auto-Ending Rule
- [ ] Implement `checkAutoEndingRule()`
  - Query Auto Syncs with status 'running' or 'paused'
  - Check if all options' `end_time` have passed
  - If yes: Update status to 'stopped', set `stopped_at`, archive
  - No organizer message
  - Create scheduled job to check periodically

---

### Phase 6: Auto Sync Check & Management (Week 4)

#### Step 6.1: Auto Sync Check Command
- [ ] Implement `handleAutoSyncCheck()`
  - Query active Auto Syncs (status 'running' or 'paused') for organizer
  - Calculate response stats for each
  - Format list: "Here are your Auto Syncs:\n1. [EVENT NAME] — Running — [RESPONDED]/[TOTAL]\n2. [EVENT NAME] — Paused — [RESPONDED]/[TOTAL]\nReply with a number to manage, or exit."
  - Handle "no active Auto Syncs" case
  - Set conversation state for selection

#### Step 6.2: Auto Sync Selection & Management Menu
- [ ] Implement `handleAutoSyncSelection()`
  - Parse number selection
  - Show management menu based on status:
    - Running: "Reply 1 to send invites, 2 to stop, or exit."
    - Paused: "Reply 1 to send another reminder, 2 to send invites, 3 to stop, or exit."
  - Route to appropriate handler

#### Step 6.3: Edge Case Handling
- [ ] Implement handling for:
  - Replies after Stop or Completion: "Got it — thanks."
  - Replies to archived Auto Syncs
  - Multiple concurrent Auto Syncs reply binding
  - Timezone handling for all messages

---

### Phase 7: Background Jobs & Scheduling (Week 4-5)

#### Step 7.1: Create Scheduled Edge Functions
- [ ] Create `auto-sync-reminder` edge function
  - Runs every hour
  - Checks for Auto Syncs needing 24-hour reminders
  - Sends reminders and updates records

- [ ] Create `auto-sync-pause` edge function
  - Runs every hour
  - Checks for Auto Syncs needing 48-hour pause
  - Pauses and sends summary

- [ ] Create `auto-sync-auto-end` edge function
  - Runs every hour
  - Checks for Auto Syncs with all options passed
  - Archives silently

#### Step 7.2: Configure Supabase Cron Jobs
- [ ] Set up pg_cron extensions
- [ ] Schedule reminder job
- [ ] Schedule pause job
- [ ] Schedule auto-end job
- [ ] Test scheduling logic

---

### Phase 8: Calendar Integration (Week 5)

#### Step 8.1: Calendar Availability Checking
- [ ] Integrate Google Calendar API
- [ ] Implement `checkCalendarAvailability()`
  - Parse natural language time windows
  - Query calendar for conflicts
  - Generate available time proposals

#### Step 8.2: Calendar Option Proposal
- [ ] Implement calendar visual formatting (text-based for SMS)
- [ ] Handle week navigation
- [ ] Handle time adjustments
- [ ] Validate against conflicts

#### Step 8.3: Calendar Timezone Handling
- [ ] Extract timezone from calendar
- [ ] Use for all time displays
- [ ] Store in Auto Sync record

---

### Phase 9: Testing & Refinement (Week 5-6)

#### Step 9.1: Unit Tests
- [ ] Test pattern matching functions
- [ ] Test message formatting functions
- [ ] Test state transition logic
- [ ] Test response parsing
- [ ] Test timezone handling

#### Step 9.2: Integration Tests
- [ ] Test full Auto Sync flow (no-calendar mode)
- [ ] Test full Auto Sync flow (calendar mode)
- [ ] Test multiple concurrent Auto Syncs
- [ ] Test reminder and pause logic
- [ ] Test invite sending
- [ ] Test stop functionality
- [ ] Test Auto Sync Check

#### Step 9.3: Edge Case Testing
- [ ] Test replies after completion
- [ ] Test replies after stop
- [ ] Test auto-ending rule
- [ ] Test timezone edge cases
- [ ] Test calendar access failures
- [ ] Test invalid inputs

#### Step 9.4: Performance Testing
- [ ] Test with large crews (50+ members)
- [ ] Test concurrent Auto Syncs (10+)
- [ ] Test scheduled job performance
- [ ] Optimize database queries

---

### Phase 10: Logging & Analytics (Week 6)

#### Step 10.1: Behavioral Logging
- [ ] Add logging for Auto Sync creation
- [ ] Add logging for state transitions
- [ ] Add logging for reminders sent
- [ ] Add logging for invites sent
- [ ] Add logging for stops
- [ ] Add logging for responses received

#### Step 10.2: Analytics Integration
- [ ] Update analytics views to include Auto Sync metrics
- [ ] Track Auto Sync completion rates
- [ ] Track response rates
- [ ] Track time to completion

---

### Phase 11: Documentation & Deployment (Week 6-7)

#### Step 11.1: Code Documentation
- [ ] Document all Auto Sync functions
- [ ] Document database schema
- [ ] Document state machine
- [ ] Document message formats

#### Step 11.2: Deployment
- [ ] Deploy database migrations
- [ ] Deploy edge functions
- [ ] Configure cron jobs
- [ ] Test in staging environment
- [ ] Deploy to production
- [ ] Monitor for issues

---

## Technical Considerations

### State Management
- Use `conversation_state` table for multi-step workflows
- Store Auto Sync ID in conversation state during setup
- Clear conversation state on exit or completion

### Message Binding
- Use `auto_sync_messages.is_resolved` flag
- Always bind replies to most recent unresolved message
- Update flag when response is received

### Timezone Handling
- Store timezone in `auto_syncs` table
- Always include timezone in invitee messages
- Never include timezone in organizer messages
- Use organizer's timezone for organizer-facing times

### Concurrent Auto Syncs
- Support multiple Auto Syncs per organizer
- Each Auto Sync is independent
- Replies bind to most recent unresolved message across all Auto Syncs

### Performance
- Index all foreign keys
- Use efficient queries for active Auto Sync listing
- Batch message sending where possible
- Cache calendar availability checks

### Error Handling
- Handle calendar API failures gracefully
- Handle database connection issues
- Handle SMS sending failures
- Log all errors for debugging

---

## Dependencies

### External Services
- Twilio (SMS sending) - already integrated
- Google Calendar API - needs integration
- Supabase (database, edge functions, cron) - already integrated

### Existing Code Reuse
- SMS sending logic (`sms.ts`)
- Logging functions (`logger.ts`)
- Pattern matching infrastructure
- Conversation state management
- Event creation logic
- Contact/crew management

---

## Success Criteria

1. ✅ Organizer can create Auto Sync via SMS
2. ✅ Invitees receive availability messages
3. ✅ Invitees can respond with numbers or "none"
4. ✅ Responses are tracked and "last reply wins"
5. ✅ Automatic reminders sent at 24 hours
6. ✅ Automatic pause at 48 hours
7. ✅ Organizer can check status via "auto sync check"
8. ✅ Organizer can send reminders manually
9. ✅ Organizer can send invites at any time
10. ✅ Organizer can stop Auto Sync
11. ✅ Auto Sync auto-ends when all options pass
12. ✅ Multiple concurrent Auto Syncs work independently
13. ✅ Calendar mode works with Google Calendar
14. ✅ No-calendar mode works with manual time entry
15. ✅ All edge cases handled gracefully

---

## Timeline Summary

- **Week 1**: Database schema, types, helper functions
- **Week 2**: Pattern matching, Phase 1 (Setup)
- **Week 3**: Phase 2 (Configuration)
- **Week 4**: Phase 3 (Execution), Auto Sync Check
- **Week 5**: Background jobs, Calendar integration
- **Week 6**: Testing, Logging, Analytics
- **Week 7**: Documentation, Deployment

**Total Estimated Time: 7 weeks**

---

*This plan should be reviewed and adjusted based on team capacity and priorities.*

