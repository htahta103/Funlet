# Auto Sync Workflow Chart

## Overview

This document shows the complete Auto Sync workflow as implemented, including both calendar-connected and no-calendar paths. **Note**: The actual implementation may differ from the specification document.

## Key Features

- **Option Selection for Invites**: NEW FEATURE - Users can now select a specific time option from a numbered list when sending invites
- **Event Location Collection**: Event location is now collected during workflow (can be skipped)
- **Calendar vs No-Calendar**: Different time collection methods based on calendar connection status

## Workflow Diagram

```mermaid
flowchart TD
    Start([User: "auto sync"]) --> SelectCrew{Select Crew}
    SelectCrew --> |Reply with number| EventName[Prompt: Event name?]
    EventName --> |Provide event name| EventLocation[Prompt: Event location?<br/>or reply 'skip']
    EventLocation --> |Provide location or skip| CheckCalendar{Calendar Connected?}
    
    CheckCalendar --> |Yes| CalendarMode[Prompt: Time window?<br/>e.g. 'next week evenings']
    CheckCalendar --> |No| NoCalendarMode[Prompt: Time options?<br/>Send 1-3 options]
    
    CalendarMode --> |Provide time window| CalendarProposal[Show calendar proposal<br/>with week view]
    CalendarProposal --> |Reply: yes| SaveOption1[Save option]
    SaveOption1 --> AddMore1{Add another option?}
    AddMore1 --> |add another option| CalendarProposal
    AddMore1 --> |send| ResponseGoal[Prompt: Response goal?<br/>1=Everyone, 2=Critical mass]
    
    NoCalendarMode --> |Provide time options| ParseTimes[Parse time options]
    ParseTimes --> |Valid| SaveOptions[Save 1-3 options]
    ParseTimes --> |Invalid| NoCalendarMode
    SaveOptions --> ResponseGoal
    
    ResponseGoal --> |Set goal 1 or 2| ConfirmSend[Prompt: Ready to start?<br/>Reply send or exit]
    ConfirmSend --> |send| Initialize[Create Auto Sync record<br/>Send to crew members]
    Initialize --> Running[Status: Running]
    
    Running --> CheckStatus[User: "auto sync check"]
    CheckStatus --> ShowList[Show Auto Sync list<br/>with status]
    ShowList --> |Select number| ManageOptions[Reply 1 to send invites<br/>2 to stop, or exit]
    
    ManageOptions --> |1 - Send invites| ShowOptionsList[Show numbered list<br/>of time options<br/>NEW FEATURE]
    ShowOptionsList --> |Select option number| CreateEvent[Create event with<br/>selected time]
    CreateEvent --> SendInvites[Send SMS invitations]
    SendInvites --> CreateCalendarEvent{Calendar<br/>Connected?}
    CreateCalendarEvent --> |Yes| GoogleCalendar[Create Google Calendar event<br/>Save event link]
    CreateCalendarEvent --> |No| SkipCalendar[Skip calendar event]
    GoogleCalendar --> Complete[Status: Completed]
    SkipCalendar --> Complete
    
    ManageOptions --> |2 - Stop| StopSync[Status: Stopped]
    ManageOptions --> |exit| End([End])
    Complete --> End
    StopSync --> End
    
    style ShowOptionsList fill:#e1f5ff,stroke:#01579b,stroke-width:3px
    style EventLocation fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style CreateEvent fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style Complete fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## Detailed Step-by-Step Flow

### Phase 1: Setup

1. **User initiates**: "auto sync"
   - System shows crew list
   - User selects crew by number

2. **Event name collection**
   - System prompts: "Event name?"
   - User provides event name

3. **Event location collection** (NEW)
   - System prompts: "Event location? (or reply 'skip' to leave blank)"
   - User provides location (minimum 2 characters) or replies "skip"/"done"
   - If invalid (too short): System shows error and re-prompts
   - Location is stored in `extracted_data` and saved to `auto_syncs.event_location`

4. **Time collection** (diverges based on calendar connection)

   **Calendar Mode** (calendar connected):
   - System prompts: "What time window works for you? (e.g., 'next week evenings' or 'weekend mornings')"
   - User provides natural language time window
   - System queries Google Calendar for availability
   - System shows proposal with week view
   - User can: accept (yes), suggest change, or request next option
   - User can add multiple options before sending

   **No-Calendar Mode** (no calendar):
   - System prompts: "What times work? Send 1-3 options (e.g., 'Thu 12/19, 6-8pm, Sat 12/21, 10am-12pm')"
   - User provides 1-3 time options in one message
   - System parses and validates times

5. **Response goal**
   - System prompts: "What's the response goal? Reply 1 for Everyone, 2 for Critical mass."
   - User selects 1 or 2

6. **Confirmation**
   - System prompts: "Ready to start Auto Sync? Reply send or exit."
   - User confirms: "send"

### Phase 2: Execution

7. **Auto Sync initialization**
   - System creates `auto_syncs` record (status: 'running')
   - System creates `auto_sync_options` records (1-3 options)
   - System sends initial messages to crew members
   - Response: "Auto Sync sent to X people."

### Phase 3: Management

8. **Check status**
   - User: "auto sync check"
   - System shows list of Auto Syncs with status
   - User selects Auto Sync by number

9. **Manage Auto Sync**
   - System shows: "Reply 1 to send invites, 2 to stop, or exit."

10. **Send invites** (NEW FEATURE - Option Selection)
   - User: "1"
   - System shows numbered list of time options:
     ```
     Send invites for which time?
     1. Tue 1/13, 6-8pm
     2. Tue 1/13, 6-8pm
     
     Reply with the option number or 'exit'.
     ```
   - User selects option by number (e.g., "1")

11. **Create event and send invites**
    - System creates `events` record with selected time
    - System sends SMS invitations via `send-invitations` Edge Function
    - If calendar connected: System creates Google Calendar event and saves link
    - System marks Auto Sync as completed
    - Response: "You're invited to [Event] on [Date] at [Time]. Calendar invite sent."

## State Transitions

```
Not Started → Running → Completed
                ↓
             Stopped
```

- **Running**: Auto Sync is active, waiting for responses
- **Completed**: Event created and invites sent
- **Stopped**: User manually stopped the Auto Sync

## Database Fields

### `auto_syncs` table
- `event_name`: Collected during setup (step 2)
- `event_location`: Collected during setup (step 3) - can be NULL if skipped
- `status`: 'running' → 'completed' or 'stopped'
- `calendar_connected`: Boolean indicating if Google Calendar is connected

### `events` table
- `google_calendar_event_link`: Saved when calendar event is created (calendar-connected hosts only)

## Differences from Specification Document

1. **Option Selection**: NEW FEATURE - Users select specific option when sending invites (not in original spec)
2. **Time Collection**: Calendar mode uses natural language, no-calendar mode requires specific format

## Testing Notes

- Tested with host +11231232323 (calendar connected)
- Tested with host +187778042361 (no calendar)
- Event location collection tested:
  - Valid location: Accepted and stored
  - Skip option: Works correctly, location set to NULL
  - Invalid location (too short): Shows error message and re-prompts
- Time parsing in no-calendar mode may require specific date format
- Calendar proposals may show same time if limited availability

## Future Improvements

1. Improve time parsing for no-calendar mode
2. Add validation for duplicate time options
3. Add ability to edit Auto Sync after creation
4. Add ability to edit event location after Auto Sync is created

