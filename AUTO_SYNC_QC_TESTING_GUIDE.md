# Auto Sync QC Testing Guide

## Overview

This document provides test scenarios and expected behaviors for QC testing of the Auto Sync feature. Each scenario includes step-by-step instructions, expected prompts, and validation points.

---

## Test Prerequisites

**Setup Required:**
1. Test phone number with organizer account
2. Test phone number(s) for invitee(s) - must be contacts in a crew
3. At least one crew with members
4. Calendar connection (optional, for calendar mode tests)

**Test Phone Numbers:**
- Organizer: `+18777804236`
- Invitee(s): Use contacts added to test crew

---

## Test Scenario 1: Basic Auto Sync Creation (No Calendar, No Stored Timezone)

### Objective
Test complete Auto Sync creation flow without calendar connection and without stored timezone.

### Steps

1. **Start Auto Sync**
   - Send: `auto sync Friends`
   - **Expected:** "Event name?"

2. **Provide Event Name**
   - Send: `Test Event Basic`
   - **Expected:** "Event location? (or reply 'skip' to leave blank)"

3. **Skip Location**
   - Send: `skip`
   - **Expected:** "What times work? Send 1-3 options (e.g., 'Thu 12/19, 6-8pm, Sat 12/21, 10am-12pm')"

4. **Provide Time Option**
   - Send: `1/25 7pm`
   - **Expected:** "What's the response goal? Reply 1 for Everyone, 2 for Critical mass."

5. **Select Goal**
   - Send: `1`
   - **Expected:** "Ready to start Auto Sync? Reply send or exit."

6. **Confirm Send**
   - Send: `send`
   - **Expected:** "What timezone?\n1. PT (Pacific)\n2. MT (Mountain)\n3. CT (Central)\n4. ET (Eastern)\n5. AKT (Alaska)\n6. HT (Hawaii)\n\nReply with the number (1-6)."

7. **Select Timezone**
   - Send: `1`
   - **Expected:** "Auto Sync sent to [N] people."

### Validation Points
- ✅ Timezone prompt shows numbered list (1-6)
- ✅ Timezone selection accepts number
- ✅ Auto Sync created successfully
- ✅ Confirmation message shows correct invitee count

---

## Test Scenario 2: Auto Sync with Critical Mass Goal

### Objective
Test Auto Sync creation with Critical Mass response goal.

### Steps

1. **Start Auto Sync**
   - Send: `auto sync Friends`
   - **Expected:** "Event name?"

2. **Provide Event Name**
   - Send: `Critical Mass Test`
   - **Expected:** "Event location? (or reply 'skip' to leave blank)"

3. **Skip Location**
   - Send: `skip`
   - **Expected:** "What times work? Send 1-3 options..."

4. **Provide Time Option**
   - Send: `1/26 8pm`
   - **Expected:** "What's the response goal? Reply 1 for Everyone, 2 for Critical mass."

5. **Select Critical Mass**
   - Send: `2`
   - **Expected:** "Ready to start Auto Sync? Reply send or exit."

6. **Confirm Send**
   - Send: `send`
   - **Expected:** Timezone prompt (if no stored timezone) OR "Auto Sync sent to [N] people."

7. **Complete Timezone (if prompted)**
   - Send: `4` (ET)
   - **Expected:** "Auto Sync sent to [N] people."

### Validation Points
- ✅ Goal selection 2 accepted
- ✅ Critical Mass goal saved correctly
- ✅ Auto Sync created with correct goal

---

## Test Scenario 3: Timezone Selection - All Options

### Objective
Test all timezone selection options (1-6) and abbreviations.

### Test Cases

#### 3.1 Number Selection
- Send: `1` → Should normalize to America/Los_Angeles
- Send: `2` → Should normalize to America/Denver
- Send: `3` → Should normalize to America/Chicago
- Send: `4` → Should normalize to America/New_York
- Send: `5` → Should normalize to America/Anchorage
- Send: `6` → Should normalize to Pacific/Honolulu

#### 3.2 Abbreviation Selection
- Send: `PT` → Should normalize to America/Los_Angeles
- Send: `MT` → Should normalize to America/Denver
- Send: `CT` → Should normalize to America/Chicago
- Send: `ET` → Should normalize to America/New_York
- Send: `AKT` → Should normalize to America/Anchorage
- Send: `HT` → Should normalize to Pacific/Honolulu

#### 3.3 Case Insensitive
- Send: `pt` → Should work
- Send: `Pt` → Should work
- Send: `PT` → Should work

### Validation Points
- ✅ All numbers (1-6) accepted
- ✅ All abbreviations accepted
- ✅ Case insensitive
- ✅ Timezone saved to profile for future use

---

## Test Scenario 4: Invitee Response - Valid Numbers

### Objective
Test invitee responses with valid option numbers.

### Prerequisites
- Auto Sync created with 1-3 options
- Invitee received initial message

### Steps

1. **Single Option Response**
   - From invitee phone: Send `1`
   - **Expected:** Silent (no response message)
   - **Validation:** Response saved in database

2. **Multiple Options Response**
   - From invitee phone: Send `1 2` or `1,2`
   - **Expected:** Silent (no response message)
   - **Validation:** Both options saved

3. **Response with Text**
   - From invitee phone: Send `1 works for me`
   - **Expected:** Silent (no response message)
   - **Validation:** Number extracted, text ignored

4. **None Response**
   - From invitee phone: Send `none`
   - **Expected:** Silent (no response message)
   - **Validation:** Saved as not_available

### Validation Points
- ✅ Valid numbers accepted
- ✅ Multiple numbers accepted
- ✅ Text ignored, numbers extracted
- ✅ "none" detected correctly
- ✅ No confirmation message sent (silent update)

---

## Test Scenario 5: Invitee Response - Invalid Numbers

### Objective
Test invitee response validation against actual option count.

### Prerequisites
- Auto Sync created with 1 option
- Invitee received initial message

### Steps

1. **Invalid Number (Option 2 when only 1 exists)**
   - From invitee phone: Send `2`
   - **Expected:** "Please reply with 1, or none if nothing works."

2. **Invalid Number (Option 3 when only 2 exist)**
   - Create Auto Sync with 2 options
   - From invitee phone: Send `3`
   - **Expected:** "Please reply with 1 or 2, or none if nothing works."

3. **Number Outside Range (9)**
   - From invitee phone: Send `9`
   - **Expected:** "Reply with the number(s) that work for you, or none if nothing works."

4. **Mixed Valid and Invalid**
   - Create Auto Sync with 2 options
   - From invitee phone: Send `1 3`
   - **Expected:** "Please reply with 1 or 2, or none if nothing works."

### Validation Points
- ✅ Invalid numbers rejected with corrective message
- ✅ Error message shows correct valid range
- ✅ Message format matches available options count

---

## Test Scenario 6: Auto Sync Check and Management

### Objective
Test organizer's ability to check and manage Auto Syncs.

### Steps

1. **Check Auto Syncs**
   - Send: `auto sync check`
   - **Expected:** 
     ```
     Here are your Auto Syncs:
     1. [Event Name] — Running — [X]/[Y]
     2. [Event Name] — Paused — [X]/[Y]
     ...
     Reply with a number to manage, or exit.
     ```

2. **Select Auto Sync (Running)**
   - Send: `1` (select running Auto Sync)
   - **Expected:** 
     ```
     Auto Sync for [Event Name] ([X]/[Y] responded).
     Reply 1 to send invites, 2 to stop, or exit.
     ```

3. **Select Auto Sync (Paused)**
   - Send: `2` (select paused Auto Sync)
   - **Expected:** 
     ```
     [Event Name] paused. Responses so far ([X]/[Y]):
     [Stats breakdown]
     
     1. Send reminder
     2. Send invites
     3. Stop
     Reply with a number or exit.
     ```

### Validation Points
- ✅ Only active (running/paused) Auto Syncs shown
- ✅ Correct status displayed
- ✅ Correct response counts shown
- ✅ Appropriate menu shown based on status

---

## Test Scenario 7: Send Invites Flow

### Objective
Test sending invites with option selection.

### Prerequisites
- Active Auto Sync (running or paused)
- At least one time option

### Steps

1. **Start Send Invites**
   - From auto sync check → select Auto Sync → send `1` (send invites)
   - **Expected:** 
     ```
     Send invites for which time?
     1. [Day] [Date], [Time]
     2. [Day] [Date], [Time]
     ...
     Reply with the option number or 'exit'.
     ```

2. **Select Option**
   - Send: `1`
   - **Expected:** "You're invited to [Event Name] on [Day], [Month] [Date] at [Time]. Invitations sent."

3. **Verify Completion**
   - Send: `auto sync check`
   - **Expected:** Auto Sync no longer appears in list (status changed to stopped)

### Validation Points
- ✅ Option selection menu shown
- ✅ Options formatted correctly
- ✅ Calendar event created (if calendar connected)
- ✅ Confirmation messages sent to all crew members
- ✅ Auto Sync status changed to stopped
- ✅ All pending jobs cancelled

---

## Test Scenario 8: Send Reminder from Paused State

### Objective
Test sending reminder from paused Auto Sync.

### Prerequisites
- Paused Auto Sync
- Some non-responders

### Steps

1. **Access Paused Menu**
   - Send: `auto sync check`
   - Select paused Auto Sync
   - **Expected:** Paused menu with "1. Send reminder"

2. **Send Reminder**
   - Send: `1`
   - **Expected:** Confirmation message

3. **Verify Status Change**
   - Send: `auto sync check`
   - Select same Auto Sync
   - **Expected:** Now shows running menu (status changed to running)

### Validation Points
- ✅ Reminder sent to non-responders only
- ✅ Status changed from paused to running
- ✅ Next pause check scheduled (24h after reminder)

---

## Test Scenario 9: Stop Auto Sync

### Objective
Test stopping an Auto Sync.

### Prerequisites
- Active Auto Sync (running or paused)

### Steps

1. **Access Stop Option**
   - From running menu: Send `2`
   - OR from paused menu: Send `3`
   - **Expected:** "Stop this Auto Sync? Reply yes or exit."

2. **Confirm Stop**
   - Send: `yes`
   - **Expected:** "Auto Sync stopped."

3. **Verify Stop**
   - Send: `auto sync check`
   - **Expected:** Auto Sync no longer appears in list

### Validation Points
- ✅ Confirmation prompt shown
- ✅ Stop confirmed with "yes"
- ✅ Status changed to stopped
- ✅ All pending jobs cancelled
- ✅ Auto Sync removed from active list

---

## Test Scenario 10: Exit During Setup

### Objective
Test exit/cancel functionality during setup.

### Steps

1. **Start Setup**
   - Send: `auto sync Friends`
   - **Expected:** "Event name?"

2. **Exit at Event Name**
   - Send: `exit`
   - **Expected:** Setup cancelled, conversation state cleared

3. **Verify No Draft**
   - Send: `auto sync check`
   - **Expected:** No partial Auto Sync created

### Validation Points
- ✅ Exit clears conversation state
- ✅ No partial records created
- ✅ Can start fresh setup

---

## Test Scenario 11: Invalid Input Handling

### Objective
Test system response to invalid inputs at various stages.

### Test Cases

1. **Invalid Goal Selection**
   - At goal prompt: Send `3`
   - **Expected:** Re-prompts with same goal options

2. **Invalid Send Confirmation**
   - At send prompt: Send `maybe`
   - **Expected:** "Please reply send to start Auto Sync, or exit to cancel."

3. **Invalid Timezone Selection**
   - At timezone prompt: Send `7` or `invalid`
   - **Expected:** System should handle gracefully (may need validation)

4. **Invalid Menu Selection**
   - At running menu: Send `3`
   - **Expected:** Re-prompts with same menu

5. **Invalid Option Selection (Send Invites)**
   - At option selection: Send `99`
   - **Expected:** Should handle gracefully

### Validation Points
- ✅ Invalid inputs rejected
- ✅ Appropriate error messages shown
- ✅ System re-prompts with correct options
- ✅ No crashes or unexpected behavior

---

## Test Scenario 12: Multiple Time Options

### Objective
Test Auto Sync with 2-3 time options.

### Steps

1. **Create Auto Sync with Multiple Options**
   - Follow basic creation flow
   - At time prompt: Send `1/25 7pm, 1/26 8pm, 1/27 6pm`
   - **Expected:** Proceeds to goal selection

2. **Verify Options Saved**
   - Complete setup
   - Check invitee message
   - **Expected:** Message shows all 3 options numbered 1-3

3. **Test Invitee Response**
   - From invitee: Send `1 3`
   - **Expected:** Both options saved

### Validation Points
- ✅ Multiple options accepted (up to 3)
- ✅ All options shown in invitee message
- ✅ Invitee can select multiple options

---

## Test Scenario 13: Response Overwrite

### Objective
Test that last invitee response overwrites previous response.

### Prerequisites
- Active Auto Sync
- Invitee received message

### Steps

1. **First Response**
   - From invitee: Send `1`
   - **Validation:** Response saved

2. **Second Response (Overwrite)**
   - From invitee: Send `2`
   - **Validation:** Previous response overwritten, only option 2 saved

3. **Third Response (None)**
   - From invitee: Send `none`
   - **Validation:** Previous response overwritten, saved as not_available

### Validation Points
- ✅ Last response wins
- ✅ Previous response replaced
- ✅ Database shows only latest response

---

## Test Scenario 14: Calendar Mode (if calendar connected)

### Objective
Test Auto Sync creation with calendar connection.

### Prerequisites
- Organizer has calendar connected

### Steps

1. **Start Auto Sync**
   - Send: `auto sync Friends`
   - Provide event name
   - Skip location
   - **Expected:** "What time window works for you? (e.g., 'next week evenings' or 'weekend mornings')"

2. **Provide Time Window**
   - Send: `next week evenings`
   - **Expected:** Week calendar view with highlighted time slot

3. **Save Option**
   - Send: `yes`
   - **Expected:** Option saved, prompt to add more or send

4. **Complete Setup**
   - Continue to save up to 3 options
   - Select goal and confirm
   - **Expected:** Auto Sync created with calendar timezone

### Validation Points
- ✅ Calendar mode detected
- ✅ Time window parsed correctly
- ✅ Calendar proposals generated
- ✅ Options saved correctly
- ✅ Calendar timezone used

---

## Test Scenario 15: Stored Timezone Reuse

### Objective
Test that stored timezone is reused on subsequent Auto Syncs.

### Steps

1. **First Auto Sync (No Timezone)**
   - Create Auto Sync, select timezone `1` (PT)
   - **Validation:** Timezone saved to profile

2. **Second Auto Sync (Timezone Exists)**
   - Create another Auto Sync
   - Complete setup, confirm send
   - **Expected:** No timezone prompt, uses stored timezone
   - **Expected:** "Auto Sync sent to [N] people." (immediately)

### Validation Points
- ✅ Timezone saved to profile after first use
- ✅ Subsequent Auto Syncs skip timezone prompt
- ✅ Stored timezone used automatically

---

## Test Scenario 16: Auto-End Functionality

### Objective
Test that Auto Sync auto-ends when all option end times pass.

### Prerequisites
- Auto Sync with options that have end times in the past

### Steps

1. **Create Auto Sync with Past Options**
   - Create Auto Sync with options that have already passed
   - **Note:** May need to manually set option end times in database

2. **Trigger Auto-End Check**
   - Wait for `auto_end_check` job to process
   - OR manually trigger the job

3. **Verify Auto-End**
   - Send: `auto sync check`
   - **Expected:** Auto Sync no longer appears (status changed to stopped)

### Validation Points
- ✅ Auto-end check job processes correctly
- ✅ Status changed to stopped when all options pass
- ✅ Uses end_time (not start_time) for boundary check

---

## Test Scenario 17: 24-Hour Reminder

### Objective
Test automatic 24-hour reminder functionality.

### Prerequisites
- Auto Sync created
- Some invitees responded, some did not

### Steps

1. **Wait or Trigger Reminder**
   - Wait 24 hours OR manually trigger `reminder_24h` job

2. **Verify Reminders Sent**
   - Check invitee phones (non-responders)
   - **Expected:** Reminder message received

3. **Verify Organizer Update**
   - Check organizer phone/webchat
   - **Expected:** "Reminder sent for [EVENT NAME] to [PENDING] of [TOTAL] people. Reply auto sync check to manage."

### Validation Points
- ✅ Reminders sent to non-responders only
- ✅ Responders do not receive reminder
- ✅ Organizer receives update message
- ✅ Update shows correct pending/total counts
- ✅ Message saved to message_thread if organizer is host

---

## Test Scenario 18: 48-Hour Pause

### Objective
Test automatic 48-hour pause functionality.

### Prerequisites
- Auto Sync running for 48 hours

### Steps

1. **Wait or Trigger Pause**
   - Wait 48 hours OR manually trigger `pause_check_48h` job

2. **Verify Pause**
   - Send: `auto sync check`
   - Select paused Auto Sync
   - **Expected:** Shows paused status and menu

3. **Verify Organizer Notification**
   - Check organizer phone/webchat
   - **Expected:** Paused summary with stats and menu

### Validation Points
- ✅ Status changed to paused
- ✅ Organizer receives paused summary
- ✅ Summary shows correct response stats
- ✅ Paused menu displayed correctly
- ✅ Message saved to message_thread if organizer is host

---

## Test Scenario 19: Concurrent Auto Syncs

### Objective
Test managing multiple active Auto Syncs simultaneously.

### Steps

1. **Create Multiple Auto Syncs**
   - Create 2-3 Auto Syncs with different event names

2. **Check All Auto Syncs**
   - Send: `auto sync check`
   - **Expected:** All active Auto Syncs listed

3. **Manage Each Separately**
   - Select each Auto Sync by number
   - Perform different actions (send invites, stop, etc.)
   - **Expected:** Actions apply only to selected Auto Sync

### Validation Points
- ✅ All active Auto Syncs shown
- ✅ Selection works correctly
- ✅ Actions apply to correct Auto Sync
- ✅ No cross-contamination between Auto Syncs

---

## Test Scenario 20: Invitee Scoping (Most Recent Message)

### Objective
Test that invitee responses bind to most recent unresolved message.

### Prerequisites
- Multiple Auto Syncs sent to same invitee
- Some messages resolved, some not

### Steps

1. **Create First Auto Sync**
   - Create and send to invitee
   - Invitee responds
   - **Validation:** First message marked as resolved

2. **Create Second Auto Sync**
   - Create another Auto Sync, send to same invitee
   - **Validation:** New message created, first remains resolved

3. **Invitee Responds to Second**
   - From invitee: Send response
   - **Validation:** Response binds to second (most recent) Auto Sync

### Validation Points
- ✅ Most recent unresolved message found
- ✅ Response binds to correct Auto Sync
- ✅ Resolved messages not used for binding

---

## Validation Checklist

### Setup Phase
- [ ] Crew selection works
- [ ] Event name validation works
- [ ] Location skip works
- [ ] Time options parsing works (1-3 options)
- [ ] Goal selection works (1 and 2)
- [ ] Timezone prompt shows numbered list
- [ ] Timezone selection works (1-6 and abbreviations)
- [ ] Timezone normalization works
- [ ] Exit cancels setup correctly

### Invitee Phase
- [ ] Initial messages sent to all crew members
- [ ] Message format correct (header, options, instructions)
- [ ] Valid number responses accepted
- [ ] Multiple number responses accepted
- [ ] "none" response detected
- [ ] Invalid numbers rejected with error message
- [ ] Error message shows correct valid range
- [ ] Response overwrite works (last wins)
- [ ] Silent updates (no confirmation SMS)

### Reminder Phase
- [ ] 24h reminder sent to non-responders only
- [ ] Responders do not receive reminder
- [ ] Organizer receives update message
- [ ] Update message format correct
- [ ] Next pause check scheduled

### Pause Phase
- [ ] 48h pause triggers correctly
- [ ] Status changed to paused
- [ ] Organizer receives paused summary
- [ ] Paused menu shown correctly
- [ ] Invitee responses still accepted when paused

### Management Phase
- [ ] Auto sync check lists all active syncs
- [ ] Selection works correctly
- [ ] Running menu shown for running syncs
- [ ] Paused menu shown for paused syncs
- [ ] Send reminder from paused works
- [ ] Send invites shows option selection
- [ ] Option selection works correctly
- [ ] Calendar event created (if calendar connected)
- [ ] Stop confirmation works
- [ ] Stop completes correctly

### Auto-End Phase
- [ ] Auto-end check processes correctly
- [ ] Uses end_time for boundary check
- [ ] Status changed to stopped when all options pass

---

## Common Issues to Watch For

1. **Timezone Issues**
   - Verify timezone stored in IANA format
   - Verify timezone abbreviation displays correctly in messages

2. **Response Validation**
   - Verify validation checks actual option count, not just 1-3
   - Verify error messages show correct valid range

3. **Message Delivery**
   - Verify organizer messages saved to message_thread when host
   - Verify invitee messages sent via SMS

4. **State Management**
   - Verify conversation state cleared on exit
   - Verify state transitions correctly

5. **Job Scheduling**
   - Verify jobs scheduled at correct times
   - Verify jobs process correctly
   - Verify jobs cancelled when Auto Sync stopped

---

## Test Data Setup

### Create Test Crew
```
1. Send: create crew
2. Send: TestCrew
3. Add members (phone numbers)
```

### Clear Timezone (for timezone tests)
- Manually clear `preferred_timezone` in profiles table

### Create Past Options (for auto-end test)
- Manually set `end_time` in auto_sync_options to past dates

### Trigger Jobs Manually
- Update `scheduled_at` in job_queue to past time
- Jobs will process on next cron run (every minute)

---

## Expected Message Formats

### Initial Invitee Message
```
[Organizer Name] is organizing [Event Name]

Which of these work for you?
1. [Day], [Date] at [Time] [TZ]
2. [Day], [Date] at [Time] [TZ]
3. [Day], [Date] at [Time] [TZ]

Reply with the number(s) that work, or none if nothing works.
```

### Reminder Message
```
Reminder: [Organizer Name] is organizing [Event Name]

Which of these work for you?
[Same options list]

Reply with the number(s) that work, or none if nothing works.
```

### Organizer 24h Update
```
Reminder sent for [EVENT NAME] to [PENDING] of [TOTAL] people. Reply auto sync check to manage.
```

### Paused Summary
```
[EVENT NAME] paused. Responses so far ([RESPONDED]/[TOTAL]):
[Available/Not available breakdown]

1. Send reminder
2. Send invites
3. Stop
Reply with a number or exit.
```

### Invite Confirmation
```
You're invited to [Event Name] on [Day], [Month] [Date] at [Time]. Calendar invite sent.
```

---

## Quick Reference: Commands

**Organizer Commands:**
- `auto sync [crew name]` - Start Auto Sync
- `auto sync check` - List active Auto Syncs
- `exit` - Cancel/exit at any point

**Invitee Responses:**
- `1` or `1 2` or `1,2` - Select option(s)
- `none` - Not available

**Menu Options:**
- Running: `1` (send invites), `2` (stop)
- Paused: `1` (reminder), `2` (send invites), `3` (stop)

---

## Notes for QC

1. **Timing Tests**: Some tests require waiting 24-48 hours. Use manual job triggering for faster testing.

2. **Database Checks**: Some validations require checking database directly:
   - `auto_syncs` table for status
   - `auto_sync_responses` table for responses
   - `job_queue` table for scheduled jobs
   - `profiles.preferred_timezone` for stored timezone

3. **Message Thread**: Organizer messages (when host) appear in webchat, not SMS. Check message_thread table.

4. **Error Messages**: Pay attention to error message formats - they should show correct valid ranges based on actual options.

5. **State Persistence**: Conversation state persists between messages. Use `exit` to clear if needed.

