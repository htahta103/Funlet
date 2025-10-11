# Funlet SMS Handler - Step-by-Step Testing Instructions

This document provides **MANDATORY STEP-BY-STEP** testing instructions for all implemented actions in the funlet-sms-handler.

## 🚨 CRITICAL TESTING RULES

### ❌ **WORKFLOW FAILURE CRITERIA**
- **If ANY step in a workflow fails** → **ENTIRE WORKFLOW FAILS**
- **If workflow doesn't complete ALL steps** → **TEST FAILED**
- **If wrong action is returned** → **IMMEDIATE FAILURE**
- **If conversation state is corrupted** → **IMMEDIATE FAILURE**

### ✅ **WORKFLOW SUCCESS CRITERIA**
- **ALL steps must complete successfully**
- **Correct action returned at each step**
- **Proper conversation state management**
- **Clean state clearing after completion**

## Prerequisites

### 1. **MANDATORY RESET** (Before EVERY test)
```sql
-- Reset user onboarding status
UPDATE profiles SET is_onboarded = false WHERE email = 'htahta103@gmail.com';

-- Clear conversation state
DELETE FROM conversation_state WHERE user_id = (SELECT id FROM profiles WHERE email = 'htahta103@gmail.com');
```

### 2. **Test Configuration**
- **Test phone number**: `+18777804236`
- **Test user email**: `htahta103@gmail.com`
- **Test phone number (new user)**: `+18777804237`

### 3. **Test Command Template**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "YOUR_MESSAGE_HERE",
    "phone_number": "+18777804236"
  }' | jq '.'
```

### 4. **MANDATORY VERIFICATION**
After each step, verify:
- **Action is correct** (check `action` field)
- **Response is appropriate** (check `content` field)
- **No errors in response** (check for error messages)
- **Conversation state is updated** (check database if needed)

### 5. **PHONE NUMBER FORMAT REQUIREMENTS**
**CRITICAL**: Use correct 10-digit phone number format:
- ✅ **CORRECT**: `4155551234` (10 digits)
- ✅ **CORRECT**: `+14155551234` (with +1 prefix)
- ❌ **WRONG**: `555-1234` (7 digits)
- ❌ **WRONG**: `5551234` (7 digits)
- ❌ **WRONG**: `(415) 555-1234` (formatted)

**Examples of correct formats**:
- `John Smith 4155551234`
- `Jane Doe +14155551234`
- `Mike Johnson 4155559999, Sarah Wilson 4155558888`

---

## 1. RECEIVE_MESSAGE FLOW - MANDATORY STEP-BY-STEP TEST

### 1.1 Crew Member Message Reception (Event Context)
**Purpose**: Test crew members sending messages to hosts
**CRITICAL**: ALL 4 steps must complete successfully or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded with existing events and crew members
UPDATE profiles SET is_onboarded = false WHERE email = 'htahta103@gmail.com';
-- Ensure test crew and event exist with crew members
```

**STEP-BY-STEP TESTING**:

#### **Step 1: Crew Member Sends Message (No Event Context)**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "I will be 15 minutes late", "phone_number": "+18777804236", "is_host": false}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "RECEIVE_MESSAGE_EVENT_SELECTION"
- `content` shows event list with numbered options
- `waiting_for` = "event_selection_receive_message"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No event list shown
- Wrong waiting state

#### **Step 2: Crew Member Selects Event**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236", "is_host": false}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "RECEIVE_MESSAGE_EVENT_SELECTED"
- `extracted_params.event_id` contains actual UUID
- `content` shows confirmation message: "Message received: '[message]'. This will be forwarded to the event organizer for '[event_title]'."

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No event details extracted
- No confirmation message

### **RECEIVE_MESSAGE TEST RESULT**:
- **✅ PASS**: All 2 steps completed successfully
- **❌ FAIL**: Any step failed or workflow incomplete

---

## 2. ONBOARDING FLOW - MANDATORY 8-STEP TEST

### 2.1 First-Time User Onboarding
**Purpose**: Test complete onboarding flow for new users
**CRITICAL**: ALL 8 steps must complete successfully or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
UPDATE profiles SET is_onboarded = false WHERE email = 'htahta103@gmail.com';
DELETE FROM conversation_state WHERE user_id = (SELECT id FROM profiles WHERE email = 'htahta103@gmail.com');
```

**STEP-BY-STEP TESTING**:

#### **Step 1: Start Onboarding**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "hi", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_START"
- `content` contains crew name request
- User marked as not onboarded

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No crew name request
- User marked as onboarded

#### **Step 2: Provide Crew Name**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "My crew is Basketball Team", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 1
- `extracted_data.crew_name` = "Basketball Team"
- Asks for location

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Crew name not extracted
- No location request

#### **Step 3: Provide Location**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Central Park", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 2
- `extracted_data.location` = "Central Park"
- Asks for crew members

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Location not extracted
- No crew members request

#### **Step 4: Provide Crew Members**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "John Smith 4155551234, Jane Doe 4155555678", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 3
- `extracted_data.crew_members` contains both members
- Asks for event name

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Members not extracted properly
- No event name request

#### **Step 5: Provide Event Name**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Weekly Basketball Game", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 4
- `extracted_data.event_name` = "Weekly Basketball Game"
- Asks for event location

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Event name not extracted
- No event location request

#### **Step 6: Provide Event Location**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Central Park Basketball Court", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 5
- `extracted_data.event_location` = "Central Park Basketball Court"
- Asks for event date/time

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Event location not extracted
- No event date/time request

#### **Step 7: Provide Event Date/Time**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Next Friday 6:00 PM", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 6
- `extracted_data.event_date` and `event_time` extracted
- Asks for event notes

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Date/time not extracted
- No event notes request

#### **Step 8: Provide Event Notes (Optional)**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Bring your own water", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 7
- `extracted_data.event_notes` = "Bring your own water"
- Asks for confirmation

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Event notes not extracted
- No confirmation request

#### **Step 9: Confirm Event Creation**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "ONBOARDING_CONTINUE"
- `substep` = 8
- `extracted_data.confirmation` = "yes"
- **ONBOARDING_COMPLETED** message
- User marked as onboarded
- Crew and event created in database
- Invitations sent

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- No completion message
- User not marked as onboarded
- Database records not created
- Invitations not sent

### **ONBOARDING TEST RESULT**:
- **✅ PASS**: All 8 steps completed successfully
- **❌ FAIL**: Any step failed or workflow incomplete

---

## 3. CREW MANAGEMENT WORKFLOWS

### 3.1 Create New Crew - SIMPLIFIED WORKFLOW
**Purpose**: Test crew creation for onboarded users with simplified flow (no confirmation)
**CRITICAL**: Tests both crew name extraction patterns

**Test Steps**:

#### **Scenario A: Crew Name Not Provided Initially**
1. **Request Crew Creation**:
   ```json
   {"message": "create crew", "phone_number": "+18777804236"}
   ```
   **Expected**: CREATE_CREW action, asks for crew name

2. **Provide Crew Name**:
   ```json
   {"message": "Soccer Team", "phone_number": "+18777804236"}
   ```
   **Expected**: Crew created immediately, enters member adding mode

#### **Scenario B: Crew Name Provided in Initial Request**
1. **Request Crew Creation with Name**:
   ```json
   {"message": "create crew Tennis Group", "phone_number": "+18777804236"}
   ```
   **Expected**: CREATE_CREW action, crew created immediately, enters member adding mode

#### **Scenario C: Duplicate Crew Name**
1. **Request Crew Creation with Existing Name**:
   ```json
   {"message": "create crew Basketball Team", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_CREATION_ERROR, "Sorry, a crew named 'Basketball Team' already exists. Please try a different name."

#### **Scenario D: Member Adding Mode After Crew Creation**
1. **After crew creation, add members**:
   ```json
   {"message": "John Doe 4155551111", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately, stays in member adding mode

2. **Add another member**:
   ```json
   {"message": "Jane Smith 4155552222", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately, stays in member adding mode

3. **Exit member adding mode**:
   ```json
   {"message": "Create Event", "phone_number": "+18777804236"}
   ```
   **Expected**: Exits to SEND_INVITATIONS workflow

### 3.2 Add Crew Members - ENHANCED WORKFLOW
**Purpose**: Test adding members to existing crew with enhanced crew selection logic
**CRITICAL**: Tests all crew selection scenarios (multiple crews, single crew, zero crews)

**Test Steps**:

#### **Scenario A: Multiple Crews (No Crew Name Specified)**
1. **Request to Add Members**:
   ```json
   {"message": "add members", "phone_number": "+18777804236"}
   ```
   **Expected**: ADD_CREW_MEMBERS action, shows numbered crew list

2. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_SELECTED action, enters member adding mode

3. **Add Member**:
   ```json
   {"message": "Mike Johnson 4155559999", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately (no confirmation), stays in member adding mode

4. **Add Another Member**:
   ```json
   {"message": "Sarah Wilson 4155558888", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately, stays in member adding mode

5. **Exit Member Adding Mode**:
   ```json
   {"message": "Create Event", "phone_number": "+18777804236"}
   ```
   **Expected**: Exits to SEND_INVITATIONS workflow

#### **Scenario B: Single Crew (No Crew Name Specified)**
1. **Ensure user has only 1 crew** (delete other crews)
2. **Request to Add Members**:
   ```json
   {"message": "add members", "phone_number": "+18777804236"}
   ```
   **Expected**: ADD_CREW_MEMBERS action, auto-selects single crew, enters member adding mode

3. **Add Member**:
   ```json
   {"message": "Tom Smith 4155557777", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately, stays in member adding mode

#### **Scenario C: Zero Crews (No Crew Name Specified)**
1. **Delete all crews for user**
2. **Request to Add Members**:
   ```json
   {"message": "add members", "phone_number": "+18777804236"}
   ```
   **Expected**: "No crews found. Type 'Create Crew' to create your first crew."

#### **Scenario D: Crew Name Specified Directly**
1. **Request to Add Members with Crew Name**:
   ```json
   {"message": "add crew member to Basketball Team", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_SELECTED action, enters member adding mode for Basketball Team

2. **Add Member**:
   ```json
   {"message": "Alice Brown 4155553333", "phone_number": "+18777804236"}
   ```
   **Expected**: Member added immediately, stays in member adding mode

#### **Scenario E: "Create Crew" Exit During Crew Selection**
1. **Request to Add Members** (multiple crews):
   ```json
   {"message": "add members", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew list

2. **Exit to Create Crew**:
   ```json
   {"message": "Create Crew", "phone_number": "+18777804236"}
   ```
   **Expected**: Exits to CREATE_CREW workflow

### 3.3 Check Crew Members
**Purpose**: Test viewing crew members

**Test Steps**:
1. **Request Crew Members**:
   ```json
   {"message": "show my crew members", "phone_number": "+18777804236"}
   ```
   **Expected**: CHECK_CREW_MEMBERS action, shows crew list

2. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew members list

---

## 4. ENHANCED ADD_CREW_MEMBERS WORKFLOW - MANDATORY STEP-BY-STEP TEST

### 4.1 Enhanced Add Crew Members (All Scenarios) - MANDATORY TEST
**Purpose**: Test enhanced ADD_CREW_MEMBERS workflow with all crew selection scenarios
**CRITICAL**: ALL scenarios must be tested successfully or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded
UPDATE profiles SET is_onboarded = true WHERE email = 'htahta103@gmail.com';
```

**SCENARIO TESTING**:

#### **Scenario A: Multiple Crews (No Crew Name Specified)**
1. **Ensure user has multiple crews** (create 2-3 crews)
2. **Request to Add Members**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "add members", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "ADD_CREW_MEMBERS"
   - `content` shows numbered crew list
   - `waiting_for` = "crew_selection_for_members"

3. **Select Crew**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "1", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "CREW_SELECTED"
   - `content` shows member adding mode message
   - `waiting_for` = "member_adding_mode"

4. **Add Member**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "Mike Johnson 4155559999", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - Member added immediately (no confirmation)
   - Stays in member adding mode
   - Success message shown

#### **Scenario B: Single Crew (No Crew Name Specified)**
1. **Delete all crews except one**
2. **Request to Add Members**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "add members", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "CREW_SELECTED"
   - Auto-selects single crew
   - No crew selection list shown
   - Enters member adding mode directly

#### **Scenario C: Zero Crews (No Crew Name Specified)**
1. **Delete all crews for user**
2. **Request to Add Members**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "add members", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "ADD_CREW_MEMBERS"
   - `content` = "No crews found. Type 'Create Crew' to create your first crew."

#### **Scenario D: Crew Name Specified Directly**
1. **Request to Add Members with Crew Name**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "add crew member to Basketball Team", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "CREW_SELECTED"
   - `crew_name` = "Basketball Team"
   - Enters member adding mode directly
   - No crew selection list shown

#### **Scenario E: "Create Crew" Exit During Crew Selection**
1. **Request to Add Members** (multiple crews):
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "add members", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **Expected**: Shows crew list

2. **Exit to Create Crew**:
   ```bash
   curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
     -H "Content-Type: application/json" \
     -d '{"message": "Create Crew", "phone_number": "+18777804236", "is_host": true}' | jq '.'
   ```
   **✅ SUCCESS CRITERIA**:
   - `action` = "CREATE_CREW"
   - Exits to CREATE_CREW workflow
   - Asks for crew name

### **ENHANCED ADD_CREW_MEMBERS TEST RESULT**:
- **✅ PASS**: All 5 scenarios completed successfully
- **❌ FAIL**: Any scenario failed or workflow incomplete

---

## 5. SYNC_UP WORKFLOW - MANDATORY STEP-BY-STEP TEST

### 5.1 Sync Up Time Coordination (4 Steps) - MANDATORY TEST
**Purpose**: Test SYNC_UP workflow for time coordination before creating events
**CRITICAL**: ALL 4 steps must complete successfully or TEST FAILS
**HOST ONLY**: SYNC_UP only available for users with `is_host: true`

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded and is_host = true
UPDATE profiles SET is_onboarded = true, is_host = true WHERE email = 'htahta103@gmail.com';
-- Ensure user has active upcoming events
```

**STEP-BY-STEP TESTING**:

#### **Step 1: Start Sync Up**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "sync up", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SYNC_UP_EVENT_SELECTED"
- `content` shows event list with numbered options (if multiple events)
- `waiting_for` = "sync_up_step_2"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No event list shown (if multiple events)
- Wrong waiting state

#### **Step 2: Provide Time Options**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Friday 6pm; Saturday 10am; Sunday 2pm", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SYNC_UP_OPTIONS_COLLECTED"
- `extracted_params.time_options_parsed` contains ISO timestamps
- `waiting_for` = "sync_up_step_3"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No time options parsed
- No ISO timestamps in time_options_parsed

#### **Step 3: Confirm and Send**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SYNC_UP_CONFIRMATION_READY"
- `content` shows sync up summary with event details and time options
- `waiting_for` = "sync_up_confirmation"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No sync up summary shown
- Wrong waiting state

#### **Step 4: Final Confirmation**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SYNC_UP_SEND_INVITES"
- Success message: "Sync up sent to [X] crew members"
- `sync_up` record created in database
- `sync_up_options` records created with proper timestamps
- SMS sent to crew members

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No success message
- Database records not created
- SMS not sent

### **SYNC_UP TEST RESULT**:
- **✅ PASS**: All 4 steps completed successfully
- **❌ FAIL**: Any step failed or workflow incomplete

---

## 6. SEND_INVITATIONS WORKFLOW

### 6.1 Create New Event
**Purpose**: Test creating a new event for a crew

**Test Steps**:
1. **Request to Create Event**:
   ```json
   {"message": "create event", "phone_number": "+18777804236"}
   ```
   **Expected**: SEND_INVITATIONS action, shows crew list

2. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for event name

3. **Provide Event Name**:
   ```json
   {"message": "Weekly Basketball Game", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for event location

4. **Provide Event Location**:
   ```json
   {"message": "Central Park", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for event date/time

5. **Provide Event Date/Time**:
   ```json
   {"message": "Next Friday 6:00 PM", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for event notes (optional)

6. **Provide Event Notes** (optional):
   ```json
   {"message": "Bring your own water", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows event summary and asks for confirmation

7. **Confirm Event Creation**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Creates event and sends invitations to crew members

### 4.2 Send Invitations to Existing Event
**Purpose**: Test sending invitations to an existing event

**Test Steps**:
1. **Request to Send Invitations**:
   ```json
   {"message": "send invitations", "phone_number": "+18777804236"}
   ```
   **Expected**: SEND_INVITATIONS action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew list

3. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew members and asks for confirmation

4. **Confirm Invitations**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Sends invitations to crew members

---

## 5. INVITE_MORE_PEOPLE WORKFLOW

### 5.1 Existing Crew Path (5 Steps)
**Purpose**: Test inviting from existing crew

**Test Steps**:
1. **Start Invite More People**:
   ```json
   {"message": "invite more people", "phone_number": "+18777804236"}
   ```
   **Expected**: INVITE_MORE_PEOPLE action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows method selection: "1) Existing crew 2) New contacts"

3. **Select Existing Crew Method**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew list

4. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew members and asks for confirmation

5. **Confirm Crew Selection**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Sends invitations to crew members

### 5.2 New Contacts Path (5 Steps)
**Purpose**: Test inviting new contacts

**Test Steps**:
1. **Start Invite More People**:
   ```json
   {"message": "invite more people", "phone_number": "+18777804236"}
   ```
   **Expected**: INVITE_MORE_PEOPLE action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows method selection

3. **Select New Contacts Method**:
   ```json
   {"message": "2", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for contact details

4. **Provide Contact Details**:
   ```json
   {"message": "Alice Johnson 4155551111, Bob Wilson 4155552222", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows contact summary and asks for confirmation

5. **Confirm Contact Selection**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Sends invitations to new contacts

---

## 6. SEND_MESSAGE WORKFLOW

### 6.1 Send Message to Event Participants
**Purpose**: Test sending messages to event participants

**Test Steps**:
1. **Request to Send Message**:
   ```json
   {"message": "send message", "phone_number": "+18777804236"}
   ```
   **Expected**: SEND_MESSAGE action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows targeting options (Everyone, Non-responders, Coming, Maybe, Out)

3. **Select Target Group**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for message text

4. **Provide Message Text**:
   ```json
   {"message": "Don't forget to bring your equipment tomorrow!", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows confirmation prompt

5. **Confirm Message Sending**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Sends message to selected group

---

## 7. CHECK_RSVPS WORKFLOW

### 7.1 Check RSVP Responses
**Purpose**: Test viewing RSVP responses for events

**Test Steps**:
1. **Request to Check RSVPs**:
   ```json
   {"message": "check rsvps", "phone_number": "+18777804236"}
   ```
   **Expected**: CHECK_RSVPS action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows RSVP summary with In/Out/Maybe/No Response counts

---

## 8. HELP SYSTEM

### 8.1 General Help Requests
**Purpose**: Test basic help functionality

**Test Steps**:
1. **General Help Request**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns welcome message

2. **Question Mark Help**:
   ```json
   {"message": "?", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides general assistance

3. **Specific Help Request**:
   ```json
   {"message": "help me", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides contextual help

### 8.2 Feature-Specific Help
**Purpose**: Test help requests for specific features

**Test Steps**:
1. **Crew Management Help**:
   ```json
   {"message": "how do I create a crew", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns crew creation guidance

2. **Event Help**:
   ```json
   {"message": "how do I create an event", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns event creation guidance

3. **RSVP Help**:
   ```json
   {"message": "how do I check RSVPs", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns RSVP checking guidance

4. **Messaging Help**:
   ```json
   {"message": "how do I send a message", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns messaging guidance

---

## 9. ERROR HANDLING

### 9.1 Invalid Actions
**Purpose**: Test handling of invalid/unclear messages

**Test Steps**:
1. **Send Unclear Message**:
   ```json
   {"message": "asdfghjkl", "phone_number": "+18777804236"}
   ```
   **Expected**: INVALID action, asks for clarification

2. **Send Confusing Message**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate clarification based on context

---

## 10. CONFIRMATION FLOWS

### 10.1 Crew Creation Confirmation
**Purpose**: Test crew creation confirmation responses

**Test Steps**:
1. **Create Crew** (follow steps from 3.1)
2. **Test "No" Response**:
   ```json
   {"message": "no", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_CONFIRMATION_NO, cancels crew creation

3. **Test Unclear Response**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_CONFIRMATION_CLARIFY, asks for clarification

### 10.2 Member Addition Confirmation
**Purpose**: Test member addition confirmation responses

**Test Steps**:
1. **Add Members** (follow steps from 3.2)
2. **Test "No" Response**:
   ```json
   {"message": "no", "phone_number": "+18777804236"}
   ```
   **Expected**: MEMBER_CONFIRMATION_NO, cancels member addition

3. **Test Unclear Response**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: MEMBER_CONFIRMATION_CLARIFY, asks for clarification

---

## 11. CONVERSATION STATE TESTING

### 11.1 State Persistence
**Purpose**: Test conversation state management

**Test Steps**:
1. **Start any flow** (e.g., invite more people)
2. **Check conversation state**:
   ```sql
   SELECT current_state, last_action, extracted_data FROM conversation_state WHERE user_id = (SELECT id FROM profiles WHERE email = 'htahta103@gmail.com');
   ```
3. **Continue flow** and verify state updates
4. **Complete flow** and verify state is cleared

### 11.2 Context Building
**Purpose**: Test conversation context for AI assistant

**Test Steps**:
1. **Start multi-step flow**
2. **Check extracted_data** contains relevant context
3. **Verify AI receives proper context** for next step

---

## 12. EDGE CASES

### 12.1 Empty Responses
**Purpose**: Test handling of empty or minimal responses

**Test Steps**:
1. **Send empty message**:
   ```json
   {"message": "", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate error handling

2. **Send single character**:
   ```json
   {"message": "a", "phone_number": "+18777804236"}
   ```
   **Expected**: INVALID action or appropriate clarification

### 12.2 Invalid Phone Numbers
**Purpose**: Test handling of invalid contact information

**Test Steps**:
1. **Provide invalid phone numbers**:
   ```json
   {"message": "John Smith abc-def", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate error handling or clarification request

### 12.3 Duplicate Actions
**Purpose**: Test handling of repeated actions

**Test Steps**:
1. **Complete a flow** (e.g., create crew)
2. **Immediately repeat the same action**:
   ```json
   {"message": "create a new crew", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate handling (either allow or prevent duplicate)

---

## 13. PERFORMANCE TESTING

### 13.1 Rapid Succession
**Purpose**: Test system under rapid message succession

**Test Steps**:
1. **Send multiple messages quickly** without waiting for responses
2. **Verify system handles concurrent requests** properly
3. **Check for race conditions** in conversation state

### 13.2 Large Data Sets
**Purpose**: Test with large amounts of data

**Test Steps**:
1. **Add many crew members** (10+ members)
2. **Create multiple crews** (5+ crews)
3. **Test invitation flows** with large crews
4. **Verify performance** remains acceptable

---

## 14. INTEGRATION TESTING

### 14.1 End-to-End Flows
**Purpose**: Test complete user journeys

**Test Steps**:
1. **New user onboarding** → **Create crew** → **Add members** → **Create event** → **Send invitations**
2. **Existing user** → **Invite more people** → **Both paths** (existing crew + new contacts)
3. **Multiple users** → **Test isolation** of conversation states

### 14.2 Database Consistency
**Purpose**: Test data integrity

**Test Steps**:
1. **Complete various flows**
2. **Check database consistency**:
   ```sql
   -- Check for orphaned records
   SELECT * FROM crew_members WHERE crew_id NOT IN (SELECT id FROM crews);
   SELECT * FROM invitations WHERE event_id NOT IN (SELECT id FROM events);
   ```
3. **Verify foreign key constraints** are maintained

---

## 15. HELP SYSTEM TESTING

### 15.1 Basic Help Requests
**Purpose**: Test basic help functionality and general assistance

**Test Steps**:
1. **General Help Request**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns welcome message for new users

2. **Question Mark Help**:
   ```json
   {"message": "?", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides general assistance

3. **Specific Help Request**:
   ```json
   {"message": "help me", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides contextual help

### 15.2 Feature-Specific Help
**Purpose**: Test help requests for specific features

**Test Steps**:
1. **Crew Management Help**:
   ```json
   {"message": "how do I create a crew", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns crew creation guidance

2. **Event Help**:
   ```json
   {"message": "how do I create an event", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns event creation guidance

3. **RSVP Help**:
   ```json
   {"message": "how do I check RSVPs", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns RSVP checking guidance

4. **Messaging Help**:
   ```json
   {"message": "how do I send a message", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns messaging guidance

5. **Sync Up Help**:
   ```json
   {"message": "what is sync up", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns sync up explanation

### 15.3 Context-Aware Help
**Purpose**: Test help requests during different user states

**Test Steps**:
1. **Help During Onboarding**:
   ```json
   {"message": "help", "phone_number": "+18777804237"}
   ```
   **Expected**: HELP action, provides onboarding-specific guidance

2. **Help During Workflow**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides context-aware help based on current workflow

3. **Help with Specific Questions During Workflows**:
   ```json
   {"message": "what should I do next", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides workflow-specific guidance

### 15.4 Help Categorization and Logging
**Purpose**: Test help request categorization and logging

**Test Steps**:
1. **Check Help Usage Logging**:
   ```sql
   SELECT * FROM help_usage_log WHERE phone_number = '+18777804236' ORDER BY timestamp DESC LIMIT 5;
   ```
   **Expected**: Recent help requests with proper categorization

2. **Verify Help Categories**:
   ```sql
   SELECT help_category, COUNT(*) as count FROM help_usage_log GROUP BY help_category;
   ```
   **Expected**: Different help categories (crew_management, events, rsvps, etc.) are being logged

3. **Check Help Response Quality**:
   ```sql
   SELECT help_question, response_provided, help_category FROM help_usage_log WHERE phone_number = '+18777804236' ORDER BY timestamp DESC;
   ```
   **Expected**: Appropriate responses for different question types

### 15.5 Help Priority Testing
**Purpose**: Test that help requests override other contexts

**Test Steps**:
1. **Help During Event Selection**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not event selection continuation)

2. **Help During Confirmation**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not confirmation response)

3. **Help During Member Addition**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not member addition continuation)

---

## 🎯 MANDATORY TEST EXECUTION ORDER

### **PHASE 1: CORE WORKFLOWS (MUST PASS)**
1. **RECEIVE_MESSAGE FLOW** (2 steps) - **CRITICAL**
2. **ONBOARDING FLOW** (8 steps) - **CRITICAL**
3. **INVITE MORE PEOPLE - EXISTING CREW PATH** (5 steps) - **CRITICAL**
4. **INVITE MORE PEOPLE - NEW CONTACTS PATH** (5 steps) - **CRITICAL**
5. **HELP SYSTEM** (Multiple scenarios) - **CRITICAL**

### **PHASE 2: SUPPORTING WORKFLOWS**
6. **CREW MANAGEMENT** (Create, Add Members, Check Members)
7. **SEND_INVITATIONS** (Create Event, Send Invitations)
8. **SEND_MESSAGE** (Send Message to Participants)
9. **CHECK_RSVPS** (View RSVP Responses)

### **PHASE 3: EDGE CASES**
10. **ERROR HANDLING**
11. **CONFIRMATION FLOWS**
12. **CONVERSATION STATE TESTING**

---

## 🚨 CRITICAL TESTING RULES

### ❌ **IMMEDIATE FAILURE CONDITIONS**
- **Any workflow step returns wrong action** → **TEST FAILED**
- **Any workflow doesn't complete all steps** → **TEST FAILED**
- **Conversation state corruption** → **TEST FAILED**
- **Database inconsistencies** → **TEST FAILED**
- **SMS sending failures** → **TEST FAILED**

### ✅ **SUCCESS REQUIREMENTS**
- **ALL steps in each workflow must complete**
- **Correct action returned at each step**
- **Proper conversation state management**
- **Clean state clearing after completion**
- **Database integrity maintained**
- **SMS messages sent successfully**

---

## 📊 TEST EXECUTION CHECKLIST

### **BEFORE EACH TEST**:
- [ ] Reset user onboarding status
- [ ] Clear conversation state
- [ ] Verify test phone number
- [ ] Check database is clean

### **DURING EACH TEST**:
- [ ] Execute each step in sequence
- [ ] Verify action is correct
- [ ] Check response content
- [ ] Validate extracted parameters
- [ ] Monitor conversation state

### **AFTER EACH TEST**:
- [ ] Verify workflow completed
- [ ] Check database consistency
- [ ] Confirm state is cleared
- [ ] Validate SMS delivery
- [ ] Document any failures

---

## 🎯 EXPECTED RESULTS SUMMARY

### ✅ **SUCCESSFUL FLOW INDICATORS**:
- Correct action classification by AI assistant
- Proper conversation state management
- Accurate data extraction and storage
- Appropriate SMS responses
- Clean state clearing after completion
- HELP requests properly detected and categorized
- Database integrity maintained
- All workflow steps completed

### ❌ **FAILURE INDICATORS**:
- Wrong action classification
- Conversation state corruption
- Missing or incorrect data
- SMS sending failures
- State not cleared after completion
- HELP requests not properly detected or categorized
- Database inconsistencies
- Incomplete workflows

### 🔍 **DEBUGGING TIPS**:
1. **Check conversation state** after each step
2. **Review AI assistant responses** for correct action classification
3. **Verify extracted parameters** match expected format
4. **Monitor SMS delivery** (check Twilio logs)
5. **Check database consistency** after each flow
6. **Verify help usage logging** with proper categorization
7. **Test help requests during different workflow states**
8. **Validate workflow completion** before moving to next test

---

## 📋 MANDATORY TEST DOCUMENTATION

### **FOR EACH TEST**:
- **Test Name**: [Workflow Name]
- **Start Time**: [Timestamp]
- **End Time**: [Timestamp]
- **Steps Completed**: [X/Y]
- **Result**: ✅ PASS / ❌ FAIL
- **Failure Reason**: [If failed, specific step and reason]
- **Database State**: [Clean/Corrupted]
- **SMS Status**: [Sent/Failed]

### **OVERALL TEST RESULTS**:
- **Total Tests**: [Number]
- **Passed**: [Number]
- **Failed**: [Number]
- **Success Rate**: [Percentage]
- **Critical Failures**: [List any critical workflow failures]

---

## 🚨 CRITICAL NOTES

- **NEVER skip steps** in any workflow
- **ALWAYS verify each step** before proceeding
- **RESET state** between different test flows
- **DOCUMENT all failures** with specific details
- **STOP testing** if critical workflows fail
- **VERIFY database integrity** after each test
- **CHECK SMS delivery** for all invitation flows
- **VALIDATE conversation state** management
- **TEST HELP system** in various contexts
- **ENSURE all workflows complete** successfully

**REMEMBER**: If ANY workflow doesn't complete ALL steps → **ENTIRE TEST SUITE FAILS**

**Test Steps**:
1. **Request to Add Members**:
   ```json
   {"message": "add members to my crew", "phone_number": "+18777804236"}
   ```
   **Expected**: ADD_CREW_MEMBERS action, shows crew list

2. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Asks for member details

3. **Provide Member Details**:
   ```json
   {"message": "Mike Johnson 4155559999, Sarah Wilson 4155558888", "phone_number": "+18777804236"}
   ```
   **Expected**: MEMBER_CONFIRMATION_YES, asks for confirmation

4. **Confirm Member Addition**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Members added successfully

### 2.3 Check Crew Members
**Purpose**: Test viewing crew members

**Test Steps**:
1. **Request Crew Members**:
   ```json
   {"message": "show my crew members", "phone_number": "+18777804236"}
   ```
   **Expected**: CHECK_CREW_MEMBERS action, shows crew list

2. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew members list

---

## 3. INVITE MORE PEOPLE FLOW - MANDATORY STEP-BY-STEP TEST

### 3.1 Existing Crew Path (5 Steps) - MANDATORY TEST
**Purpose**: Test inviting from existing crew
**CRITICAL**: ALL 5 steps must complete successfully or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded with existing crews and events
UPDATE profiles SET is_onboarded = true WHERE email = 'htahta103@gmail.com';
```

**STEP-BY-STEP TESTING**:

#### **Step 1: Start Invite More People**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "invite more people", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE"
- `content` shows event list with numbered options
- `waiting_for` = "invite_more_people_event_selection"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No event list shown
- Wrong waiting state

#### **Step 2: Select Event**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_2"
- `extracted_params.event_id` contains actual UUID
- `extracted_params.event_title` contains event name
- Shows method selection: "1) Existing crew 2) New contacts"

**❌ FAILURE CRITERIA**:
- Wrong action (e.g., CHECK_RSVPS)
- No event details extracted
- No method selection shown

#### **Step 3: Select Existing Crew Method**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_3"
- `extracted_params.invite_method` = "existing_crew"
- Shows crew list with numbered options

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Wrong invite method
- No crew list shown

#### **Step 4: Select Crew**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_4A"
- `extracted_params.crew_id` contains actual UUID
- `extracted_params.crew_name` contains crew name
- Shows crew members and asks for confirmation

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- No crew details extracted
- No confirmation request

#### **Step 5: Confirm Crew Selection**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_5A"
- `extracted_params.confirm` = true
- Success message: "X more invites sent to [Event Name]!"
- Invitations sent to crew members

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- No success message
- Invitations not sent

### **EXISTING CREW PATH TEST RESULT**:
- **✅ PASS**: All 5 steps completed successfully
- **❌ FAIL**: Any step failed or workflow incomplete

---

### 3.2 New Contacts Path (5 Steps) - MANDATORY TEST
**Purpose**: Test inviting new contacts
**CRITICAL**: ALL 5 steps must complete successfully or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded with existing events
UPDATE profiles SET is_onboarded = true WHERE email = 'htahta103@gmail.com';
```

**STEP-BY-STEP TESTING**:

#### **Step 1: Start Invite More People**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "invite more people", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE"
- `content` shows event list with numbered options
- `waiting_for` = "invite_more_people_event_selection"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No event list shown
- Wrong waiting state

#### **Step 2: Select Event**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_2"
- `extracted_params.event_id` contains actual UUID
- `extracted_params.event_title` contains event name
- Shows method selection: "1) Existing crew 2) New contacts"

**❌ FAILURE CRITERIA**:
- Wrong action (e.g., CHECK_RSVPS)
- No event details extracted
- No method selection shown

#### **Step 3: Select New Contacts Method**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "2", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_3"
- `extracted_params.invite_method` = "new_contacts"
- Asks for contact details: "Send me the names and phone numbers..."

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Wrong invite method
- No contact details request

#### **Step 4: Provide Contact Details**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Alice Johnson 4155551111, Bob Wilson 4155552222", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_4"
- `extracted_params.contacts` contains both contacts with proper format
- Shows contact summary and asks for confirmation

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- Contacts not extracted properly
- No confirmation request

#### **Step 5: Confirm Contact Selection**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236"}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "INVITE_MORE_PEOPLE_STEP_5"
- `extracted_params.confirm` = true
- Success message: "X more invites sent to [Event Name]! X new contacts added as crew members."
- Invitations sent to new contacts

**❌ FAILURE CRITERIA**:
- Wrong action or substep
- No success message
- Invitations not sent

### **NEW CONTACTS PATH TEST RESULT**:
- **✅ PASS**: All 5 steps completed successfully
- **❌ FAIL**: Any step failed or workflow incomplete

---

## 4. SEND_INVITATIONS WORKFLOW - COMPREHENSIVE TEST CASES

### 4.1 Enhanced SEND_INVITATIONS - Multiple Test Scenarios
**Purpose**: Test all SEND_INVITATIONS scenarios including new 2-step flow and traditional flow
**CRITICAL**: ALL test cases must pass or TEST FAILS

**MANDATORY RESET BEFORE TEST**:
```sql
-- Ensure user is onboarded with existing crews
UPDATE profiles SET is_onboarded = true WHERE email = 'htahta103@gmail.com';
```

### **TEST CASE 1: COMPLETE EVENT DETAILS IN ONE MESSAGE**
**Purpose**: Test the new "Add event details for [Crew Name]:" format with all details provided

#### **Step 1: Complete Event Details**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Add event details for Test Crew 2025: Pickleball Tournament, October 20, 2pm, Piper Park, Great tournament for all skill levels", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.crew_name` = "Test Crew 2025"
- `extracted_params.event_name` = "Pickleball Tournament"
- `extracted_params.event_date` = "October 20"
- `extracted_params.event_time` = "2pm"
- `extracted_params.event_location` = "Piper Park"
- `extracted_params.event_notes` = "Great tournament for all skill levels"
- `content` shows confirmation: "Confirm: Pickleball Tournament at Piper Park on October 20, 2pm. Note: Great tournament for all skill levels. Send invites?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Crew name not extracted
- Event details not extracted properly
- No confirmation shown

### **TEST CASE 2: MISSING FIELDS - SEQUENTIAL COLLECTION**
**Purpose**: Test when user provides partial details and system asks for missing fields

#### **Step 1: Partial Event Details**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Add event details for Test Crew 2025: Pickleball Tournament, October 20", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.crew_name` = "Test Crew 2025"
- `extracted_params.event_name` = "Pickleball Tournament"
- `extracted_params.event_date` = "October 20"
- `content` asks for missing field: "What's the start time?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Crew name not extracted
- Event details not extracted
- No request for missing field

#### **Step 2: Provide Missing Start Time**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "2pm", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_time` = "2pm"
- `content` asks for missing field: "What's the location?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Time not extracted
- No request for next missing field

#### **Step 3: Provide Missing Location**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Piper Park", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_location` = "Piper Park"
- `content` shows confirmation with all details

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Location not extracted
- No confirmation shown

### **TEST CASE 3: CREW NAME EXTRACTION ONLY**
**Purpose**: Test when user provides only crew name and system asks for event details sequentially

#### **Step 1: Crew Name Only**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Add event details for Test Crew 2025:", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.crew_name` = "Test Crew 2025"
- `content` asks for event name: "Creating event for 'Test Crew 2025'. What's the event name?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Crew name not extracted
- No event name request

#### **Step 2: Provide Event Name**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Basketball Game", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_name` = "Basketball Game"
- `content` asks for date: "What's the date?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Event name not extracted
- No date request

#### **Step 3: Provide Date**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Friday", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_date` = "Friday"
- `content` asks for start time: "What's the start time?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Date not extracted
- No time request

#### **Step 4: Provide Start Time**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "6pm", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_time` = "6pm"
- `content` asks for location: "What's the location?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Time not extracted
- No location request

#### **Step 5: Provide Location**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Community Center", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.event_location` = "Community Center"
- `content` shows confirmation: "Confirm: Basketball Game at Community Center on Friday, 6pm. Send invites?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Location not extracted
- No confirmation shown

### **TEST CASE 4: ERROR MESSAGES FOR MISSING FIELDS**
**Purpose**: Test error messages when user provides invalid input during field collection

#### **Step 1: Invalid Input During Event Name Collection**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "asdf", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `content` shows error message: "I didn't understand that. What's the event name? Type 'exit' to cancel."

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No error message shown
- System doesn't ask for clarification

### **TEST CASE 5: TRADITIONAL CREW SELECTION FLOW**
**Purpose**: Test the traditional "create event" flow with crew selection

#### **Step 1: Request to Create Event**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "create event", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `content` shows crew list with numbered options
- `waiting_for` = "send_invitations_step_1"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No crew list shown
- Wrong waiting state

#### **Step 2: Select Crew**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.crew_id` contains actual UUID
- `content` asks for event name: "What's the event name?"

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No crew details extracted
- No event name request

### **TEST CASE 6: CONFIRMATION FLOW**
**Purpose**: Test the final confirmation step

#### **Step 1: Confirm Event Creation**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- `extracted_params.confirm` = true
- Success message: "[X] invites sent for [Event Name] on [Date] at [Time]. Check RSVPs: funlet.ai/event/[event-id]"
- Event created in database
- Invitations sent to crew members

**❌ FAILURE CRITERIA**:
- Wrong action returned
- No success message
- Event not created
- Invitations not sent

### **TEST CASE 7: OPTIONAL FIELDS HANDLING**
**Purpose**: Test that optional fields (end time, notes) are never asked for explicitly

#### **Step 1: Complete Required Fields Only**
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler" \
  -H "Content-Type: application/json" \
  -d '{"message": "Add event details for Test Crew 2025: Basketball Game, Friday, 6pm, Community Center", "phone_number": "+18777804236", "is_host": true}' | jq '.'
```
**✅ SUCCESS CRITERIA**:
- `action` = "SEND_INVITATIONS"
- All required fields extracted (name, date, time, location)
- `content` shows confirmation immediately
- No request for optional fields (end time, notes)

**❌ FAILURE CRITERIA**:
- Wrong action returned
- Required fields not extracted
- System asks for optional fields
- No confirmation shown

### **SEND_INVITATIONS TEST RESULTS**:
- **✅ PASS**: All 7 test cases completed successfully
- **❌ FAIL**: Any test case failed or workflow incomplete

### **KEY FEATURES TESTED**:
1. ✅ **Complete event details in one message** - "Add event details for [Crew Name]: ..." format
2. ✅ **Crew name extraction** from "Add event details for [Crew Name]:" format
3. ✅ **Sequential field collection** for missing required fields
4. ✅ **Error messages** for invalid input during field collection
5. ✅ **Traditional crew selection flow** for "create event" command
6. ✅ **Confirmation flow** with proper success messages
7. ✅ **Optional fields handling** - never asked for explicitly, only used if provided
8. ✅ **Required fields order** - name → date → time → location
9. ✅ **Database integration** - event creation and invitation sending
10. ✅ **SMS delivery** - invitations sent to crew members

### 4.2 Send Invitations to Existing Event
**Purpose**: Test sending invitations to an existing event

**Test Steps**:
1. **Request to Send Invitations**:
   ```json
   {"message": "send invitations", "phone_number": "+18777804236"}
   ```
   **Expected**: SEND_INVITATIONS action, shows event list

2. **Select Event**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew list

3. **Select Crew**:
   ```json
   {"message": "1", "phone_number": "+18777804236"}
   ```
   **Expected**: Shows crew members and asks for confirmation

4. **Confirm Invitations**:
   ```json
   {"message": "yes", "phone_number": "+18777804236"}
   ```
   **Expected**: Sends invitations to crew members

---

## 5. ERROR HANDLING

### 5.1 Invalid Actions
**Purpose**: Test handling of invalid/unclear messages

**Test Steps**:
1. **Send Unclear Message**:
   ```json
   {"message": "asdfghjkl", "phone_number": "+18777804236"}
   ```
   **Expected**: INVALID action, asks for clarification

2. **Send Confusing Message**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate clarification based on context

---

## 6. CONFIRMATION FLOWS

### 6.1 Crew Creation Confirmation
**Purpose**: Test crew creation confirmation responses

**Test Steps**:
1. **Create Crew** (follow steps from 2.1)
2. **Test "No" Response**:
   ```json
   {"message": "no", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_CONFIRMATION_NO, cancels crew creation

3. **Test Unclear Response**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: CREW_CONFIRMATION_CLARIFY, asks for clarification

### 6.2 Member Addition Confirmation
**Purpose**: Test member addition confirmation responses

**Test Steps**:
1. **Add Members** (follow steps from 2.2)
2. **Test "No" Response**:
   ```json
   {"message": "no", "phone_number": "+18777804236"}
   ```
   **Expected**: MEMBER_CONFIRMATION_NO, cancels member addition

3. **Test Unclear Response**:
   ```json
   {"message": "maybe", "phone_number": "+18777804236"}
   ```
   **Expected**: MEMBER_CONFIRMATION_CLARIFY, asks for clarification

---

## 7. CONVERSATION STATE TESTING

### 7.1 State Persistence
**Purpose**: Test conversation state management

**Test Steps**:
1. **Start any flow** (e.g., invite more people)
2. **Check conversation state**:
   ```sql
   SELECT current_state, last_action, extracted_data FROM conversation_state WHERE user_id = (SELECT id FROM profiles WHERE email = 'htahta103@gmail.com');
   ```
3. **Continue flow** and verify state updates
4. **Complete flow** and verify state is cleared

### 7.2 Context Building
**Purpose**: Test conversation context for AI assistant

**Test Steps**:
1. **Start multi-step flow**
2. **Check extracted_data** contains relevant context
3. **Verify AI receives proper context** for next step

---

## 8. EDGE CASES

### 8.1 Empty Responses
**Purpose**: Test handling of empty or minimal responses

**Test Steps**:
1. **Send empty message**:
   ```json
   {"message": "", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate error handling

2. **Send single character**:
   ```json
   {"message": "a", "phone_number": "+18777804236"}
   ```
   **Expected**: INVALID action or appropriate clarification

### 8.2 Invalid Phone Numbers
**Purpose**: Test handling of invalid contact information

**Test Steps**:
1. **Provide invalid phone numbers**:
   ```json
   {"message": "John Smith abc-def", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate error handling or clarification request

### 8.3 Duplicate Actions
**Purpose**: Test handling of repeated actions

**Test Steps**:
1. **Complete a flow** (e.g., create crew)
2. **Immediately repeat the same action**:
   ```json
   {"message": "create a new crew", "phone_number": "+18777804236"}
   ```
   **Expected**: Appropriate handling (either allow or prevent duplicate)

---

## 9. PERFORMANCE TESTING

### 9.1 Rapid Succession
**Purpose**: Test system under rapid message succession

**Test Steps**:
1. **Send multiple messages quickly** without waiting for responses
2. **Verify system handles concurrent requests** properly
3. **Check for race conditions** in conversation state

### 9.2 Large Data Sets
**Purpose**: Test with large amounts of data

**Test Steps**:
1. **Add many crew members** (10+ members)
2. **Create multiple crews** (5+ crews)
3. **Test invitation flows** with large crews
4. **Verify performance** remains acceptable

---

## 10. INTEGRATION TESTING

### 10.1 End-to-End Flows
**Purpose**: Test complete user journeys

**Test Steps**:
1. **New user onboarding** → **Create crew** → **Add members** → **Create event** → **Send invitations**
2. **Existing user** → **Invite more people** → **Both paths** (existing crew + new contacts)
3. **Multiple users** → **Test isolation** of conversation states

### 10.2 Database Consistency
**Purpose**: Test data integrity

**Test Steps**:
1. **Complete various flows**
2. **Check database consistency**:
   ```sql
   -- Check for orphaned records
   SELECT * FROM crew_members WHERE crew_id NOT IN (SELECT id FROM crews);
   SELECT * FROM invitations WHERE event_id NOT IN (SELECT id FROM events);
   ```
3. **Verify foreign key constraints** are maintained

---

## 11. HELP ACTION TESTING

### 11.1 Basic Help Requests
**Purpose**: Test basic help functionality and general assistance

**Test Steps**:
1. **General Help Request**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns welcome message for new users

2. **Question Mark Help**:
   ```json
   {"message": "?", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides general assistance

3. **Specific Help Request**:
   ```json
   {"message": "help me", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides contextual help

### 11.2 Feature-Specific Help
**Purpose**: Test help requests for specific features

**Test Steps**:
1. **Crew Management Help**:
   ```json
   {"message": "how do I create a crew", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns crew creation guidance

2. **Event Help**:
   ```json
   {"message": "how do I create an event", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns event creation guidance

3. **RSVP Help**:
   ```json
   {"message": "how do I check RSVPs", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns RSVP checking guidance

4. **Messaging Help**:
   ```json
   {"message": "how do I send a message", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns messaging guidance

5. **Sync Up Help**:
   ```json
   {"message": "what is sync up", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, returns sync up explanation

### 11.3 Context-Aware Help
**Purpose**: Test help requests during different user states

**Test Steps**:
1. **Help During Onboarding**:
   ```json
   {"message": "help", "phone_number": "+18777804237"}
   ```
   **Expected**: HELP action, provides onboarding-specific guidance

2. **Help During Workflow**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides context-aware help based on current workflow

3. **Help with Specific Questions During Workflows**:
   ```json
   {"message": "what should I do next", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action, provides workflow-specific guidance

### 11.4 Help Categorization and Logging
**Purpose**: Test help request categorization and logging

**Test Steps**:
1. **Check Help Usage Logging**:
   ```sql
   SELECT * FROM help_usage_log WHERE phone_number = '+18777804236' ORDER BY timestamp DESC LIMIT 5;
   ```
   **Expected**: Recent help requests with proper categorization

2. **Verify Help Categories**:
   ```sql
   SELECT help_category, COUNT(*) as count FROM help_usage_log GROUP BY help_category;
   ```
   **Expected**: Different help categories (crew_management, events, rsvps, etc.) are being logged

3. **Check Help Response Quality**:
   ```sql
   SELECT help_question, response_provided, help_category FROM help_usage_log WHERE phone_number = '+18777804236' ORDER BY timestamp DESC;
   ```
   **Expected**: Appropriate responses for different question types

### 11.5 Help Priority Testing
**Purpose**: Test that help requests override other contexts

**Test Steps**:
1. **Help During Event Selection**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not event selection continuation)

2. **Help During Confirmation**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not confirmation response)

3. **Help During Member Addition**:
   ```json
   {"message": "help", "phone_number": "+18777804236"}
   ```
   **Expected**: HELP action (not member addition continuation)

---

## 🎯 MANDATORY TEST EXECUTION ORDER

### **PHASE 1: CORE WORKFLOWS (MUST PASS)**
1. **ONBOARDING FLOW** (8 steps) - **CRITICAL**
2. **INVITE MORE PEOPLE - EXISTING CREW PATH** (5 steps) - **CRITICAL**
3. **INVITE MORE PEOPLE - NEW CONTACTS PATH** (5 steps) - **CRITICAL**
4. **SYNC_UP WORKFLOW** (4 steps) - **CRITICAL**
5. **HELP SYSTEM** (Multiple scenarios) - **CRITICAL**

### **PHASE 2: SUPPORTING WORKFLOWS**
6. **CREW MANAGEMENT** (Create, Add Members, Check Members)
7. **ENHANCED ADD_CREW_MEMBERS** (All scenarios: multiple crews, single crew, zero crews, crew name specified)
8. **SEND_INVITATIONS** (Corrected field order: name → date → time → location → notes → confirmation)
9. **RSVP CHECKING**
10. **MESSAGING**

### **PHASE 3: EDGE CASES**
11. **ERROR HANDLING**
12. **CONFIRMATION FLOWS**
13. **CONVERSATION STATE TESTING**

---

## 🚨 CRITICAL TESTING RULES

### ❌ **IMMEDIATE FAILURE CONDITIONS**
- **Any workflow step returns wrong action** → **TEST FAILED**
- **Any workflow doesn't complete all steps** → **TEST FAILED**
- **Conversation state corruption** → **TEST FAILED**
- **Database inconsistencies** → **TEST FAILED**
- **SMS sending failures** → **TEST FAILED**

### ✅ **SUCCESS REQUIREMENTS**
- **ALL steps in each workflow must complete**
- **Correct action returned at each step**
- **Proper conversation state management**
- **Clean state clearing after completion**
- **Database integrity maintained**
- **SMS messages sent successfully**

---

## 📊 TEST EXECUTION CHECKLIST

### **BEFORE EACH TEST**:
- [ ] Reset user onboarding status
- [ ] Clear conversation state
- [ ] Verify test phone number
- [ ] Check database is clean

### **DURING EACH TEST**:
- [ ] Execute each step in sequence
- [ ] Verify action is correct
- [ ] Check response content
- [ ] Validate extracted parameters
- [ ] Monitor conversation state

### **AFTER EACH TEST**:
- [ ] Verify workflow completed
- [ ] Check database consistency
- [ ] Confirm state is cleared
- [ ] Validate SMS delivery
- [ ] Document any failures

---

## 🎯 EXPECTED RESULTS SUMMARY

### ✅ **SUCCESSFUL FLOW INDICATORS**:
- Correct action classification by AI assistant
- Proper conversation state management
- Accurate data extraction and storage
- Appropriate SMS responses
- Clean state clearing after completion
- HELP requests properly detected and categorized
- Database integrity maintained
- All workflow steps completed

### ❌ **FAILURE INDICATORS**:
- Wrong action classification
- Conversation state corruption
- Missing or incorrect data
- SMS sending failures
- State not cleared after completion
- HELP requests not properly detected or categorized
- Database inconsistencies
- Incomplete workflows

### 🔍 **DEBUGGING TIPS**:
1. **Check conversation state** after each step
2. **Review AI assistant responses** for correct action classification
3. **Verify extracted parameters** match expected format
4. **Monitor SMS delivery** (check Twilio logs)
5. **Check database consistency** after each flow
6. **Verify help usage logging** with proper categorization
7. **Test help requests during different workflow states**
8. **Validate workflow completion** before moving to next test

---

## 📋 MANDATORY TEST DOCUMENTATION

### **FOR EACH TEST**:
- **Test Name**: [Workflow Name]
- **Start Time**: [Timestamp]
- **End Time**: [Timestamp]
- **Steps Completed**: [X/Y]
- **Result**: ✅ PASS / ❌ FAIL
- **Failure Reason**: [If failed, specific step and reason]
- **Database State**: [Clean/Corrupted]
- **SMS Status**: [Sent/Failed]

### **OVERALL TEST RESULTS**:
- **Total Tests**: [Number]
- **Passed**: [Number]
- **Failed**: [Number]
- **Success Rate**: [Percentage]
- **Critical Failures**: [List any critical workflow failures]

---

## 🚨 CRITICAL NOTES

- **NEVER skip steps** in any workflow
- **ALWAYS verify each step** before proceeding
- **RESET state** between different test flows
- **DOCUMENT all failures** with specific details
- **STOP testing** if critical workflows fail
- **VERIFY database integrity** after each test
- **CHECK SMS delivery** for all invitation flows
- **VALIDATE conversation state** management
- **TEST HELP system** in various contexts
- **ENSURE all workflows complete** successfully

**REMEMBER**: If ANY workflow doesn't complete ALL steps → **ENTIRE TEST SUITE FAILS**
