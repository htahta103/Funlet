# Auto Sync Workflow Documentation

## Overview

Auto Sync is a feature that allows organizers to schedule events with their crew members by collecting availability responses via SMS. The system automatically sends reminders, pauses after 48 hours, and allows organizers to send calendar invites once they're ready.

## Architecture

**Key Components:**
- `auto_sync.ts` - Core Auto Sync logic and handlers
- `process-auto-sync-jobs/index.ts` - Scheduled job processor (reminders, pause checks, auto-end)
- `index.ts` - Pattern matching and routing
- Database tables: `auto_syncs`, `auto_sync_options`, `auto_sync_responses`, `auto_sync_messages`, `job_queue`

---

## 1. Organizer Setup Flow

### 1.1 Start Auto Sync

**Command:** `auto sync [crew name]` or `auto sync`

**Handler:** `handleAutoSyncEntry()` (line 678-776)

**Flow:**
1. If crew name provided, search for matching crew
2. If found → proceed to event name
3. If not found → show error: "I couldn't find that crew. Try again, text create crew to make a new one, or exit."
4. If no crew name → show crew list menu
5. If no crews exist → "You don't have any crews yet. Text create crew to get started."

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_event_name',
  current_state: 'auto_sync_setup',
  extracted_data: [{
    action: 'AUTO_SYNC',
    crew_id: <crew_id>,
    crew_name: <crew_name>
  }]
}
```

---

### 1.2 Event Name

**Prompt:** "Event name?"

**Handler:** `handleAutoSyncEventName()` (line 718-767)

**Flow:**
1. Validate event name is not empty/whitespace
2. Check calendar connection status (`hasValidCalendarConnection`)
3. Proceed to location prompt

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_event_location',
  current_state: 'auto_sync_setup',
  extracted_data: [{
    ...previous_data,
    event_name: <event_name>,
    calendar_connected: <boolean>
  }]
}
```

---

### 1.3 Event Location (Optional)

**Prompt:** "Event location? (or reply 'skip' to leave blank)"

**Handler:** `handleAutoSyncEventLocation()` (line 772-829)

**Flow:**
1. Accept location or "skip"
2. If calendar connected → prompt for calendar time window
3. If no calendar → prompt for concrete time options

**Conversation State:**
```javascript
{
  waiting_for: calendar_connected ? 'auto_sync_time_definition_calendar' : 'auto_sync_time_definition',
  current_state: 'auto_sync_configuration',
  extracted_data: [{
    ...previous_data,
    event_location: <location_or_null>
  }]
}
```

---

### 1.4 Time Options Collection

#### Calendar Mode (if calendar connected)

**Prompt:** "What time window works for you? (e.g., 'next week evenings' or 'weekend mornings')"

**Handler:** `handleCalendarTimeDefinition()` (line 1450-1656)

**Flow:**
1. Parse natural language time window
2. Generate calendar proposals (up to 3 options)
3. Show week view with highlighted time slot
4. User can:
   - Reply "yes" → save option
   - Reply "next" → show next proposal
   - Suggest time change → update proposal
5. After saving 1-3 options → proceed to goal selection

**Proposal Format:** Week calendar view + highlighted slot + instructions

#### No-Calendar Mode

**Prompt:** "What times work? Send 1-3 options (e.g., 'Thu 12/19, 6-8pm, Sat 12/21, 10am-12pm')"

**Handler:** `handleNoCalendarTimeDefinition()` (line 1449-1656)

**Flow:**
1. Parse concrete time options (1-3)
2. Validate format and dates
3. If 3 options provided → proceed to goal
4. If 1-2 options → prompt to add more or proceed
5. Max 3 options enforced

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_response_goal',
  current_state: 'auto_sync_configuration',
  extracted_data: [{
    ...previous_data,
    time_options: [{
      idx: 1,
      start_time: <ISO_string>,
      end_time: <ISO_string_or_null>,
      text: <formatted_string>
    }, ...],
    // OR for calendar mode:
    saved_options: [{
      start: <ISO_string>,
      end: <ISO_string>,
      description: <string>
    }, ...]
  }]
}
```

---

### 1.5 Response Goal Selection

**Prompt:** "What's the response goal? Reply 1 for Everyone, 2 for Critical mass."

**Handler:** `handleResponseGoal()` (line 1871-1914)

**Flow:**
1. Accept "1" → sets `response_goal: 'everyone'`
2. Accept "2" → sets `response_goal: 'critical_mass'`
3. Invalid input → re-prompts with same options
4. Proceeds to confirmation

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_confirmation',
  current_state: 'auto_sync_configuration',
  extracted_data: [{
    ...previous_data,
    response_goal: 'everyone' | 'critical_mass'
  }]
}
```

---

### 1.6 Send Confirmation

**Prompt:** "Ready to start Auto Sync? Reply send or exit."

**Handler:** `handleAutoSyncConfirmation()` (line 1982-2090)

**Flow:**
1. Accept "send", "yes", or "y" → proceed
2. Accept "exit" or "cancel" → clear state and cancel
3. Invalid input → re-prompts

**If no calendar and no stored timezone:**
- Prompts for timezone (numbered list 1-6)
- Normalizes input to IANA format
- Stores in profile for future use

**If calendar connected or timezone exists:**
- Proceeds directly to initialization

**Conversation State (if timezone needed):**
```javascript
{
  waiting_for: 'auto_sync_timezone',
  current_state: 'auto_sync_configuration',
  extracted_data: [{
    ...previous_data
  }]
}
```

---

### 1.7 Timezone Selection (if needed)

**Prompt:** 
```
What timezone?
1. PT (Pacific)
2. MT (Mountain)
3. CT (Central)
4. ET (Eastern)
5. AKT (Alaska)
6. HT (Hawaii)

Reply with the number (1-6).
```

**Handler:** `AUTO_SYNC_TIMEZONE` in `index.ts` (line 21741-21815)

**Flow:**
1. Accept number (1-6) or abbreviation (PT/MT/CT/ET/AKT/HT)
2. Normalize to IANA format via `normalizeTimezone()`:
   - 1 → America/Los_Angeles
   - 2 → America/Denver
   - 3 → America/Chicago
   - 4 → America/New_York
   - 5 → America/Anchorage
   - 6 → Pacific/Honolulu
3. Save to profile `preferred_timezone`
4. Immediately initialize Auto Sync

**Normalization Function:** `normalizeTimezone()` (line 233-271)

---

### 1.8 Initialize Auto Sync

**Handler:** `initializeAutoSync()` (line 2099-2310)

**Flow:**
1. Validate all required data (crew_id, event_name, response_goal, time_options, timezone)
2. Get crew members (contacts)
3. Create `auto_syncs` record:
   - Status: 'running'
   - Stores all configuration data
4. Create `auto_sync_options` records (1-3 options)
5. Create `auto_sync_messages` records for each contact
6. Send initial availability messages to all invitees
7. Schedule jobs:
   - `reminder_24h` - 24 hours from start
   - `pause_check_48h` - 48 hours from start
   - `auto_end_check` - After earliest option end time
8. Send confirmation to organizer: "Auto Sync sent to [N] people."

**Initial Message Format:**
```
[Organizer Name] is organizing [Event Name]

Which of these work for you?
1. [Day], [Date] at [Time] [TZ]
2. [Day], [Date] at [Time] [TZ]
3. [Day], [Date] at [Time] [TZ]

Reply with the number(s) that work, or none if nothing works.
```

---

## 2. Invitee Response Flow

### 2.1 Receiving Auto Sync Message

**Handler:** `handleInviteeAutoSyncReply()` (line 2315-2414)

**Flow:**
1. Find most recent unresolved `auto_sync_messages` for contact
2. Verify Auto Sync is still active (running or paused)
3. Parse response via `parseAutoSyncResponse()`

**Parse Function:** `parseAutoSyncResponse()` (line 471-492)
- Detects "none" variations → `{ isValid: true, isNone: true }`
- Extracts numbers 1-3 → `{ isValid: true, optionIdxs: [1, 2] }`
- Invalid input → `{ isValid: false }`

---

### 2.2 Response Validation

**Validation Steps:**
1. Get actual available options from database
2. Validate all selected indices exist in available options
3. If invalid → return corrective instruction:
   - 1 option: "Please reply with 1, or none if nothing works."
   - 2 options: "Please reply with 1 or 2, or none if nothing works."
   - 3 options: "Please reply with 1, 2, or 3, or none if nothing works."

**Handler:** `handleInviteeAutoSyncReply()` (line 2380-2402)

---

### 2.3 Save Response

**Flow:**
1. Map option indices to option IDs
2. Determine response type:
   - `isNone: true` → `response_type: 'not_available'`
   - Numbers selected → `response_type: 'available'`, `option_ids: [<ids>]`
3. Upsert `auto_sync_responses` record
4. Mark `auto_sync_messages` as resolved (`is_resolved: true`)
5. Silent update (no confirmation message sent)

**Database Update:** `updateAutoSyncResponse()` (line 535-562)

---

## 3. Scheduled Jobs Flow

### 3.1 24-Hour Reminder

**Job Type:** `reminder_24h`

**Handler:** `sendReminder()` in `process-auto-sync-jobs/index.ts` (line 415-604)

**Flow:**
1. Get Auto Sync and options
2. Get all crew members
3. Get all responses
4. Filter to non-responders only
5. Send reminder message to each non-responder
6. Send organizer update:
   - Message: "Reminder sent for [EVENT NAME] to [PENDING] of [TOTAL] people. Reply auto sync check to manage."
   - If organizer is host → saves to `message_thread` (not SMS)
7. Update `last_reminder_sent_at`
8. Schedule next pause check (24h after reminder)

**Reminder Message Format:**
```
Reminder: [Organizer Name] is organizing [Event Name]

Which of these work for you?
[Same options list as initial message]

Reply with the number(s) that work, or none if nothing works.
```

---

### 3.2 48-Hour Pause Check

**Job Type:** `pause_check_48h`

**Handler:** `process-auto-sync-jobs/index.ts` (line 250-270)

**Flow:**
1. Check if Auto Sync is still running
2. Calculate response stats
3. Update status to 'paused'
4. Send paused summary to organizer:
   - Stats: "[EVENT NAME] paused. Responses so far ([RESPONDED]/[TOTAL]):"
   - Shows available/not available breakdown
   - Shows paused menu options
5. If organizer is host → saves to `message_thread` (not SMS)

**Paused Menu:**
```
1. Send reminder
2. Send invites
3. Stop
Reply with a number or exit.
```

---

### 3.3 Auto-End Check

**Job Type:** `auto_end_check`

**Handler:** `process-auto-sync-jobs/index.ts` (line 317-410)

**Flow:**
1. Check if all option end times have passed (`checkAllOptionsPassed()`)
2. If all passed → update status to 'stopped'
3. If not all passed → reschedule check for earliest future end time

**Check Function:** `checkAllOptionsPassed()` (line 444-465)

---

## 4. Organizer Management Flow

### 4.1 Auto Sync Check

**Command:** `auto sync check`

**Handler:** `handleAutoSyncCheck()` (line 2327-2371)

**Flow:**
1. Get all active Auto Syncs (running or paused)
2. Calculate stats for each
3. Display numbered list:
   ```
   Here are your Auto Syncs:
   1. [Event Name] — Running — [RESPONDED]/[TOTAL]
   2. [Event Name] — Paused — [RESPONDED]/[TOTAL]
   ...
   Reply with a number to manage, or exit.
   ```
4. Wait for selection

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_selection',
  current_state: 'auto_sync_check',
  extracted_data: [{
    action: 'AUTO_SYNC_CHECK'
  }]
}
```

---

### 4.2 Select Auto Sync

**Handler:** `handleAutoSyncSelection()` (line 2500-2552)

**Flow:**
1. Parse selection number
2. Get selected Auto Sync with stats
3. Show status and menu based on state:

**If Running:**
```
Auto Sync for [Event Name] ([RESPONDED]/[TOTAL] responded).
Reply 1 to send invites, 2 to stop, or exit.
```

**If Paused:**
```
[Event Name] paused. Responses so far ([RESPONDED]/[TOTAL]):
[Stats breakdown]

1. Send reminder
2. Send invites
3. Stop
Reply with a number or exit.
```

**Conversation State:**
```javascript
{
  waiting_for: status === 'running' ? 'auto_sync_running_menu' : 'auto_sync_paused_menu',
  current_state: 'auto_sync_manage',
  extracted_data: [{
    auto_sync_id: <id>,
    action: 'AUTO_SYNC_SELECTION'
  }]
}
```

---

### 4.3 Send Reminder (from Paused)

**Handler:** `handleAutoSyncReminder()` (line 2557-2661)

**Flow:**
1. Verify Auto Sync is paused
2. Update status to 'running'
3. Get non-responders (no response or unresolved messages)
4. Send reminder messages to non-responders
5. Schedule next pause check (24h after reminder)
6. Return confirmation

---

### 4.4 Send Invites

**Handler:** `handleAutoSyncSendInvites()` (line 2699-2766)

**Flow:**
1. Verify Auto Sync is active (running or paused)
2. Get all options
3. Display option selection menu:
   ```
   Send invites for which time?
   1. [Day] [Date], [Time]
   2. [Day] [Date], [Time]
   3. [Day] [Date], [Time]
   
   Reply with the option number or 'exit'.
   ```
4. Wait for option selection

**Conversation State:**
```javascript
{
  waiting_for: 'auto_sync_select_option_for_invites',
  current_state: 'auto_sync_send_invites',
  extracted_data: [{
    auto_sync_id: <id>,
    action: 'AUTO_SYNC_SEND_INVITES'
  }]
}
```

---

### 4.5 Send Invites with Selected Option

**Handler:** `handleAutoSyncSendInvitesWithOption()` (line 2771-3048)

**Flow:**
1. Verify Auto Sync and selected option
2. Create event in `events` table
3. If calendar connected:
   - Create Google Calendar event
   - Add crew members as attendees (if emails available)
4. Send confirmation SMS to all crew members:
   ```
   You're invited to [Event Name] on [Day], [Month] [Date] at [Time]. Calendar invite sent.
   ```
5. Update Auto Sync status to 'stopped'
6. Mark all messages as resolved
7. Cancel all pending jobs
8. Return confirmation to organizer: "You're invited to [Event Name] on [Day], [Month] [Date] at [Time]. Invitations sent."

---

### 4.6 Stop Auto Sync

**Handler:** `handleAutoSyncStop()` (line 3021-3082)

**Flow:**
1. If not confirmed → ask confirmation: "Stop this Auto Sync? Reply yes or exit."
2. If confirmed:
   - Update status to 'stopped'
   - Mark all messages as resolved
   - Cancel all pending jobs
   - Return confirmation: "Auto Sync stopped."

**Conversation State (if not confirmed):**
```javascript
{
  waiting_for: 'auto_sync_stop_confirmation',
  current_state: 'auto_sync_stop',
  extracted_data: [{
    auto_sync_id: <id>,
    action: 'AUTO_SYNC_STOP'
  }]
}
```

---

## 5. Data Models

### 5.1 auto_syncs Table

```typescript
{
  id: string
  organizer_id: string
  crew_id: string
  event_name: string
  event_location: string | null
  response_goal: 'everyone' | 'critical_mass'
  timezone: string (IANA format)
  status: 'running' | 'paused' | 'stopped' | 'completed'
  calendar_connected: boolean
  started_at: timestamp
  paused_at: timestamp | null
  stopped_at: timestamp | null
  completed_at: timestamp | null
  metadata: jsonb
}
```

### 5.2 auto_sync_options Table

```typescript
{
  id: string
  auto_sync_id: string
  idx: number (1, 2, or 3)
  start_time: timestamp
  end_time: timestamp | null
  timezone: string (IANA format)
}
```

### 5.3 auto_sync_responses Table

```typescript
{
  id: string
  auto_sync_id: string
  contact_id: string
  response_type: 'available' | 'not_available'
  option_ids: string[] (array of option IDs)
  created_at: timestamp
  updated_at: timestamp
}
```

### 5.4 auto_sync_messages Table

```typescript
{
  id: string
  auto_sync_id: string
  contact_id: string
  message_type: 'initial' | 'reminder'
  sent_at: timestamp
  is_resolved: boolean
}
```

### 5.5 job_queue Table

```typescript
{
  id: string
  sync_id: string (auto_sync_id)
  job_type: 'reminder_24h' | 'pause_check_48h' | 'auto_end_check'
  status: 'pending' | 'processed' | 'skipped'
  scheduled_at: timestamp
  processed_at: timestamp | null
  error_message: string | null
}
```

---

## 6. Key Functions Reference

### Setup Functions
- `handleAutoSyncEntry()` - Crew selection
- `handleAutoSyncEventName()` - Event name collection
- `handleAutoSyncEventLocation()` - Location collection
- `handleCalendarTimeDefinition()` - Calendar mode time window
- `handleNoCalendarTimeDefinition()` - No-calendar mode concrete times
- `handleResponseGoal()` - Goal selection
- `handleAutoSyncConfirmation()` - Send confirmation and timezone handling
- `initializeAutoSync()` - Create records and send initial messages

### Invitee Functions
- `handleInviteeAutoSyncReply()` - Process invitee responses
- `parseAutoSyncResponse()` - Parse numbers or "none"
- `updateAutoSyncResponse()` - Save response to database
- `getMostRecentUnresolvedMessage()` - Find active message for contact

### Management Functions
- `handleAutoSyncCheck()` - List active Auto Syncs
- `handleAutoSyncSelection()` - Select Auto Sync to manage
- `handleAutoSyncReminder()` - Send reminder from paused state
- `handleAutoSyncSendInvites()` - Show option selection menu
- `handleAutoSyncSendInvitesWithOption()` - Complete send invites flow
- `handleAutoSyncStop()` - Stop Auto Sync

### Utility Functions
- `normalizeTimezone()` - Convert numbers/abbreviations to IANA format
- `getTimezoneAbbreviation()` - Convert IANA format to abbreviation
- `formatInviteeAvailabilityMessage()` - Format invitee messages
- `calculateResponseStats()` - Calculate response statistics
- `checkAllOptionsPassed()` - Check if all options have passed
- `formatTimeOptionsForInvitee()` - Format time options with timezone

### Scheduled Job Functions (process-auto-sync-jobs)
- `sendReminder()` - Send 24h reminders to non-responders
- `schedulePauseCheck()` - Schedule 48h pause check
- Auto-end check logic - Check and auto-end expired Auto Syncs

---

## 7. Conversation State Flow

### Setup States
- `auto_sync_setup` → `auto_sync_configuration` → `auto_sync_execution`

### Waiting For Values
- `auto_sync_crew_selection`
- `auto_sync_event_name`
- `auto_sync_event_location`
- `auto_sync_time_definition` / `auto_sync_time_definition_calendar`
- `auto_sync_response_goal`
- `auto_sync_confirmation`
- `auto_sync_timezone`

### Management States
- `auto_sync_check`
- `auto_sync_selection`
- `auto_sync_manage`
- `auto_sync_running_menu`
- `auto_sync_paused_menu`
- `auto_sync_send_invites`
- `auto_sync_select_option_for_invites`
- `auto_sync_stop_confirmation`

---

## 8. Error Handling

### Validation Errors
- Missing crew members → "No crew members found. Please add members to your crew first."
- Invalid timezone → Re-prompts with numbered list
- Invalid option number → Shows valid range
- Invalid input → Re-prompts with same options

### State Errors
- Auto Sync not found → "Auto Sync not found or not active."
- Invalid status → Appropriate error message
- Missing data → "Missing required information. Please start over."

### Exit Handling
- "exit" or "cancel" at any point → Clears conversation state
- No draft saved, no partial records created

---

## 9. Testing Scenarios

### Basic Flow
1. Create crew with members
2. Start auto sync with crew name
3. Provide event name, skip location
4. Provide 1-3 time options
5. Select response goal (1 or 2)
6. Confirm send
7. Select timezone (if needed)
8. Verify initial messages sent

### Invitee Response
1. Invitee receives message
2. Reply with valid number(s)
3. Reply with "none"
4. Reply with invalid number → verify error message
5. Reply overwrite previous response

### Reminder Flow
1. Wait 24 hours (or trigger manually)
2. Verify reminders sent to non-responders only
3. Verify organizer update message
4. Verify next pause check scheduled

### Pause Flow
1. Wait 48 hours (or trigger manually)
2. Verify Auto Sync paused
3. Verify organizer receives paused summary
4. Verify paused menu shown

### Send Invites Flow
1. From running or paused state
2. Select "send invites"
3. See option selection menu
4. Select option number
5. Verify calendar event created (if calendar connected)
6. Verify confirmation messages sent
7. Verify Auto Sync stopped

### Auto Sync Check Flow
1. Run "auto sync check"
2. See list of active Auto Syncs
3. Select number to manage
4. See appropriate menu (running vs paused)
5. Perform actions (reminder, send invites, stop)

---

## 10. Key Design Decisions

1. **Timezone Normalization**: Accepts numbers 1-6 or abbreviations, normalizes to IANA format internally for consistency
2. **Option Selection for Send Invites**: Added enhancement to allow organizer to choose specific option before sending
3. **Silent Invitee Updates**: Invitee responses are saved silently (no confirmation SMS) to reduce noise
4. **Host Message Handling**: Organizer messages saved to `message_thread` instead of SMS when organizer is host
5. **Auto-End Check**: Automatically ends Auto Sync when all option end times pass
6. **Response Validation**: Validates against actual option count, not just 1-3 range
7. **Most Recent Message Binding**: Invitee responses bind to most recent unresolved message for correct scoping

---

## 11. Future Enhancements

- Calendar token refresh handling
- Auto-complete when all invitees respond (currently requires manual send invites)
- Enhanced timezone support beyond US timezones
- SMS command for calendar connection
- Batch operations for multiple Auto Syncs

