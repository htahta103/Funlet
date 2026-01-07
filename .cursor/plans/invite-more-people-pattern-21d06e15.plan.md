---
name: Implement SYNC_UP with Pattern Matching
overview: ""
todos: []
---

# Implement SYNC_UP with Pattern Matching

## Overview

Implement SYNC_UP action following the same pattern matching approach as SEND_INVITATIONS, with an additional step for time options collection.

## Implementation Steps

### 1. Add SYNC_UP Pattern Matching Function

**File**: `supabase/functions/funlet-sms-handler-v2/index.ts`Add new pattern matching function after `checkInviteMorePeoplePattern`:

```typescript
// Check for SYNC_UP patterns
function checkSyncUpPattern(message: string): { isMatch: boolean } {
  const normalizedMessage = message.toLowerCase().trim();
  
  const syncUpPatterns = [
    /^sync\s*up$/,
    /^sync$/,
    /^find\s+time$/,
    /^schedule\s+time$/,
    /^coordinate$/,
    /^when\s+can\s+we$/,
    /^find\s+time\s+for/,
    /^sync\s+up\s+(.+)$/, // "sync up [crew name]"
  ];
  
  for (const pattern of syncUpPatterns) {
    if (normalizedMessage.match(pattern)) {
      return { isMatch: true };
    }
  }
  
  return { isMatch: false };
}
```



### 2. Add SYNC_UP to Pattern Matching Check

**File**: `supabase/functions/funlet-sms-handler-v2/index.ts`In `checkPatternMatches` function (around line 520), add SYNC_UP check:

```typescript
// Check SYNC_UP patterns
const syncUpResult = checkSyncUpPattern(message);
if (syncUpResult.isMatch) {
  return {
    action: 'SYNC_UP',
    extractedData: {}
  };
}
```



### 3. Add Sync Up Details Input Pattern

Add pattern to detect when user provides sync up details in predefined format:

```typescript
// Check for SYNC_UP_DETAILS_INPUT patterns
function checkSyncUpDetailsInputPattern(message: string): { isMatch: boolean, extractedData: any } {
  // Match messages that look like sync up details with multiple indicators
  const hasLocation = /\b(at|@|in|near|location)\b/i.test(message);
  const hasMultipleTimes = (message.match(/\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)/gi) || []).length >= 2;
  const hasEventName = message.length > 20;
  const hasDates = /\b(tomorrow|today|friday|saturday|sunday|monday|tuesday|wednesday|thursday|\d{1,2}\/\d{1,2})\b/i.test(message);
  
  const indicatorCount = [hasLocation, hasMultipleTimes, hasEventName, hasDates].filter(Boolean).length;
  
  if (indicatorCount >= 2) {
    return {
      isMatch: true,
      extractedData: {
        sync_up_details: message.trim()
      }
    };
  }
  
  return { isMatch: false, extractedData: {} };
}
```

Add to `checkPatternMatches`:

```typescript
// Check for SYNC_UP_DETAILS_INPUT patterns (when waiting for sync up details)
if (currentState?.waiting_for === 'sync_up_details_input') {
  const syncUpDetailsResult = checkSyncUpDetailsInputPattern(message);
  if (syncUpDetailsResult.isMatch) {
    return {
      action: 'SYNC_UP_DETAILS_INPUT',
      extractedData: syncUpDetailsResult.extractedData
    };
  }
}
```



### 4. Add Time Options Input Pattern

Add pattern for detecting time options input:

```typescript
// Check for SYNC_UP_TIME_OPTIONS patterns
if (currentState?.waiting_for === 'sync_up_time_options') {
  // User is providing time options - any message is accepted here
  // We'll use AI (Tier 3) to parse the time options into structured format
  return {
    action: 'SYNC_UP_TIME_OPTIONS_INPUT',
    extractedData: { time_options_text: message.trim() }
  };
}
```



### 5. Add Sync Up Confirmation Pattern

Add pattern for yes/no confirmation:

```typescript
// Check for SYNC_UP_CONFIRMATION patterns (when waiting for sync up confirmation)
if (currentState?.waiting_for === 'sync_up_confirmation') {
  const normalizedMessage = message.toLowerCase().trim();
  if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm') {
    return {
      action: 'SYNC_UP_CONFIRMATION_YES',
      extractedData: {}
    };
  } else if (normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
    return {
      action: 'SYNC_UP_CONFIRMATION_NO',
      extractedData: {}
    };
  }
}
```



### 6. Implement SYNC_UP Handler (Initial Trigger)

**File**: `supabase/functions/funlet-sms-handler-v2/index.ts`Add in pattern matching section (around line 3426):

```typescript
} else if (action === 'SYNC_UP') {
  console.log('SYNC_UP detected via pattern matching, bypassing AI');
  
  try {
    // Get user's crews
    const { data: userCrews, error: crewsError } = await supabase
      .from('crews')
      .select('id, name')
      .eq('creator_id', userId)
      .order('name');
    
    if (crewsError) {
      console.error('Error fetching crews:', crewsError);
      responseContent = 'Failed to fetch crews. Please try again.';
      shouldSendSMS = true;
    } else if (!userCrews || userCrews.length === 0) {
      responseContent = 'No crews found. Type \'Create Crew\' to create your first crew.';
      shouldSendSMS = true;
    } else if (userCrews.length === 1) {
      // Single crew - ask for sync up details immediately
      const crew = userCrews[0];
      
      responseContent = `Add sync up details for ${crew.name}: Event name, location, 2-3 time options (date, start time, end time optional).\n\nExample: "Pickleball, Piper Park, Thu 12/19 6-8pm, Sat 12/21 10am-12pm"`;
      shouldSendSMS = true;
      
      // Update conversation state
      await supabase
        .from('conversation_state')
        .update({
          waiting_for: 'sync_up_details_input',
          current_state: 'sync_up_step_1',
          extracted_data: [
            {
              action: 'SYNC_UP',
              substep: 1,
              crew_id: crew.id,
              crew_name: crew.name,
              timestamp: new Date().toISOString()
            }
          ]
        })
        .eq('user_id', userId);
    } else {
      // Multiple crews - show list
      let crewList = 'Which crew should we coordinate with?\n';
      userCrews.forEach((crew, index) => {
        crewList += `${index + 1}. ${crew.name}\n`;
      });
      crewList += 'Reply with the crew number or \'Create Crew\' to make a new one.';
      
      responseContent = crewList;
      shouldSendSMS = true;
      
      // Update conversation state
      await supabase
        .from('conversation_state')
        .update({
          waiting_for: 'crew_selection_for_sync_up',
          current_state: 'sync_up_crew_selection',
          extracted_data: [
            {
              action: 'SYNC_UP',
              crew_list: userCrews,
              timestamp: new Date().toISOString()
            }
          ]
        })
        .eq('user_id', userId);
    }
    
    await sendSMS(phone_number, responseContent);
    
    return new Response(JSON.stringify({
      success: true,
      action: 'SYNC_UP',
      response: responseContent,
      optimization: 'pattern_matching'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in SYNC_UP pattern matching:', error);
    responseContent = 'Failed to start sync up. Please try again.';
    shouldSendSMS = true;
  }
}
```



### 7. Add Crew Selection for Sync Up

Add pattern for crew selection:

```typescript
// Check for numeric crew selection for SYNC_UP
if (numericMatch && currentState?.waiting_for === 'crew_selection_for_sync_up') {
  const crewIndex = parseInt(numericMatch[1]) - 1;
  return {
    action: 'CREW_SELECTION_SYNC_UP',
    extractedData: { crew_index: crewIndex }
  };
}
```

Implement handler:

```typescript
} else if (action === 'CREW_SELECTION_SYNC_UP') {
  console.log('CREW_SELECTION_SYNC_UP detected via pattern matching');
  
  try {
    const crewIndex = extractedData.crew_index;
    
    // Get crew list from conversation state
    let crewList = null;
    if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
      for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
        const item = conversationState.extracted_data[i];
        if (item.crew_list) {
          crewList = item.crew_list;
          break;
        }
      }
    }
    
    if (!crewList || crewIndex < 0 || crewIndex >= crewList.length) {
      responseContent = 'Invalid crew selection. Please try again.';
      shouldSendSMS = true;
    } else {
      const selectedCrew = crewList[crewIndex];
      
      responseContent = `Add sync up details for ${selectedCrew.name}: Event name, location, 2-3 time options (date, start time, end time optional).\n\nExample: "Pickleball, Piper Park, Thu 12/19 6-8pm, Sat 12/21 10am-12pm"`;
      shouldSendSMS = true;
      
      // Update conversation state
      await supabase
        .from('conversation_state')
        .update({
          waiting_for: 'sync_up_details_input',
          current_state: 'sync_up_step_1',
          extracted_data: [
            ...(conversationState?.extracted_data || []),
            {
              action: 'CREW_SELECTED_FOR_SYNC_UP',
              crew_id: selectedCrew.id,
              crew_name: selectedCrew.name,
              timestamp: new Date().toISOString()
            }
          ]
        })
        .eq('user_id', userId);
    }
    
    await sendSMS(phone_number, responseContent);
    
    return new Response(JSON.stringify({
      success: true,
      action: 'CREW_SELECTION_SYNC_UP',
      response: responseContent,
      optimization: 'pattern_matching'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in CREW_SELECTION_SYNC_UP:', error);
  }
}
```



### 8. Implement Sync Up Details Input Handler

This handler receives the full sync up details and uses AI (Tier 3) to parse event name, location, and time options:

```typescript
} else if (action === 'SYNC_UP_DETAILS_INPUT') {
  console.log('SYNC_UP_DETAILS_INPUT detected via pattern matching');
  
  try {
    const syncUpDetails = extractedData.sync_up_details;
    
    // Find crew info from extracted_data
    let crewId = null;
    let crewName = null;
    
    if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
      for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
        const item = conversationStateData.extracted_data[i];
        if (item.action === 'SYNC_UP' && item.crew_id) {
          crewId = item.crew_id;
          crewName = item.crew_name;
          break;
        }
        if (item.action === 'CREW_SELECTED_FOR_SYNC_UP' && item.crew_id) {
          crewId = item.crew_id;
          crewName = item.crew_name;
          break;
        }
      }
    }
    
    if (!crewId) {
      responseContent = 'No crew found. Please start over by saying "sync up".';
      shouldSendSMS = true;
    } else {
      // Use AI (Tier 3) to parse sync up details
      // Call OpenAI to extract: event_name, location, time_options (array)
      // This is complex extraction that requires AI
      
      responseContent = `Parsing sync up details for ${crewName}. Please wait...`;
      shouldSendSMS = true;
      
      // Update conversation state to indicate we're parsing
      await supabase
        .from('conversation_state')
        .update({
          waiting_for: 'sync_up_time_options',
          current_state: 'sync_up_step_2',
          extracted_data: [
            ...(conversationStateData?.extracted_data || []),
            {
              action: 'SYNC_UP_DETAILS_INPUT',
              crew_id: crewId,
              crew_name: crewName,
              sync_up_details: syncUpDetails,
              timestamp: new Date().toISOString()
            }
          ]
        })
        .eq('user_id', userId);
      
      // TODO: Call AI to parse details, then proceed to confirmation
      // For now, send to AI processing
    }
  } catch (error) {
    console.error('Error in SYNC_UP_DETAILS_INPUT:', error);
  }
}
```



### 9. Keep AI Processing for Complex Parsing

For SYNC_UP_DETAILS_INPUT and time options parsing, we'll use the existing AI processing (Tier 3) since this requires:

- Extracting event name from natural language
- Extracting location from natural language  
- Parsing 2-3 time options with dates, times, and optional end times
- Converting time options to ISO timestamps for database storage

The AI processing section (around line 7648) already handles `SYNC_UP_OPTIONS_COLLECTED` - we'll enhance it to also handle the initial details parsing.

### 10. Update allowPatternMatching

Add SYNC_UP actions to the allowed pattern matching during onboarding:

```typescript
const allowPatternMatching = !isInOnboarding || 
  (isInOnboarding && patternResult.action && 
   (patternResult.action === 'CREATE_CREW' || 
    patternResult.action === 'ONBOARDING_CONTINUE' || 
    patternResult.action === 'ADD_CREW_MEMBERS' || 
    patternResult.action === 'SEND_INVITATIONS' ||
    patternResult.action === 'SYNC_UP'));
```



## Summary

The implementation creates a hybrid approach:

- **Pattern matching (Tier 1)**: Triggers, crew selection, confirmations
- **AI processing (Tier 3)**: Complex parsing of event details and time options