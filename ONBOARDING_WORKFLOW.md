# Onboarding Workflow - 9 Steps (Implemented)

## Overview
Complete onboarding flow from crew creation to event creation and invitation sending. This workflow has been fully implemented and tested.

## Step-by-Step Flow

### Step 1: Crew Creation
- **User Input**: "My crew name is [name]" or "Create a crew name [name]"
- **Action**: `ONBOARDING_START` → `ONBOARDING_CONTINUE` (substep: 1)
- **Database**: Create crew record in `crews` table
- **Conversation State**: 
  - `current_state`: `onboarding_step_1`
  - `onboarding_step`: 1
  - `waiting_for`: `onboarding_crew_name`
- **SMS Response**: "Created [crew_name]! What city/timezone are you in? (helps with scheduling)"
- **Next Step**: Step 2

### Step 2: Location Setup
- **User Input**: "I am in [city]" or location information
- **Action**: `ONBOARDING_CONTINUE` (substep: 2)
- **Database**: Create user_location record in `user_location` table
- **Conversation State**:
  - `current_state`: `onboarding_step_2`
  - `onboarding_step`: 2
  - `waiting_for`: `onboarding_location`
- **SMS Response**: "Great! Now add crew members by texting contact info: (eg. tom +14155554321)"
- **Next Step**: Step 3

### Step 3: Add Crew Members
- **User Input**: "Andy +123123123123, Jack +32323232323" or contact info
- **Action**: `ONBOARDING_CONTINUE` (substep: 3)
- **Database**: Create contacts and crew_members records
- **Conversation State**:
  - `current_state`: `onboarding_step_3`
  - `onboarding_step`: 3
  - `waiting_for`: `onboarding_crew_members`
- **SMS Response**: "Perfect! Added [member_names] to '[crew_name]'. What's the event name?"
- **Next Step**: Step 4

### Step 4: Event Name
- **User Input**: "[Event Name]" (e.g., "Team Meeting")
- **Action**: `ONBOARDING_CONTINUE` (substep: 4)
- **Database**: Store event name in extracted_data
- **Conversation State**:
  - `current_state`: `onboarding_step_4`
  - `onboarding_step`: 4
  - `waiting_for`: `onboarding_event_name`
- **SMS Response**: "What's the location for [Event Name]?"
- **Next Step**: Step 5

### Step 5: Event Location
- **User Input**: "[Location]" (e.g., "Conference Room A")
- **Action**: `ONBOARDING_CONTINUE` (substep: 5)
- **Database**: Store event location in extracted_data
- **Conversation State**:
  - `current_state`: `onboarding_step_5`
  - `onboarding_step`: 5
  - `waiting_for`: `onboarding_event_location`
- **SMS Response**: "What date, start time, and end time? (eg. Fri 12/20 6pm-8pm, end time optional)"
- **Next Step**: Step 6

### Step 6: Event Date/Time
- **User Input**: "[Date/Time]" (e.g., "12/20 6pm-8pm")
- **Action**: `ONBOARDING_CONTINUE` (substep: 6)
- **Database**: Store event date/time in extracted_data
- **Conversation State**:
  - `current_state`: `onboarding_step_6`
  - `onboarding_step`: 6
  - `waiting_for`: `onboarding_event_date_time`
- **SMS Response**: "Any notes for the event? (optional)"
- **Next Step**: Step 7

### Step 7: Event Notes (Optional)
- **User Input**: "[Notes]" or "skip" or "no notes"
- **Action**: `ONBOARDING_CONTINUE` (substep: 7)
- **Database**: Store event notes in extracted_data
- **Conversation State**:
  - `current_state`: `onboarding_step_7`
  - `onboarding_step`: 7
  - `waiting_for`: `onboarding_event_notes`
- **SMS Response**: "Confirm: [Event Name] at [Location], [Date/Time]. [Notes if any]. Send invites to [Crew Name]?"
- **Next Step**: Step 8

### Step 8: Confirmation & Event Creation
- **User Input**: "yes" or "confirm" or "send invites"
- **Action**: `ONBOARDING_CONTINUE` (substep: 8)
- **Database**: 
  - Create event record in `events` table
  - Increment `events_created_count` in `profiles` table
  - Update conversation state to completed
- **Conversation State**:
  - `current_state`: `onboarding_completed`
  - `onboarding_step`: 9
  - `waiting_for`: null
- **SMS Response**: "[X] invites sent to [Crew Name]! Text 'RSVPs' to see responses, 'invite more' to add people, or text me anything to organize more events!"
- **Next Step**: Onboarding Complete

### Step 9: Onboarding Complete
- **Action**: `ONBOARDING_COMPLETED`
- **Database**: Onboarding marked as complete
- **Conversation State**:
  - `current_state`: `onboarding_completed`
  - `onboarding_step`: 9
  - `waiting_for`: null
- **SMS Response**: "Welcome to Funlet! Your onboarding is complete. You can now create and manage events with your crew."
- **Next Step**: Normal operation

## Key Points

1. **Thread Preservation**: During onboarding, the OpenAI thread and conversation state are NOT cleared/expired
2. **Phone Number Lookup**: Must handle all variations (8777804236, +18777804236, 18777804236)
3. **Extracted Data**: Stored as array of objects with `extracted_data` and `executed_data`
4. **Error Handling**: Each step should handle errors gracefully and provide fallback responses
5. **State Transitions**: Each step must update `current_state`, `onboarding_step`, and `waiting_for` correctly

## Current Issues to Fix

1. **Phone Number Lookup**: System not finding existing users due to phone number format mismatch
2. **Conversation State Reset**: State being reset to step 1 instead of maintaining current step
3. **Step 4-10 Implementation**: Event creation steps may not be fully implemented
4. **Thread Management**: Ensure threads don't expire during onboarding
