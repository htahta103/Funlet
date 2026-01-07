import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Helper function to send SMS messages
async function sendSMS(
  phoneNumber: string, 
  message: string, 
  shouldSend: boolean = true,
  owner_phone_number: string | null = null
) {
  try {
    // Create Supabase client (needed for both paths)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Find user by phone number (needed for both paths)
    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const phoneVariations = [normalizedPhone];
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      phoneVariations.push(normalizedPhone.substring(1));
    }
    if (normalizedPhone.length === 10) {
      phoneVariations.push('1' + normalizedPhone);
    }
    const plusVariations = phoneVariations.map(phone => '+' + phone);
    phoneVariations.push(...plusVariations);
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, sms_sent_count')
      .in('phone_number', phoneVariations)
      .single();
    
    // Check SMS limit for the owner (person who initiated the action)
    // TEMPORARILY DISABLED FOR TESTING
    if (false && shouldSend && owner_phone_number) {
      const checkPhoneNumber = owner_phone_number; // Always check owner's limit
      
      try {
        const smsLimitResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-usage-limits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            phone_number: checkPhoneNumber,
            action_type: 'sms_sent'
          })
        });
        
        const smsLimitData = await smsLimitResponse.json();
        
        if (!smsLimitData.allowed) {
          console.log('❌ SMS limit exceeded for owner:', checkPhoneNumber);
          // Don't send SMS, return error
          return { 
            success: false, 
            error: 'SMS_LIMIT_EXCEEDED',
            limit_data: smsLimitData 
          };
        }
      } catch (error) {
        console.error('⚠️ Error checking SMS limits:', error);
        // Continue sending on error (fail open)
      }
    }

    // Save to database when NOT sending (send_sms = false)
    if (!shouldSend) {
      if (profile?.id) {
        await supabase
          .from('message_thread')
          .insert({
            user_id: profile.id,
            phone_number: phoneNumber,
            message: message,
            role: 'assistant',
            sent: false,
            sent_at: null
          });
        console.log('SMS skipped (send_sms=false), saved to message_thread');
      }
      return { success: true, skipped: true };
    }

    // When shouldSend=true, send via Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = '+18887787794';

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Twilio credentials not configured');
      return { success: false, error: 'Twilio credentials not configured' };
    }

    const Twilio = (await import('npm:twilio@4.22.0')).default;
    const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    console.log('Sending SMS to:', phoneNumber);
    console.log('SMS message:', message);

    const smsResult = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: phoneNumber,
      shortenUrls: true
    });

    console.log('SMS sent successfully:', smsResult.sid);
    
    // After successful Twilio message send, increment SMS count for owner
    if (owner_phone_number) {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/increment-usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: owner_phone_number,
          action_type: 'sms_sent'
        })
      }).catch(error => console.error('Error incrementing SMS usage for owner:', error));
    }
    
    return { success: true, sid: smsResult.sid };
    
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return { success: false, error: error.message };
  }
}

// PATTERN MATCHING FUNCTIONS - Tier 1 Optimization (bypass AI for common commands)

// Check for CREATE_CREW patterns
function checkCreateCrewPattern(message: string): { isMatch: boolean, crewName: string | null } {
  const normalizedMessage = message.toLowerCase().trim();
  const originalMessage = message.trim();
  
  const createCrewPatterns = [
    // Direct commands
    /^create\s+crew$/,
    /^create\s+crew\s+(.+)$/,
    /^new\s+crew$/,
    /^new\s+crew\s+(.+)$/,
    /^make\s+crew$/,
    /^make\s+crew\s+(.+)$/,
    
    // Group variations
    /^create\s+group$/,
    /^create\s+group\s+(.+)$/,
    /^new\s+group$/,
    /^new\s+group\s+(.+)$/,
    /^make\s+group$/,
    /^make\s+group\s+(.+)$/,
    /^start\s+group$/,
    /^start\s+group\s+(.+)$/,
    /^start\s+a\s+group$/,
    /^start\s+a\s+group\s+(.+)$/,
    
    // Natural language expressions
    /^i\s+want\s+to\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)$/,
    /^i\s+want\s+to\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)\s+(.+)$/,
    /^i\s+need\s+to\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)$/,
    /^i\s+need\s+to\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)\s+(.+)$/,
    /^let\s+me\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)$/,
    /^let\s+me\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)\s+(.+)$/,
    /^can\s+i\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)$/,
    /^can\s+i\s+create\s+(?:a\s+)?(?:new\s+)?(?:crew|group)\s+(.+)$/,
    
    // Crew naming patterns
    /^crew\s+name\s+is\s+(.+)$/,
    /^my\s+crew\s+is\s+(.+)$/,
    /^crew\s+is\s+(.+)$/,
    /^group\s+name\s+is\s+(.+)$/,
    /^my\s+group\s+is\s+(.+)$/,
    /^group\s+is\s+(.+)$/
  ];
  
  for (const pattern of createCrewPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      // Extract crew name from original message to preserve casing
      const originalMatch = originalMessage.match(new RegExp(pattern.source, 'i'));
      return {
        isMatch: true,
        crewName: originalMatch && originalMatch[1] ? originalMatch[1].trim() : null
      };
    }
  }
  
  return { isMatch: false, crewName: null };
}

// Check for CHECK_RSVPS patterns
function checkCheckRsvpsPattern(message: string): { isMatch: boolean, eventName?: string } {
  const normalizedMessage = message.toLowerCase().trim();
  
  const checkRsvpsPatterns = [
    /^check\s+rsvps?\s+for\s+(.+)$/,
    /^check\s+rsvps?\s+(.+)$/,
    /^check\s+responses\s+for\s+(.+)$/,
    /^check\s+responses\s+(.+)$/,
    /^rsvps?\s+for\s+(.+)$/,
    /^rsvps?\s+(.+)$/,
    /^who'?s\s+coming\s+to\s+(.+)$/,
    /^who'?s\s+coming\s+(.+)$/,
    /^who\s+is\s+coming\s+to\s+(.+)$/,
    /^who\s+is\s+coming\s+(.+)$/,
    /^show\s+responses\s+for\s+(.+)$/,
    /^show\s+responses\s+(.+)$/,
    /^rsvp\s+status\s+for\s+(.+)$/,
    /^rsvp\s+status\s+(.+)$/,
    /^who\s+responded\s+to\s+(.+)$/,
    /^who\s+responded\s+(.+)$/,
    /^attendance\s+for\s+(.+)$/,
    /^attendance\s+(.+)$/,
    /^headcount\s+for\s+(.+)$/,
    /^headcount\s+(.+)$/
  ];
  
  // Check for patterns with event names
  for (const pattern of checkRsvpsPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      return {
        isMatch: true,
        eventName: match[1] ? match[1].trim() : null
      };
    }
  }
  
  // Check for simple patterns without event names
  const simplePatterns = [
    /^check\s+rsvps?$/,
    /^check\s+responses$/,
    /^rsvps?$/,
    /^who'?s\s+coming$/,
    /^who\s+is\s+coming$/,
    /^show\s+responses$/,
    /^rsvp\s+status$/,
    /^who\s+responded$/,
    /^attendance$/,
    /^headcount$/
  ];
  
  for (const pattern of simplePatterns) {
    if (pattern.test(normalizedMessage)) {
      return {
        isMatch: true
      };
    }
  }
  
  return { isMatch: false };
}

// Check for MANAGE_EVENT patterns
function checkManageEventPattern(message: string): { isMatch: boolean, eventName?: string } {
  const normalizedMessage = message.toLowerCase().trim();
  const originalMessage = message.trim();
  
  // First check if it's "manage crew" - if so, don't match (let CHECK_CREW_MEMBERS handle it)
  if (normalizedMessage === 'manage crew' || normalizedMessage.startsWith('manage crew ')) {
    return { isMatch: false };
  }
  
  // Check if it's "manage contact" - if so, don't match (let EDIT_CONTACT handle it)
  if (normalizedMessage === 'manage contact') {
    return { isMatch: false };
  }
  
  const manageEventPatterns = [
    /^manage\s+event\s+(.+)$/,      // "manage event [name]" - explicit event pattern
    /^manage\s+(.+)$/,               // "manage [name]" - routes to event management (crew already excluded above)
    /^check\s+event\s+(.+)$/,
    /^edit\s+event\s+(.+)$/,
    /^view\s+event\s+(.+)$/
  ];
  
  // Check for patterns with event names
  for (let i = 0; i < manageEventPatterns.length; i++) {
    const pattern = manageEventPatterns[i];
    const match = normalizedMessage.match(pattern);
    if (match) {
      // Extract event name from original message to preserve case
      // Use case-insensitive pattern on original message
      const caseInsensitivePattern = new RegExp(pattern.source, 'i');
      const originalMatch = originalMessage.match(caseInsensitivePattern);
      const eventName = originalMatch ? originalMatch[1].trim() : match[1].trim();
      return { isMatch: true, eventName: eventName };
    }
  }
  
  // Check for simple patterns without event names
  const simplePatterns = [
    /^manage\s+event$/,
    /^check\s+event$/,
    /^my\s+events$/,
    /^view\s+events$/,
    /^events$/
  ];
  
  for (const pattern of simplePatterns) {
    if (pattern.test(normalizedMessage)) {
      return { isMatch: true };
    }
  }
  
  return { isMatch: false };
}

// Check for SEND_MESSAGE patterns
function checkSendMessagePattern(message: string): { isMatch: boolean } {
  const normalizedMessage = message.toLowerCase().trim();
  const patterns = [
    /^send\s+message$/,
    /^message$/,
    /^message\s+the\s+crew$/,
    /^message\s+crew$/,
    /^broadcast$/,
    /^notify$/,
    /^send\s+a?\s*reminder$/,
    /^text\s+(crew|everyone)$/,
    /^text\s+the\s+(crew|everyone)$/
  ];
  for (const pattern of patterns) {
    if (normalizedMessage.match(pattern)) return { isMatch: true };
  }
  return { isMatch: false };
}


// Check for CHECK_CREW_MEMBERS patterns
async function checkCheckCrewMembersPattern(message: string, supabase?: any, userId?: string): Promise<{ isMatch: boolean, crewName: string | null }> {
  const normalizedMessage = message.toLowerCase().trim();
  
  const checkCrewMembersPatterns = [
    // "Manage Crew" patterns - explicit only
    /^manage\s+crew\s+(.+)$/,           // "manage crew Tennis Squad"
    /^manage\s+crew$/,                  // "manage crew"
    
    // NEW: Natural language variations
    /^show\s+my\s+crew$/,
    /^see\s+my\s+crew$/,
    /^see\s+members?$/,
    
    // Existing: "check crew [crew name]" patterns (must come before generic patterns)
    /^check\s+crew\s+(.+)$/,           // "check crew Tennis Squad"
    /^check\s+my\s+crew\s+(.+)$/,      // "check my crew Tennis Squad"
    /^see\s+crew\s+(.+)$/,             // "see crew Tennis Squad"
    /^see\s+my\s+crew\s+(.+)$/,        // "see my crew Tennis Squad"
    /^show\s+crew\s+(.+)$/,            // "show crew Tennis Squad"
    /^show\s+my\s+crew\s+(.+)$/,       // "show my crew Tennis Squad"
    
    // NEW: "crew check [crew name]" patterns (reversed order)
    /^crew\s+check\s+(.+)$/,           // "crew check Tennis Squad"
    /^my\s+crew\s+check\s+(.+)$/,       // "my crew check Tennis Squad"
    
    // Existing patterns with crew name capture
    /^who'?s\s+in\s+(.+)$/,  // Captures crew name like "Tennis Squad"
    /^who\s+is\s+in\s+(.+)$/,  // Alternative without apostrophe
    
    // Existing patterns (without crew name capture)
    /^check\s+crew\s+members?$/,
    /^crew\s+members?$/,
    /^show\s+crew\s+members?$/,
    /^list\s+crew\s+members?$/,
    /^who\s+is\s+in\s+my\s+crew$/,
    /^crew\s+list$/,
    /^members?$/,
    /^show\s+members?$/,
    /^list\s+members?$/,
    
    // NEW: Simpler "check crew" without "members"
    /^check\s+crew$/,
    /^check\s+my\s+crew$/,
    
    // NEW: "crew check" without crew name (reversed order)
    /^crew\s+check$/,
    /^my\s+crew\s+check$/,
    
    // NEW: "see" variations
    /^see\s+my\s+crew$/,
    /^see\s+crew$/,
    /^see\s+crew\s+members?$/,
    
    // NEW: "show my crew" variations
    /^show\s+my\s+crew$/,
    /^show\s+crew$/
  ];
  
  for (const pattern of checkCrewMembersPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      // Check if pattern captures crew name (patterns with (.+) capture group)
      const hasCrewName = pattern.source.includes('(.+)');
      const crewName = hasCrewName && match[1] ? match[1].trim() : null;
      
      return { 
        isMatch: true,
        crewName: crewName
      };
    }
  }
  
              // Check for exact crew name match (standalone crew name)
              // This should be a simple word/phrase that could be a crew name
              // BUT exclude special commands like "Next", "Prev", "Done", "Create Crew", "exit", etc.
              const normalizedMessageForExclusion = message.toLowerCase().trim();
              const excludedCommands = ['next', 'n', 'prev', 'p', 'previous', 'done', 'd', 'create crew', 'exit', 'quit', 'stop', 'menu'];
              if (excludedCommands.includes(normalizedMessageForExclusion)) {
                return { isMatch: false, crewName: null };
              }
              
              const standaloneNamePattern = /^[a-zA-Z][a-zA-Z0-9\s]{1,49}$/;
              if (standaloneNamePattern.test(message.trim()) && message.trim().length >= 2) {
                // For standalone name pattern, verify crew exists in database if supabase and userId are provided
                if (supabase && userId) {
                  const crewName = message.trim();
                  const { data: crewData, error: crewError } = await supabase
                    .from('crews')
                    .select('id, name')
                    .eq('creator_id', userId)
                    .ilike('name', crewName)
                    .maybeSingle();
                  
                  if (crewError || !crewData) {
                    // Crew not found - return no match
                    return { isMatch: false, crewName: null };
                  }
                  
                  // Crew found - return match
                  return {
                    isMatch: true,
                    crewName: crewData.name
                  };
                }
                
                // If no database access, return match for backward compatibility (will be validated later)
                return {
                  isMatch: true,
                  crewName: message.trim()
                };
              }
              
              return { isMatch: false, crewName: null };
}

// Check for SEND_INVITATIONS patterns
function checkSendInvitationsPattern(message: string): { isMatch: boolean, extractedData: any } {
  const normalizedMessage = message.toLowerCase().trim();
  
  const sendInvitationsPatterns = [
    // Create event patterns
    /^create\s+event$/,
    /^create\s+event\s+for\s+(.+)$/,
    /^create\s+event\s+(.+)$/,
    
    // Send invitations patterns
    /^send\s+invitations?$/,
    /^send\s+invitations?\s+(.+)$/,
    /^send\s+invites?$/,
    /^send\s+invites?\s+(.+)$/,
    
    // Invite crew patterns
    /^invite\s+crew$/,
    /^invite\s+crew\s+(.+)$/,
    
    // Plan patterns
    /^plan\s+event$/,
    /^plan\s+event\s+(.+)$/,
    /^plan\s+something$/,
    /^plan\s+something\s+(.+)$/,
    
    // Organize patterns
    /^organize\s+event$/,
    /^organize\s+event\s+(.+)$/,
    /^organize\s+something$/,
    /^organize\s+something\s+(.+)$/
  ];
  
  for (const pattern of sendInvitationsPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      const extractedData: any = {
        event_details: match[1] ? match[1].trim() : null
      };
      
      // Check if this is a "create event for [crew_name]" or "create event [crew_name]" pattern
      if (pattern.source.includes('create\\s+event\\s+for\\s+') || pattern.source.includes('create\\s+event\\s+(.+)$')) {
        extractedData.crew_name = match[1] ? match[1].trim() : null;
      }
      
      return {
        isMatch: true,
        extractedData
      };
    }
  }
  
  return { isMatch: false, extractedData: {} };
}

// EVENT_DETAILS_INPUT pattern checking removed - now using progressive step-by-step workflow only
// This function is kept for reference but not used

// Check for INVITE_MORE_PEOPLE patterns
function checkInviteMorePeoplePattern(message: string): { isMatch: boolean, eventName?: string } {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Simple patterns without event names (check first)
  const inviteMorePeoplePatterns = [
    /^invite\s+more$/,
    /^invite\s+more\s+people$/,
    /^add\s+more\s+people$/,
    /^invite\s+additional$/,
    /^add\s+more$/,
    /^more\s+invites$/,
    /^expand\s+event$/,
    /^add\s+to\s+event$/,
    /^add\s+more\s+invites$/,
    /^send\s+more\s+invitations?$/
  ];
  
  for (const pattern of inviteMorePeoplePatterns) {
    if (normalizedMessage.match(pattern)) {
      return { isMatch: true };
    }
  }
  
  // Patterns with event names (check after simple patterns)
  const inviteMorePeopleWithEventPatterns = [
    /^invite\s+more\s+people\s+to\s+(.+)$/,
    /^invite\s+more\s+people\s+(.+)$/,
    /^invite\s+more\s+(.+)$/,
    /^add\s+more\s+people\s+to\s+(.+)$/,
    /^add\s+more\s+people\s+(.+)$/,
    /^invite\s+additional\s+(.+)$/,
    /^add\s+more\s+(.+)$/,
    /^more\s+invites\s+(.+)$/,
    /^expand\s+event\s+(.+)$/,
    /^add\s+to\s+event\s+(.+)$/,
    /^add\s+more\s+invites\s+(.+)$/,
    /^send\s+more\s+invitations?\s+(.+)$/
  ];
  
  // Check for patterns with event names
  for (const pattern of inviteMorePeopleWithEventPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      return {
        isMatch: true,
        eventName: match[1] ? match[1].trim() : null
      };
    }
  }
  
  return { isMatch: false };
}

// Check for SYNC_UP patterns
function checkSyncUpPattern(message: string): { isMatch: boolean, crewName: string | null } {
  const normalizedMessage = message.toLowerCase().trim();
  
  const syncUpPatterns = [
    /^sync\s*up$/,
    /^sync$/,
    /^find\s+time$/,
    /^schedule\s+time$/,
    /^coordinate$/,
    /^coordinate\s+schedules?$/,
    /^coordinate\s+times?$/,
    /^when\s+can\s+we$/,
    /^find\s+time\s+for/,
    /^sync\s+up\s+(.+)$/, // "sync up [crew name]"
    /^find\s+a\s+time$/,
    /^schedule\s+a\s+meeting$/,
    /^plan\s+a\s+meeting$/,
    /^set\s+up\s+a\s+meeting$/,
  ];
  
  for (const pattern of syncUpPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      // Check if pattern captures crew name (patterns with (.+) capture group)
      const hasCrewName = pattern.source.includes('(.+)');
      const crewName = hasCrewName && match[1] ? match[1].trim() : null;
      
      return {
        isMatch: true,
        crewName: crewName
      };
    }
  }
  
  return { isMatch: false, crewName: null };
}

// Check for RE_SYNC patterns
function checkReSyncPattern(message: string): { isMatch: boolean, eventName: string | null } {
  const normalizedMessage = message.toLowerCase().trim();
  
  const reSyncPatterns = [
    /^re\s*sync$/,
    /^re\s*sync\s+(.+)$/,
    /^resync$/,
    /^resync\s+(.+)$/,
    /^re-sync$/,
    /^re-sync\s+(.+)$/,
    /^send\s+more\s+options$/,
    /^new\s+times$/,
    /^more\s+options$/,
    /^add\s+more\s+times$/,
    /^additional\s+times$/,
    /^update\s+sync\s+up$/,
    /^modify\s+times$/,
    /^change\s+times$/,
    /^add\s+another\s+time$/,
    /^include\s+more\s+times$/,
    /^send\s+more\s+times$/,
    /^send\s+different\s+times$/,
    /^give\s+more\s+options$/,
    /^add\s+more\s+choices$/,
    /^expand\s+options$/,
    /^can\s+i\s+add\s+more\s+times$/,
    /^how\s+do\s+i\s+add\s+more\s+options$/,
    /^send\s+additional\s+times$/,
    /^add\s+times$/
  ];
  
  for (const pattern of reSyncPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      return {
        isMatch: true,
        eventName: match[1] ? match[1].trim() : null
      };
    }
  }
  
  return { isMatch: false, eventName: null };
}

// Check for HELP patterns
function checkHelpPattern(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  const helpPatterns = [
    /^help$/,
    /^menu$/,
    /^commands?$/,
    /^what can you do\??$/,
    /^what can i do\??$/,
    /^show commands?$/,
    /^list commands?$/,
    /^available commands?$/
  ];
  
  return helpPatterns.some(pattern => pattern.test(normalizedMessage));
}

// Check if message is a simple command that shouldn't count as AI interaction
function isSkippableMessage(message: string): boolean {
  const normalizedMsg = message.toLowerCase().trim();
  
  // Navigation commands
  const navigationCommands = ['menu', 'help', 'exit', 'quit', 'stop', 'reset'];
  if (navigationCommands.includes(normalizedMsg)) {
    return true;
  }
  
  // Numeric selections
  if (/^\d+$/.test(normalizedMsg)) {
    return true;
  }
  
  // Simple confirmations and casual responses
  const casualResponses = [
    'thanks', 'thank you', 'thx', 'ty',
    'got it', 'ok', 'okay', 'k', 'kk',
    'cool', 'awesome', 'great', 'nice', 'perfect',
    'sounds good', 'sounds great', 'will do',
    '👍', '✅', '🙏'
  ];
  
  return casualResponses.includes(normalizedMsg);
}

// _DEPRECATED: Check for SYNC_UP_DETAILS_INPUT patterns - No longer used in progressive workflow
// This function is kept for reference but not called anywhere
function checkSyncUpDetailsInputPattern_DEPRECATED(message: string): { isMatch: boolean, extractedData: any } {
  // Match messages that look like sync up details with multiple indicators
  const hasLocation = /\b(at|@|in|near|location)\b/i.test(message);
  const hasMultipleTimes = (message.match(/\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)/gi) || []).length >= 2;
  const hasEventName = message.length > 20;
  
  // Enhanced date patterns to support more formats
  const hasDates = /\b(tomorrow|today|friday|saturday|sunday|monday|tuesday|wednesday|thursday|\d{1,2}\/\d{1,2})\b/i.test(message);
  
  // Enhanced time patterns to support more formats
  const hasTimePatterns = /\b(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)|\d{1,2}:\d{2})\b/i.test(message);
  
  // Support for abbreviated day names
  const hasAbbreviatedDays = /\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(message);
  
  // Support for month names
  const hasMonthNames = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(message);
  
  // Support for 24-hour format
  const has24HourFormat = /\b\d{1,2}:\d{2}\b/.test(message);
  
  const indicatorCount = [hasLocation, hasMultipleTimes, hasEventName, hasDates, hasTimePatterns, hasAbbreviatedDays, hasMonthNames, has24HourFormat].filter(Boolean).length;
  
  const isTimeOptionsOnly = hasTimePatterns || hasDates || hasAbbreviatedDays || hasMonthNames || has24HourFormat;
  const isFullSyncUpDetails = hasLocation || hasMultipleTimes || hasEventName;
  
  if (indicatorCount >= 2 || (isTimeOptionsOnly && !isFullSyncUpDetails)) {
    return {
      isMatch: true,
      extractedData: {
        sync_up_details: message.trim()
      }
    };
  }
  
  return { isMatch: false, extractedData: {} };
}

function checkSyncStatusPattern(message: string): { isMatch: boolean, eventName: string | null } {
  const patterns = [
    /^sync\s+check(?:\s+(.+))?$/i,
    /^sync\s+status(?:\s+(.+))?$/i,
    /^sync\s+up\s+status(?:\s+(.+))?$/i,
    /^check\s+sync\s+up(?:\s+(.+))?$/i,
    /^show\s+sync\s+up\s+responses?(?:\s+(.+))?$/i,
    /^show\s+sync\s+up\s+status(?:\s+(.+))?$/i,
    /^display\s+sync\s+up\s+responses?(?:\s+(.+))?$/i,
    /^view\s+sync\s+up\s+responses?(?:\s+(.+))?$/i,
    /^get\s+sync\s+up\s+responses?(?:\s+(.+))?$/i
  ];
  
  for (const pattern of patterns) {
    const match = message.trim().match(pattern);
    if (match) {
      return { isMatch: true, eventName: match[1] || null };
    }
  }
  
  return { isMatch: false, eventName: null };
}
// Parse sync up details: "Event name, Location, Time1, Time2, Time3"
// Parse time options for RE_SYNC (only time options, no event name/location)
function parseReSyncTimeOptions(message: string): {
  isValid: boolean;
  timeOptions: Array<{
    idx: number;
    text: string;
    start_time: string;
    end_time: string | null;
  }>;
  error?: string;
} {
  // First try splitting by comma (preserves existing behavior)
  const commaSplitParts = message.split(',').map(p => p.trim());
  
  let timeParts: string[] = [];
  
  // If comma splitting gives only 1 part, try to detect multiple date+time patterns
  if (commaSplitParts.length === 1) {
    // Pattern to match complete time options: date + time (optional end time)
    // Matches: "11/6 6pm", "11/8 6-8pm", "12/19 6:30pm", "11-6 10am-12pm"
    // Date pattern: \d{1,2}[\/\-]\d{1,2} (e.g., 11/6, 11-6)
    // Time pattern: \d{1,2}(?::\d{2})?\s*(?:am|pm)? (e.g., 6pm, 6:30pm)
    // Optional end time: (?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)? (e.g., -8pm, -8:30pm)
    const timeOptionPattern = /\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi;
    
    const matches: Array<{ start: number; end: number; text: string }> = [];
    let match;
    
    // Find all matches
    while ((match = timeOptionPattern.exec(message)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0].trim()
      });
    }
    
    // If we found multiple matches, split by them
    if (matches.length > 1) {
      // Extract each time option
      for (let i = 0; i < matches.length; i++) {
        const matchText = matches[i].text;
        timeParts.push(matchText);
      }
    } else {
      // Only one match or no matches, use the original single part
      timeParts = commaSplitParts;
    }
  } else {
    // Multiple parts from comma splitting, use them
    timeParts = commaSplitParts;
  }
  
  if (timeParts.length < 1 || timeParts.length > 3) {
    return {
      isValid: false,
      timeOptions: [],
      error: 'Provide 1-3 time options'
    };
  }
  
  // Parse each time option
  const timeOptions = [];
  for (let i = 0; i < timeParts.length; i++) {
    const parsed = parseTimeOption(timeParts[i], i + 1);
    if (!parsed.isValid) {
      return {
        isValid: false,
        timeOptions: [],
        error: `Invalid time format in option ${i + 1}: "${timeParts[i]}"`
      };
    }
    timeOptions.push(parsed);
  }
  
  return {
    isValid: true,
    timeOptions
  };
}

// _DEPRECATED: parseSyncUpDetails - No longer used in progressive workflow
// Kept for reference but not called in new workflow
function parseSyncUpDetails_DEPRECATED(message: string): {
  isValid: boolean;
  eventName: string | null;
  location: string | null;
  timeOptions: Array<{
    idx: number;
    text: string;
    start_time: string;
    end_time: string | null;
  }>;
  error?: string;
  savedTimeOptions?: string[];
} {
  // Split by comma
  const parts = message.split(',').map(p => p.trim());

  // Helper to detect tokens that look like times (optionally with a day)
  function isTimeLikeToken(token: string): boolean {
    const t = token.trim().toLowerCase();
    const day = '(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)';
    const time = '\\b\\d{1,2}(:\\d{2})?\\s*(am|pm)\\b';
    const dayTime = new RegExp(`^(?:${day}\\s+)?${time}$`, 'i');
    // Also accept formats like "Thu 12/19 6-8pm" or "Sat 10am-12pm" as a single part
    const rangeTime = /\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*-\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/i;
    const containsSlashDate = /\b\d{1,2}[\/\-]\d{1,2}\b/.test(t);
    return dayTime.test(t) || rangeTime.test(t) || (containsSlashDate && /\d/.test(t) && /(am|pm)/i.test(t));
  }
  
  if (parts.length < 3) {
    return {
      isValid: false,
      eventName: null,
      location: null,
      timeOptions: [],
      error: 'Need at least: Event name, Location, and 1 time option'
    };
  }

  // Detect ambiguity: exactly one non-time token and >=1 time-like tokens
  const timeLikeParts = parts.filter(p => isTimeLikeToken(p));
  const nonTimeParts = parts.filter(p => !isTimeLikeToken(p));
  if (nonTimeParts.length === 1 && timeLikeParts.length >= 1) {
    return {
      isValid: false,
      eventName: null,
      location: null,
      timeOptions: [],
      error: 'AMBIGUOUS_EVENT_OR_LOCATION',
      savedTimeOptions: timeLikeParts
    };
  }
  
  const eventName = parts[0];
  const location = parts[1];
  const timeParts = parts.slice(2);
  
  if (timeParts.length < 1 || timeParts.length > 5) {
    return {
      isValid: false,
      eventName: null,
      location: null,
      timeOptions: [],
      error: 'Provide 1-5 time options'
    };
  }
  
  // Parse each time option
  const timeOptions = [];
  for (let i = 0; i < timeParts.length; i++) {
    const parsed = parseTimeOption(timeParts[i], i + 1);
    if (!parsed.isValid) {
      return {
        isValid: false,
        eventName: null,
        location: null,
        timeOptions: [],
        error: `Invalid time format in option ${i + 1}: "${timeParts[i]}"`
      };
    }
    timeOptions.push(parsed);
  }
  
  return {
    isValid: true,
    eventName,
    location,
    timeOptions
  };
}

         // Parse individual time option: "Thu 12/19 6-8pm" or "Sat 12/21 10am-12pm"
         function parseTimeOption(text: string, idx: number): {
           isValid: boolean;
           idx: number;
           text: string;
           start_time: string;
           end_time: string | null;
         } {
           console.log(`Parsing time option: "${text}"`);
           
          // Day of week patterns
          const dayPattern = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i;
          
          // Date patterns: 12/19, 12-19, Dec 19, December 19, Dec19 (with optional space)
          const monthNamePattern = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s*(\d{1,2})\b/i;
          const datePattern = /(\d{1,2})[\/\-](\d{1,2})/i;
          
          // Time patterns: 6pm, 6-8pm, 10am-12pm, 6:30pm-8:30pm
          // Look for time patterns that are clearly separated from dates
          const timePattern = /(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?:\s|$)/i;
          
          const dayMatch = text.match(dayPattern);
          const monthNameMatch = text.match(monthNamePattern);
          const dateMatch = text.match(datePattern);
          
          // For time pattern, exclude the date portion if month name was matched
          // This prevents "Dec 20" from interfering with time parsing
          let textForTimeMatch = text;
          if (monthNameMatch) {
            // Remove the month name date part from the text before matching time
            // Replace the entire match (month name + date + any whitespace) with empty string
            const monthDateStr = monthNameMatch[0]; // The full match like "Dec 20"
            // Use replace with regex to replace the month date pattern, ensuring we remove any trailing space
            textForTimeMatch = text.replace(new RegExp(monthDateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
          }
          const timeMatch = textForTimeMatch.match(timePattern);
           
           console.log(`Day match:`, dayMatch);
           console.log(`Date match:`, dateMatch);
           console.log(`Time match:`, timeMatch);
           
           if (!timeMatch) {
             return {
               isValid: false,
               idx,
               text,
               start_time: '',
               end_time: null
             };
           }
           
          // Calculate target date
          const now = new Date();
          let targetDate = new Date();
          
          // Handle month name date first (Dec 20, December 20)
          if (monthNameMatch) {
            const monthName = monthNameMatch[1];
            const date = parseInt(monthNameMatch[2]);
            const month = monthNameToNumber(monthName);
            
            console.log(`Parsed month name date: month=${month}, date=${date}`);
            
            // Create a new date for the target date
            targetDate = new Date(now.getFullYear(), month, date);
            
            // If date is in the past, assume next year
            if (targetDate < now) {
              targetDate.setFullYear(now.getFullYear() + 1);
            }
          } else if (dateMatch) {
            // Handle numeric date (12/19)
            const monthInput = parseInt(dateMatch[1]);
            const dateInput = parseInt(dateMatch[2]);
            const month = monthInput - 1; // Convert to 0-indexed
            
            console.log(`Parsed date: input="${dateMatch[0]}", monthInput=${monthInput}, month=${month} (0-indexed), date=${dateInput}`);
            
            // Validate month range (1-12)
            if (monthInput < 1 || monthInput > 12) {
              console.error(`Invalid month: ${monthInput}`);
              return {
                isValid: false,
                idx,
                text,
                start_time: '',
                end_time: null
              };
            }
            
            // Validate date range (1-31)
            if (dateInput < 1 || dateInput > 31) {
              console.error(`Invalid date: ${dateInput}`);
              return {
                isValid: false,
                idx,
                text,
                start_time: '',
                end_time: null
              };
            }
            
            // Create a new date for the target date (at midnight for comparison)
            targetDate = new Date(now.getFullYear(), month, dateInput);
            
            // Create a comparison date at start of today for fair comparison
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            console.log(`Date comparison: targetDate=${targetDate.toISOString()}, todayStart=${todayStart.toISOString()}`);
            
            // If date is in the past (before today), assume next year
            if (targetDate < todayStart) {
              targetDate.setFullYear(now.getFullYear() + 1);
              console.log(`Date was in past, rolled to next year: ${targetDate.toISOString()}`);
            }
          } else if (dayMatch) {
             // Handle day of week only if no explicit date
             const day = dayMatch[1].toLowerCase();
             const dayMap = {
               'mon': 1, 'monday': 1,
               'tue': 2, 'tuesday': 2,
               'wed': 3, 'wednesday': 3,
               'thu': 4, 'thursday': 4,
               'fri': 5, 'friday': 5,
               'sat': 6, 'saturday': 6,
               'sun': 0, 'sunday': 0,
               'today': now.getDay(),
               'tomorrow': (now.getDay() + 1) % 7
             };
             
             const targetDay = dayMap[day];
             const currentDay = now.getDay();
             let daysToAdd = targetDay - currentDay;
             if (daysToAdd <= 0) daysToAdd += 7;
             if (day === 'today') daysToAdd = 0;
             if (day === 'tomorrow') daysToAdd = 1;
             
             console.log(`Parsed day of week: day="${day}", targetDay=${targetDay}, currentDay=${currentDay}, daysToAdd=${daysToAdd}`);
             
             targetDate.setDate(now.getDate() + daysToAdd);
             
             console.log(`Calculated target date from day of week: ${targetDate.toISOString()}`);
           }
           
          console.log(`Target date:`, targetDate);
          console.log(`Time match groups:`, timeMatch);
          
          // Parse start time
          const startHour = parseInt(timeMatch[1]);
          const startMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          let startAmPm = timeMatch[3]?.toLowerCase();
          
          console.log(`Parsed start time: hour=${startHour}, min=${startMin}, ampm=${startAmPm || 'null'}`);
          
          // Parse end time first to help infer start time AM/PM
          let endAmPm: string | null = null;
          let endHour: number | null = null;
          if (timeMatch[4]) {
            endHour = parseInt(timeMatch[4]);
            endAmPm = timeMatch[6]?.toLowerCase() || startAmPm || null;
          }
          
          // Infer AM/PM for start time if:
          // 1. End time has PM (e.g., "6-10pm" should be "6pm-10pm")
          // 2. Otherwise default to AM for safety (times without am/pm default to AM)
          if (!startAmPm) {
            if (endAmPm === 'pm') {
              // If end time has PM, infer start as PM
              startAmPm = 'pm';
            } else {
              // Default to AM for times without am/pm specified (safer default)
              // This means "6:00" will be "6am", not "6pm"
              startAmPm = 'am';
            }
          }
          
          let finalStartHour = startHour;
          if (startAmPm === 'pm' && startHour !== 12) finalStartHour += 12;
          if (startAmPm === 'am' && startHour === 12) finalStartHour = 0;
          
          console.log(`Final start hour calculation: startHour=${startHour}, startAmPm=${startAmPm}, finalStartHour=${finalStartHour}`);
          
          const startTime = new Date(targetDate);
          startTime.setHours(finalStartHour, startMin, 0, 0);
          
          console.log(`Created startTime from targetDate: targetDate=${targetDate.toISOString()}, startTime=${startTime.toISOString()}`);
          
          // Parse end time (if exists)
          let endTime: Date | null = null;
          if (timeMatch[4] && endHour !== null) {
            const endMin = timeMatch[5] ? parseInt(timeMatch[5]) : 0;
            // Use inferred endAmPm or fall back to startAmPm
            const finalEndAmPm = endAmPm || startAmPm || 'pm';
            
            let finalEndHour = endHour;
            if (finalEndAmPm === 'pm' && endHour !== 12) finalEndHour += 12;
            if (finalEndAmPm === 'am' && endHour === 12) finalEndHour = 0;
            
            endTime = new Date(targetDate);
            endTime.setHours(finalEndHour, endMin, 0, 0);
          }
           
           console.log(`Final start time:`, startTime);
           console.log(`Final end time:`, endTime);
           
           return {
             isValid: true,
             idx,
             text: text.trim(),
             start_time: startTime.toISOString(),
             end_time: endTime ? endTime.toISOString() : null
           };
         }

// Helper: Convert month name to number
function monthNameToNumber(monthName: string): number {
  const months = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };
  return months[monthName.toLowerCase()] || 0;
}

// Check for ADD_CREW_MEMBERS patterns
function checkAddCrewMembersPattern(message: string): { isMatch: boolean, extractedMembers: any[] | null, crewName: string | null } {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Pattern 1: Explicit "add member" commands
  const addMembersPatterns = [
    /^add\s+member$/,
    /^add\s+members?$/,  // "Add Members" (capital M, with or without s)
    /^add\s+people$/,
    /^add\s+member\s+(.+)$/,
    /^add\s+people\s+(.+)$/,
    // Pattern for "add members to [crew name]" (more specific, must come first)
    /^add\s+members?\s+to\s+(.+)$/,
    // Pattern for "add members [crew name]" (without "to")
    /^add\s+members?\s+(.+)$/,
    // Pattern for "add people to [crew name]"  
    /^add\s+people\s+to\s+(.+)$/,
    // Pattern for "invite more/some people to [crew name]"
    /^invite\s+(?:more|some)?\s*people\s+to\s+(.+)$/,
    // Pattern for "invite more/some members to [crew name]"
    /^invite\s+(?:more|some)?\s*members?\s+to\s+(.+)$/,
    // Pattern for "invite people" (no crew name) - but not "invite more people" which is for events
    /^invite\s+(?:some)?\s*people$/,
    // Pattern for "invite members" (no crew name) - but not "invite more people" which is for events
    /^invite\s+(?:some)?\s*members?$/
  ];
  
  for (const pattern of addMembersPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      // Check if this pattern extracts a crew name (patterns with "to\\s+")
      const isCrewNamePattern = pattern.source.includes('to\\s+');
      // Check if this is the "add members [crew name]" pattern (without "to")
      const isDirectCrewNamePattern = pattern.source === '^add\\s+members?\\s+(.+)$';
      const crewName = isCrewNamePattern || isDirectCrewNamePattern ? match[1] : null;
      
      return {
        isMatch: true,
        extractedMembers: match[1] && !isCrewNamePattern && !isDirectCrewNamePattern ? parseMemberInfo(match[1]) : null,
        crewName: crewName
      };
    }
  }
  
  // Pattern 2: Direct member information (e.g., "Tom 4155551234, Bob 4155551235")
  // This detects when users provide member info directly without "add member" command
  // More strict validation - must have both name and number
  const directMemberPattern = /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*\s+[\+\d\(\)\-\s]+$/;
  if (directMemberPattern.test(message.trim())) {
    const extractedMembers = parseMemberInfo(message);
    if (extractedMembers.length > 0) {
      return {
        isMatch: true,
        extractedMembers: extractedMembers,
        crewName: null
      };
    }
  }
  
  return { isMatch: false, extractedMembers: null, crewName: null };
}

// Helper function to detect mixed input (some entries with phone numbers, some without)
function hasMixedInput(message: string): boolean {
  const parts = message.split(',').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length < 2) return false; // Need at least 2 parts to be "mixed"
  
  const phonePattern = /[\+\d\(\)\-\s]{7,}/;
  const withNumbers = parts.filter(p => phonePattern.test(p));
  const withoutNumbers = parts.filter(p => !phonePattern.test(p));
  
  return withNumbers.length > 0 && withoutNumbers.length > 0;
}

// Parse member information from text with enhanced pattern matching
// Supports formats like:
// - "Tom 4155551234"
// - "Tom 4155551234, Bob 4155551235" 
// - "Tom +14155551234, Bob +4155551234"
// - "Tom +14155551234, Tom +4155551234"
// - "Tom 4155551234, Tom 4155551234" (duplicates)
// - "David (707) 559-8115" (with parentheses and spaces)
function parseMemberInfo(text: string): any[] {
  const members = [];
  
  // Normalize input: remove special Unicode characters like left-to-right marks (U+200E), right-to-left marks, etc.
  // These invisible characters can interfere with pattern matching
  const normalizedText = text
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') // Remove directional marks
    .trim();
  
  // Enhanced regex patterns to handle various phone number formats
  // Updated to support multi-word names and formatted phone numbers
  const patterns = [
    // Pattern 1: Name +1XXXXXXXXXX (with +1 prefix)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\+1(\d{10})/g,
    // Pattern 2: Name +XXXXXXXXXX (with + prefix, no country code)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\+(\d{10})/g,
    // Pattern 3: Name XXXXXXXXXX (10 digits, no prefix)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*(\d{10})/g,
    // Pattern 4: Name 1XXXXXXXXXX (11 digits starting with 1)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*(1\d{10})/g,
    // Pattern 5: Name XXX-XXX-XXXX (with dashes)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*(\d{3}-\d{3}-\d{4})/g,
    // Pattern 6: Name (XXX) XXX-XXXX (with parentheses)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\((\d{3})\)\s*(\d{3})-(\d{4})/g,
    // Pattern 7: Name +1-XXX-XXX-XXXX or 1-XXX-XXX-XXXX (country code with dashes)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\+?1-(\d{3}-\d{3}-\d{4})/g,
    // Pattern 8: Name +1 (XXX) XXX-XXXX or 1 (XXX) XXX-XXXX (country code with parentheses)
    /([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s*\+?1\s*\((\d{3})\)\s*(\d{3})-(\d{4})/g
  ];
  
  // Try each pattern
  for (const pattern of patterns) {
    let match;
    const tempMembers = [];
    
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(normalizedText)) !== null) {
      console.log(`parseMemberInfo: Pattern matched - Name: "${match[1]}", Match groups:`, match.slice(2));
      let phoneNumber = '';
      
      if (pattern === patterns[0]) {
        // +1XXXXXXXXXX format
        phoneNumber = `+1${match[2]}`;
        console.log(`parseMemberInfo: Pattern 0 - Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[1]) {
        // +XXXXXXXXXX format (assume US)
        phoneNumber = `+1${match[2]}`;
        console.log(`parseMemberInfo: Pattern 1 - Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[2]) {
        // XXXXXXXXXX format (assume US)
        phoneNumber = `+1${match[2]}`;
        console.log(`parseMemberInfo: Pattern 2 - Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[3]) {
        // 1XXXXXXXXXX format (11 digits starting with 1)
        phoneNumber = `+${match[2]}`;
        console.log(`parseMemberInfo: Pattern 3 - Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[4]) {
        // XXX-XXX-XXXX format (with dashes)
        const cleanPhone = match[2].replace(/-/g, '');
        phoneNumber = `+1${cleanPhone}`;
        console.log(`parseMemberInfo: Pattern 4 - Original: ${match[2]}, Clean: ${cleanPhone}, Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[5]) {
        // (XXX) XXX-XXXX format (with parentheses)
        const areaCode = match[2];
        const firstPart = match[3];
        const secondPart = match[4];
        phoneNumber = `+1${areaCode}${firstPart}${secondPart}`;
        console.log(`parseMemberInfo: Pattern 5 - Area: ${areaCode}, First: ${firstPart}, Second: ${secondPart}, Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[6]) {
        // +1-XXX-XXX-XXXX or 1-XXX-XXX-XXXX format (country code with dashes)
        const cleanPhone = match[2].replace(/-/g, '');
        phoneNumber = `+1${cleanPhone}`;
        console.log(`parseMemberInfo: Pattern 6 - Formatted phone: ${phoneNumber}`);
      } else if (pattern === patterns[7]) {
        // +1 (XXX) XXX-XXXX or 1 (XXX) XXX-XXXX format (country code with parentheses)
        const areaCode = match[2];
        const firstPart = match[3];
        const secondPart = match[4];
        phoneNumber = `+1${areaCode}${firstPart}${secondPart}`;
        console.log(`parseMemberInfo: Pattern 7 - Formatted phone: ${phoneNumber}`);
      }
      
      tempMembers.push({
        name: match[1].trim(),
        phone: phoneNumber
      });
    }
    
    // If we found members with this pattern, use them
    if (tempMembers.length > 0) {
      members.push(...tempMembers);
      break; // Use the first pattern that matches
    }
  }
  
  // Remove duplicates based on phone number
  const uniqueMembers = [];
  const seenPhones = new Set();
  
  for (const member of members) {
    if (!seenPhones.has(member.phone)) {
      seenPhones.add(member.phone);
      uniqueMembers.push(member);
    }
  }
  
  // Ensure all members have both name and phone
  const validMembers = uniqueMembers.filter(m => m.name && m.phone);
  return validMembers;
}

// Helper function to parse a name into first_name and last_name
function parseNameIntoFirstAndLast(name: string): { first_name: string, last_name: string | null } {
  if (!name || typeof name !== 'string') {
    return { first_name: '', last_name: null };
  }
  
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { first_name: '', last_name: null };
  }
  
  const nameParts = trimmedName.split(/\s+/).filter(part => part.length > 0);
  
  if (nameParts.length === 0) {
    return { first_name: '', last_name: null };
  } else if (nameParts.length === 1) {
    return { first_name: nameParts[0], last_name: null };
  } else {
    // First word is first_name, rest is last_name
    const first_name = nameParts[0];
    const last_name = nameParts.slice(1).join(' ');
    return { first_name, last_name };
  }
}

// Helper function to convert day names and month dates to YYYY-MM-DD format
function formatDateForDisplay(dateStr: string): string {
  if (!dateStr) return '';
  
  try {
    // If it's already in YYYY-MM-DD format, parse it
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    // If it's a day name like "friday", convert it first
    if (['friday', 'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'today', 'tomorrow'].includes(dateStr.toLowerCase())) {
      const convertedDate = convertDayNameToDate(dateStr);
      const date = new Date(convertedDate + 'T00:00:00');
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    // If it's already in a readable format like "Oct 20", return as-is
    return dateStr;
  } catch (error) {
    return dateStr; // Return original if parsing fails
  }
}

// Helper function to convert day names and month dates to YYYY-MM-DD format
function convertDayNameToDate(dayName: string): string {
  const dayMap: { [key: string]: number } = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3,
    'thu': 4, 'fri': 5, 'sat': 6
  };
  
  const monthMap: { [key: string]: number } = {
    'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
    'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
    'aug': 7, 'august': 7, 'sep': 8, 'september': 8, 'oct': 9, 'october': 9,
    'nov': 10, 'november': 10, 'dec': 11, 'december': 11
  };
  
  const normalizedDay = dayName.toLowerCase().trim();
  
  if (normalizedDay === 'today') {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  
  if (normalizedDay === 'tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  
  if (dayMap[normalizedDay] !== undefined) {
    const today = new Date();
    const todayDay = today.getDay();
    const targetDay = dayMap[normalizedDay];
    
    let daysUntilTarget = targetDay - todayDay;
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7; // Next week
    }
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    return targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  
  // Handle day of week + month + date: "Sat Nov 15", "Saturday November 15"
  const dayMonthDateMatch = normalizedDay.match(/(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
  if (dayMonthDateMatch) {
    const dayName = dayMonthDateMatch[1];
    const monthName = dayMonthDateMatch[2];
    const day = parseInt(dayMonthDateMatch[3]);
    const month = monthMap[monthName];
    const expectedDayOfWeek = dayMap[dayName];
    
    if (month !== undefined && day >= 1 && day <= 31 && expectedDayOfWeek !== undefined) {
      const currentYear = new Date().getFullYear();
      const now = new Date();
      
      // First, check if the date this year matches the day of week
      let targetDate = new Date(currentYear, month, day);
      let actualDayOfWeek = targetDate.getDay();
      
      if (actualDayOfWeek === expectedDayOfWeek) {
        // Date this year matches the day of week - if it's in the past, reject it
        if (targetDate < now) {
          // Return a special marker that this is a past date (will be rejected by validation)
          return targetDate.toISOString().split('T')[0]; // This will be caught by the validation check
        }
        // Date is in the future and matches day of week - use it
        return targetDate.toISOString().split('T')[0];
      }
      
      // Date this year doesn't match the day of week - adjust to correct day in same week
      const dayDiff = expectedDayOfWeek - actualDayOfWeek;
      targetDate.setDate(targetDate.getDate() + dayDiff);
      
      // If the adjusted date is in the past, try next year
      if (targetDate < now) {
        targetDate.setFullYear(currentYear + 1);
        // Re-check day of week after year change
        actualDayOfWeek = targetDate.getDay();
        if (actualDayOfWeek !== expectedDayOfWeek) {
          const dayDiff = expectedDayOfWeek - actualDayOfWeek;
          targetDate.setDate(targetDate.getDate() + dayDiff);
        }
      }
      
      return targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
  }
  
  // Handle month abbreviations with dates: "Oct 20", "20 Oct", "October 20"
  const monthDateMatch = normalizedDay.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
  if (monthDateMatch) {
    const monthName = monthDateMatch[1];
    const day = parseInt(monthDateMatch[2]);
    const month = monthMap[monthName];
    
    if (month !== undefined && day >= 1 && day <= 31) {
      const currentYear = new Date().getFullYear();
      const now = new Date();
      let targetDate = new Date(currentYear, month, day);
      
      // If the date has passed this year, use next year
      if (targetDate < now) {
        targetDate.setFullYear(currentYear + 1);
      }
      
      // Final validation: ensure it's in the future (not today)
      if (targetDate <= now) {
        targetDate.setFullYear(currentYear + 1);
      }
      
      return targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
  }
  
  // Handle numeric date formats: "10/20", "10-20"
  const numericDateMatch = normalizedDay.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (numericDateMatch) {
    const month = parseInt(numericDateMatch[1]) - 1; // JavaScript months are 0-indexed
    const day = parseInt(numericDateMatch[2]);
    
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const currentYear = new Date().getFullYear();
      const targetDate = new Date(currentYear, month, day);
      
      // If the date has passed this year, use next year
      if (targetDate < new Date()) {
        targetDate.setFullYear(currentYear + 1);
      }
      
      return targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
  }
  
  return dayName; // If it's already a date format, return as-is
}

// Global helper to format sync up confirmation message
function formatTimeRangeForOptionGlobal(startIso: string, endIso: string | null): { dayMonth: string; timeText: string } {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const weekday = start.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

  const formatLower = (d: Date) => {
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const minutesStr = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
    return `${hours}${minutesStr}${ampm}`;
  };

  if (!end) {
    return { dayMonth: `${weekday} ${monthDay}`, timeText: `${formatLower(start)}` };
  }

  const samePeriod = (start.getHours() >= 12) === (end.getHours() >= 12);
  const startText = samePeriod ? `${(() => {
    let h = start.getHours() % 12; if (h === 0) h = 12; const m = start.getMinutes();
    return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
  })()}` : formatLower(start);
  const endText = formatLower(end);
  return { dayMonth: `${weekday} ${monthDay}`, timeText: `${startText}-${endText}` };
}

async function formatSyncUpConfirmation(syncUpData: any, supabaseClient: any): Promise<string> {
  // Count crew members (robust: use exact count, fallback to data length)
  let memberCount = 0;
  try {
    const { data, count } = await supabaseClient
      .from('crew_members')
      .select('id', { count: 'exact' })
      .eq('crew_id', syncUpData.crew_id);
    if (typeof count === 'number') {
      memberCount = count;
    } else if (Array.isArray(data)) {
      memberCount = data.length;
    }
  } catch (err) {
    console.log('WARN: crew member count failed, defaulting to 0', err);
  }

  // New format: Confirm: [Event Name] at [Location] for [Crew Name]
  // Time options:
  // [Date, Start Time-End Time (optional)]
  // [Date, Start Time-End Time (optional)]
  // [Date, Start Time-End Time (optional)]
  // [Note: X (optional)]
  // Send sync up to [X] members?
  const parts: string[] = [];
  parts.push(`Confirm: ${syncUpData.event_name} at ${syncUpData.location} for ${syncUpData.crew_name}`);
  
  parts.push('\nTime options:');
  (syncUpData.time_options_parsed || []).forEach((opt: any) => {
    const { dayMonth, timeText } = formatTimeRangeForOptionGlobal(opt.start_time, opt.end_time);
    parts.push(`${dayMonth}, ${timeText}`);
  });
  
  if (syncUpData.notes && syncUpData.notes.trim()) {
    parts.push(`\nNote: ${syncUpData.notes}`);
  }
  
  parts.push(`\nSend sync up to ${memberCount} members?`);
  return parts.join('\n');
}

// Validation helper functions
function isValidEventName(name: string): boolean {
  // Accept any text with 2+ chars that isn't just numbers/special chars
  return name && name.length >= 2 && /[a-zA-Z]/.test(name);
}

function isValidDate(date: string): boolean {
  // Check for day names, month names, or numeric date formats
  // Supports: "Friday", "Oct 20", "20 Oct", "10/20", "10-20", "October 20", etc.
  return /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/\-]\d{1,2}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2})$/i.test(date.trim());
}

function isValidTime(time: string): boolean {
  // Check for time formats: 5pm, 5:30pm, 17:00, etc.
  return /^\d{1,2}(:\d{2})?\s*(am|pm)?$/i.test(time.trim());
}

function isValidLocation(location: string): boolean {
  // Accept any text with 2+ chars
  return location && location.length >= 2;
}

// Helper function to build recipient list for sync up messaging
async function buildSyncUpRecipientList(supabase: any, syncUpId: string, targetingGroup: string): Promise<any[]> {
  try {
    if (targetingGroup === 'everyone') {
      // Everyone: all contacts who have a sync_up_response row for this sync up
      const { data: responses, error: responsesError } = await supabase
        .from('sync_up_responses')
        .select(`
          contact_id,
          option_ids,
          contacts!inner(
            id,
            first_name,
            last_name,
            phone_number
          )
        `)
        .eq('sync_up_id', syncUpId);
      if (responsesError) {
        console.error('Error fetching sync up responses:', responsesError);
        return [];
      }
      return (responses || []).map((r: any) => ({
        id: r.contacts.id,
        name: [r.contacts.first_name, r.contacts.last_name].filter(Boolean).join(' ').trim(),
        phone_number: r.contacts.phone_number,
        contact_id: r.contact_id
      }));
    } else if (targetingGroup === 'non_responders') {
      // Non-responders: response rows with null/empty option_ids
      const { data: responses, error: responsesError } = await supabase
        .from('sync_up_responses')
        .select(`
          contact_id,
          option_ids,
          contacts!inner(
            id,
            first_name,
            last_name,
            phone_number
          )
        `)
        .eq('sync_up_id', syncUpId);
      if (responsesError) {
        console.error('Error fetching sync up responses:', responsesError);
        return [];
      }
      const nonResponders = (responses || []).filter((r: any) => !r.option_ids || r.option_ids.length === 0);
      return nonResponders.map((r: any) => ({
        id: r.contacts.id,
        name: [r.contacts.first_name, r.contacts.last_name].filter(Boolean).join(' ').trim(),
        phone_number: r.contacts.phone_number,
        contact_id: r.contact_id
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Error building sync up recipient list:', error);
    return [];
  }
}

// Helper function to format sync up time options
function formatTimeOptions(syncUpOptions: any[]): string {
  if (!syncUpOptions || syncUpOptions.length === 0) {
    return '';
  }
  
  // Sort options by start_time
  const sortedOptions = [...syncUpOptions].sort((a, b) => {
    if (!a.start_time || !b.start_time) return 0;
    return a.start_time.localeCompare(b.start_time);
  });
  
  // Group options by date (if they have dates) or just show times
  const timeStrings = sortedOptions.map(option => {
    if (option.option_text) {
      // Use the custom option text if available
      return option.option_text;
    } else if (option.start_time && option.end_time) {
      // Format as "start_time - end_time"
      const startTime = formatTimeForDisplay(option.start_time);
      const endTime = formatTimeForDisplay(option.end_time);
      return `${startTime} - ${endTime}`;
    } else if (option.start_time) {
      // Just show start time
      return formatTimeForDisplay(option.start_time);
    }
    return '';
  }).filter(timeStr => timeStr.length > 0);
  
  if (timeStrings.length === 0) {
    return '';
  }
  
  // Join with " or " for better readability
  return ` - ${timeStrings.join(' or ')}`;
}

// Helper function to format time for display
function formatTimeForDisplay(timeStr: string): string {
  if (!timeStr) return '';
  
  try {
    // Handle different time formats
    let time: Date;
    
    // If it's already in HH:MM format, use it directly
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      time = new Date();
      time.setHours(hours, minutes, 0, 0);
    } else {
      // Try to parse as ISO string or other format
      time = new Date(timeStr);
    }
    
    // Format as 12-hour time with AM/PM
    return time.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    // If parsing fails, return the original string
    return timeStr;
  }
}

// Helper function to fetch event with shorten_event_url with retry logic
async function fetchEventWithShortUrl(supabase: any, eventId: string, maxRetries: number = 5, retryDelay: number = 1000): Promise<{ shorten_event_url: string | null, event: any }> {
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, shorten_event_url')
      .eq('id', eventId)
      .single();
    
    if (eventError) {
      console.error(`Error fetching event (attempt ${retryCount + 1}/${maxRetries}):`, eventError);
      return { shorten_event_url: null, event: null };
    }
    
    if (eventData && eventData.shorten_event_url) {
      console.log(`✅ shorten_event_url found for event ${eventId} on attempt ${retryCount + 1}`);
      return { shorten_event_url: eventData.shorten_event_url, event: eventData };
    }
    
    // If shorten_event_url is not available, wait and retry
    if (retryCount < maxRetries - 1) {
      console.log(`⏳ shorten_event_url not ready for event ${eventId} (attempt ${retryCount + 1}/${maxRetries}), waiting ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    
    retryCount++;
  }
  
  console.warn(`⚠️ shorten_event_url not generated for event ${eventId} after ${maxRetries} attempts, using fallback`);
  // Return the event data even if shorten_event_url is not available
  const { data: eventData } = await supabase
    .from('events')
    .select('id, title, event_date, start_time, shorten_event_url')
    .eq('id', eventId)
    .single();
  
  return { shorten_event_url: null, event: eventData };
}

// Helper function to format event link (with fallback)
function formatEventLink(eventId: string, shortenEventUrl: string | null): string {
  if (shortenEventUrl) {
    return shortenEventUrl;
  }
  // Fallback to original format if shorten_event_url is not available
  return `funlet.ai/event/${eventId}`;
}

// Helper function to format phone number for display (e.g., +14155551234 -> (415) 555-1234)
function formatPhoneNumberForDisplay(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If it starts with 1, remove it
  const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
  
  // Format as XXX-XXX-XXXX (dashes only, no parentheses - parentheses added by caller)
  if (cleanDigits.length === 10) {
    return `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`;
  }
  
  // Fallback: return original if can't format
  return phone;
}

// Helper function to format phone number for "already in crew" messages (e.g., +14155551234 -> 415-555-1234)
function formatPhoneNumberForCrewMessage(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If it starts with 1, remove it
  const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
  
  // Format as XXX-XXX-XXXX (dashes only, no parentheses)
  if (cleanDigits.length === 10) {
    return `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`;
  }
  
  // Fallback: return original if can't format
  return phone;
}

// Helper function to format event date (e.g., "2025-11-19" -> "11/19/2025")
function formatEventDate(dateString: string): string {
  // Input: "2025-11-19" (YYYY-MM-DD)
  // Output: "11/19/2025" (MM/DD/YYYY)
  const date = new Date(dateString + 'T00:00:00');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Helper function to format event time (e.g., "17:00:00" -> "5:00pm" or "17:30:00" + "19:30:00" -> "5:30pm-7:30pm")
function formatEventTime(timeString: string, endTimeString?: string | null): string {
  // Input: "17:00:00" (HH:MM:SS) or "17:30:00"
  // Output: "5:00pm" or "5:30pm-7:30pm"
  const parseTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const hour12 = hours % 12 || 12;
    const ampm = hours < 12 ? 'am' : 'pm';
    const minStr = `:${minutes.toString().padStart(2, '0')}`;
    return `${hour12}${minStr}${ampm}`;
  };
  
  const startTime = parseTime(timeString);
  if (endTimeString) {
    const endTime = parseTime(endTimeString);
    return `${startTime}-${endTime}`;
  }
  return startTime;
}

// Helper function to get crew join link
async function getCrewJoinLink(supabase: any, crewId: string): Promise<string> {
  const { data: crewData } = await supabase
    .from('crews')
    .select('invite_url, invite_code')
    .eq('id', crewId)
    .single();
  
  if (crewData?.invite_url) {
    return crewData.invite_url;
  }
  
  // Fallback: generate link from crew_id or invite_code
  if (crewData?.invite_code) {
    return `funlet.ai/join/crew-${crewData.invite_code}`;
  }
  
  return `funlet.ai/join/crew-${crewId.substring(0, 8)}`;
}

// Helper function to validate crew ownership
async function validateCrewOwnership(supabase: any, crewId: string, userId: string): Promise<{ isValid: boolean, crew: { id: string, name: string, creator_id: string } | null }> {
  const { data: crew, error } = await supabase
    .from('crews')
    .select('id, name, creator_id')
    .eq('id', crewId)
    .single();
  
  if (error || !crew) {
    return { isValid: false, crew: null };
  }
  
  if (crew.creator_id !== userId) {
    return { isValid: false, crew: null };
  }
  
  return { isValid: true, crew };
}

// Helper function to format crew members display
function formatCrewMembersDisplay(crewName: string, members: any[], totalCount: number): string {
  if (totalCount === 0) {
    return `${crewName} has no members yet.`;
  }
  
  // Format member names (first_name or first_name last_name)
  const memberNames = members.map(m => {
    const contact = m.contacts || m;
    if (contact.last_name) {
      return `${contact.first_name} ${contact.last_name}`;
    }
    return contact.first_name;
  });
  
  if (totalCount <= 5) {
    // Show all members
    return `${crewName} (${totalCount}): ${memberNames.join(', ')}`;
  } else {
    // Show first 5 with total
    return `${crewName}: ${memberNames.slice(0, 5).join(', ')}… (${totalCount} total)`;
  }
}

// Helper function to format management menu
function formatManagementMenu(crewName: string): string {
  return `Manage ${crewName}:
1. Add Members
2. Remove Members
3. Rename Crew
4. Create Event
5. Sync Up
6. Get Crew Link
7. Get QR Code
8. Delete Crew
9. Exit

Reply with a number (1-9).`;
}

// Helper function to get crew members with pagination support
async function getCrewMembersWithPagination(supabase: any, crewId: string, page: number = 0, pageSize: number = 5): Promise<{ members: any[], totalCount: number, hasMore: boolean, hasPrevious: boolean }> {
  // Get total count
  const { count: totalCount } = await supabase
    .from('crew_members')
    .select('*', { count: 'exact', head: true })
    .eq('crew_id', crewId);
  
  // Get paginated members
  const { data: members, error } = await supabase
    .from('crew_members')
    .select(`
      id,
      contact_id,
      contacts (
        id,
        first_name,
        last_name,
        phone_number
      )
    `)
    .eq('crew_id', crewId)
    .order('added_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  
  if (error) {
    console.error('Error fetching crew members:', error);
    return { members: [], totalCount: 0, hasMore: false, hasPrevious: false };
  }
  
  const hasMore = totalCount ? (page + 1) * pageSize < totalCount : false;
  const hasPrevious = page > 0;
  
  return {
    members: members || [],
    totalCount: totalCount || 0,
    hasMore,
    hasPrevious
  };
}

// Helper functions for EDIT_CONTACT
async function searchUserContacts(supabase: any, userId: string, searchQuery: string): Promise<any[]> {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, phone_number')
    .eq('user_id', userId)
    .ilike('first_name', `%${searchQuery}%`)
    .order('first_name', { ascending: true });
  
  if (error) {
    console.error('Error searching contacts:', error);
    return [];
  }
  
  return contacts || [];
}

async function formatContactDisplay(contact: any): Promise<string> {
  const fullName = contact.last_name 
    ? `${contact.first_name} ${contact.last_name}` 
    : contact.first_name;
  const formattedPhone = formatPhoneNumberForDisplay(contact.phone_number);
  return `${fullName} — (${formattedPhone})`;
}

async function showContactActionsMenu(supabase: any, userId: string, phone_number: string, send_sms: boolean, contactId: string, phoneNumberForState: string): Promise<string> {
  // Get contact details
  const { data: contact } = await supabase
    .from('contacts')
    .select('first_name, last_name, phone_number')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();
  
  if (!contact) {
    return 'Contact not found.';
  }
  
  const contactDisplay = await formatContactDisplay(contact);
  
  let response = `${contactDisplay}\n\n`;
  response += `Edit Contact:\n`;
  response += `1. Edit Name\n`;
  response += `2. Edit Phone Number\n`;
  response += `3. Delete Contact\n`;
  response += `4. Exit\n\n`;
  response += `Reply with a number (1-4).`;
  
  // Update conversation state
  await supabase
    .from('conversation_state')
    .upsert({
      user_id: userId,
      phone_number: phoneNumberForState,
      waiting_for: 'edit_contact_actions_menu',
      current_state: 'edit_contact_menu',
      extracted_data: [{
        action: 'EDIT_CONTACT',
        contact_id: contactId,
        contact_name: `${contact.first_name}${contact.last_name ? ' ' + contact.last_name : ''}`,
        contact_phone: contact.phone_number,
        timestamp: new Date().toISOString()
      }]
    }, {
      onConflict: 'user_id'
    });
  
  await sendSMS(phone_number, response, send_sms, phone_number);
  return response;
}

// Helper function to show crew members and management menu
async function showCrewMembersAndMenu(supabase: any, userId: string, phone_number: string, send_sms: boolean, crewId: string, crewName: string, phoneNumberForState: string): Promise<string> {
  // Validate ownership first
  const ownership = await validateCrewOwnership(supabase, crewId, userId);
  if (!ownership.isValid) {
    const errorMsg = 'You don\'t have permission to manage this crew.';
    await sendSMS(phone_number, errorMsg, send_sms, phone_number);
    return errorMsg;
  }
  
  // Fetch latest crew name from database to ensure we have the current name
  const { data: crewData, error: crewError } = await supabase
    .from('crews')
    .select('name')
    .eq('id', crewId)
    .single();
  
  if (crewError) {
    console.error('Error fetching crew name:', crewError);
    const errorMsg = `Sorry, I couldn't fetch crew information. Please try again.`;
    await sendSMS(phone_number, errorMsg, send_sms, phone_number);
    return errorMsg;
  }
  
  const currentCrewName = crewData.name;
  
  // Get all crew members (for display, not paginated)
  const { data: allMembers, error: membersError } = await supabase
    .from('crew_members')
    .select(`
      id,
      contact_id,
      contacts (
        id,
        first_name,
        last_name,
        phone_number
      )
    `)
    .eq('crew_id', crewId);
  
  if (membersError) {
    console.error('Error fetching crew members:', membersError);
    const errorMsg = `Sorry, I couldn't fetch members for ${currentCrewName}. Please try again.`;
    await sendSMS(phone_number, errorMsg, send_sms, phone_number);
    return errorMsg;
  }
  
  const totalCount = allMembers?.length || 0;
  const membersToDisplay = allMembers?.slice(0, 5) || [];
  
  // Format member display
  const memberDisplay = formatCrewMembersDisplay(currentCrewName, membersToDisplay, totalCount);
  
  // Format management menu
  const menu = formatManagementMenu(currentCrewName);
  
  const responseContent = `${memberDisplay}\n\n${menu}`;
  
  // Store crew info in conversation state - explicitly clean structure with only base fields
  await supabase
    .from('conversation_state')
    .upsert({
      user_id: userId,
      phone_number: phoneNumberForState,
      waiting_for: 'crew_management_menu',
      current_state: 'check_crew_members_menu',
      extracted_data: [{
        action: 'CHECK_CREW_MEMBERS',
        crew_id: crewId,
        crew_name: currentCrewName,
        member_list: allMembers?.map(m => ({
          id: m.id,
          contact_id: m.contact_id,
          name: m.contacts?.last_name ? `${m.contacts.first_name} ${m.contacts.last_name}` : m.contacts?.first_name
        })) || [],
        timestamp: new Date().toISOString()
      }]
    }, {
      onConflict: 'user_id'
    });
  
  await sendSMS(phone_number, responseContent, send_sms, phone_number);
  return responseContent;
}

// Helper function to show event details and management menu
async function showEventDetailsAndMenu(supabase: any, userId: string, phone_number: string, send_sms: boolean, eventId: string, phoneNumberForState: string): Promise<string> {
  // Get event details
  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('id, title, event_date, start_time, end_time, location, notes, status, creator_id')
    .eq('id', eventId)
    .single();
  
  if (eventError || !eventData || eventData.creator_id !== userId) {
    return 'Event not found or you don\'t have permission to manage it.';
  }
  
  // Get RSVP summary
  const { data: invitations } = await supabase
    .from('invitations')
    .select('status')
    .eq('event_id', eventId);
  
  const rsvpCounts = {
    in: 0,
    out: 0,
    maybe: 0,
    no_response: 0
  };
  
  if (invitations) {
    invitations.forEach(inv => {
      if (inv.status === 'in') rsvpCounts.in++;
      else if (inv.status === 'out') rsvpCounts.out++;
      else if (inv.status === 'maybe') rsvpCounts.maybe++;
      else rsvpCounts.no_response++;
    });
  }
  
  // Format date and time using new format functions
  const formattedDate = formatEventDate(eventData.event_date);
  const formattedTime = formatEventTime(eventData.start_time, eventData.end_time);
  
  // Build response
  let response = `${eventData.title}\n`;
  response += `Date: ${formattedDate}\n`;
  response += `Time: ${formattedTime}\n`;
  response += `Location: ${eventData.location || 'TBD'}\n`;
  if (eventData.notes) {
    response += `Notes: ${eventData.notes}\n`;
  }
  response += `RSVPs — In: ${rsvpCounts.in}, Out: ${rsvpCounts.out}, Maybe: ${rsvpCounts.maybe}, No Response: ${rsvpCounts.no_response}\n\n`;
  
  response += `Manage Event:\n`;
  response += `1. Edit Event Details\n`;
  response += `2. Invite More People\n`;
  response += `3. Duplicate Event\n`;
  response += `4. Delete Event\n`;
  response += `5. Exit\n\n`;
  response += `Reply with a number (1-5).`;
  
  // Update conversation state
  await supabase
    .from('conversation_state')
    .upsert({
      user_id: userId,
      phone_number: phoneNumberForState,
      waiting_for: 'event_management_menu',
      current_state: 'manage_event_menu',
      extracted_data: [{
        action: 'MANAGE_EVENT',
        event_id: eventId,
        event_title: eventData.title,
        timestamp: new Date().toISOString()
      }]
    }, {
      onConflict: 'user_id'
    });
  
  return response;
}

// Main pattern matching function
async function checkPatternMatches(message: string, currentState: any = null, isOnboarded: boolean = true, userCrewCount: number = 0, supabase?: any, userId?: string): Promise<{ action: string | null, extractedData: any }> {
  // Check message length first (before other checks)
  // Exception: Allow messages > 160 chars when editing notes field, so specific validation can handle it
  const isEditingNotes = currentState?.waiting_for === 'event_edit_field_input';
  let editingField = null;
  if (isEditingNotes && currentState?.extracted_data && Array.isArray(currentState.extracted_data)) {
    // Find the field being edited from extracted_data
    for (const item of currentState.extracted_data) {
      if (item.field) {
        editingField = item.field;
        break;
      }
    }
  }
  
  if (message.length > 160 && !(isEditingNotes && editingField === 'notes')) {
    return { action: 'MESSAGE_TOO_LONG', extractedData: {} };
  }
  
  // RESET, EXIT, and ONBOARDING commands have the highest priority - they should work regardless of conversation state
  const normalizedMessage = message.toLowerCase().trim();
  if (normalizedMessage === 'reset') {
    return { action: 'RESET', extractedData: {} };
  }
  if (normalizedMessage === 'exit' || normalizedMessage === 'quit' || normalizedMessage === 'stop') {
    return { action: 'EXIT', extractedData: {} };
  }
  if (normalizedMessage === 'onboarding') {
    return { action: 'ONBOARDING', extractedData: {} };
  }

  // ======================================================================
  // MANAGE_EVENT waiting_for handlers (HIGH PRIORITY - before other patterns)
  // ======================================================================

  // Handle event management menu selection (1-5)
  if (currentState?.waiting_for === 'event_management_menu') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const menuOption = parseInt(numericMatch[1]);
      if (menuOption >= 1 && menuOption <= 5) {
        return {
          action: 'EVENT_MANAGEMENT_MENU_SELECTION',
          extractedData: { menu_option: menuOption }
        };
      }
    }
    // Invalid input - return INVALID_UNCLEAR_COMMAND for specific error message
    const normalized = message.toLowerCase().trim();
    if (normalized !== 'exit' && normalized !== 'quit' && normalized !== 'stop') {
      return {
        action: 'INVALID_UNCLEAR_COMMAND',
        extractedData: {}
      };
    }
  }

  // Handle manage event selection with pagination
  if (currentState?.waiting_for === 'manage_event_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const eventIndex = parseInt(numericMatch[1]) - 1;
      return {
        action: 'MANAGE_EVENT_SELECTION',
        extractedData: { event_index: eventIndex }
      };
    }
    
    // Handle "Next/N" and "Prev/P" for event pagination, and "Done/D" to return to main menu
    const normalized = message.toLowerCase().trim();
    if (normalized === 'next' || normalized === 'n') {
      return { action: 'MANAGE_EVENT_MORE', extractedData: {} };
    }
    if (normalized === 'prev' || normalized === 'p' || normalized === 'previous') {
      return { action: 'MANAGE_EVENT_BACK', extractedData: {} };
    }
    if (normalized === 'done' || normalized === 'd') {
      return { action: 'MANAGE_EVENT_DONE', extractedData: {} };
    }
  }

  // Handle edit field selection (name/date/time/location/notes)
  if (currentState?.waiting_for === 'event_edit_field_selection') {
    const normalized = message.toLowerCase().trim();
    if (['name', 'date', 'time', 'location', 'notes'].includes(normalized)) {
      return {
        action: 'EVENT_EDIT_FIELD_SELECTED',
        extractedData: { field: normalized }
      };
    }
    // Invalid input - return INVALID_EVENT_EDIT_FIELD_SELECTION for initial field selection
    return {
      action: 'INVALID_EVENT_EDIT_FIELD_SELECTION',
      extractedData: { invalid_input: message.trim() }
    };
  }

  // Handle field value input for editing
  if (currentState?.waiting_for === 'event_edit_field_input') {
    return {
      action: 'EVENT_EDIT_FIELD_INPUT',
      extractedData: { value: message.trim() }
    };
  }

  // Handle continue or done after editing a field
  if (currentState?.waiting_for === 'event_edit_continue_or_done') {
    const normalized = message.toLowerCase().trim();
    
    // Check for "done"
    if (normalized === 'done' || normalized === 'finish' || normalized === 'finished' || normalized === 'complete') {
      return {
        action: 'EVENT_EDIT_DONE',
        extractedData: {}
      };
    }
    
    // Check for field selection to edit another field
    if (['name', 'date', 'time', 'location', 'notes'].includes(normalized)) {
      return {
        action: 'EVENT_EDIT_FIELD_SELECTED',
        extractedData: { field: normalized }
      };
    }
    
    // Invalid input
    return {
      action: 'INVALID_EVENT_EDIT_CONTINUE',
      extractedData: { invalid_input: message.trim() }
    };
  }

  // Handle confirmation of staged changes
  if (currentState?.waiting_for === 'event_edit_confirm_changes') {
    const normalized = message.toLowerCase().trim();
    if (['yes', 'y', 'yep', 'yeah', 'sure', 'confirm'].includes(normalized)) {
      return { action: 'EVENT_EDIT_CONFIRM_CHANGES', extractedData: {} };
    }
    if (['no', 'n', 'nope', 'cancel'].includes(normalized)) {
      return { action: 'EVENT_EDIT_CANCEL_CHANGES', extractedData: {} };
    }
  }

  // Handle resend invitations confirmation after edit
  if (currentState?.waiting_for === 'event_edit_resend_confirmation') {
    const normalized = message.toLowerCase().trim();
    if (['yes', 'y', 'yep', 'yeah', 'sure'].includes(normalized)) {
      return { action: 'EVENT_EDIT_RESEND_YES', extractedData: {} };
    }
    if (['no', 'n', 'nope'].includes(normalized)) {
      return { action: 'EVENT_EDIT_RESEND_NO', extractedData: {} };
    }
  }

  // Handle duplicate event name input
  if (currentState?.waiting_for === 'duplicate_event_name_input') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'same') {
      return { action: 'DUPLICATE_EVENT_SAME_NAME', extractedData: {} };
    }
    // Check for blank/empty input
    if (message.trim().length === 0) {
      return {
        action: 'DUPLICATE_EVENT_NAME_INVALID_INPUT',
        extractedData: { invalid_input: message.trim() }
      };
    }
    // Any non-empty string is valid (except "same" which is handled above)
    return {
      action: 'DUPLICATE_EVENT_NAME_INPUT',
      extractedData: { name: message.trim() }
    };
  }

  // Handle duplicate event date/time input
  if (currentState?.waiting_for === 'duplicate_event_date_input') {
    return {
      action: 'DUPLICATE_EVENT_DATE_INPUT',
      extractedData: { date: message.trim() }
    };
  }

  if (currentState?.waiting_for === 'duplicate_event_time_input') {
    return {
      action: 'DUPLICATE_EVENT_TIME_INPUT',
      extractedData: { time: message.trim() }
    };
  }

  // Handle duplicate send invitations confirmation
  if (currentState?.waiting_for === 'duplicate_send_invitations') {
    const normalized = message.toLowerCase().trim();
    if (['yes', 'y', 'yep', 'yeah', 'sure'].includes(normalized)) {
      return { action: 'DUPLICATE_SEND_INVITATIONS_YES', extractedData: {} };
    }
    if (['no', 'n', 'nope'].includes(normalized)) {
      return { action: 'DUPLICATE_SEND_INVITATIONS_NO', extractedData: {} };
    }
  }

  // Handle delete event confirmation
  if (currentState?.waiting_for === 'delete_event_confirmation') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'delete') {
      return { action: 'DELETE_EVENT_CONFIRMED', extractedData: {} };
    }
    if (normalized === 'exit' || normalized === 'quit' || normalized === 'stop') {
      return { action: 'EXIT', extractedData: {} };
    }
    // Invalid input - return specific action for error handling
    return {
      action: 'DELETE_EVENT_INVALID_INPUT',
      extractedData: { invalid_input: message.trim() }
    };
  }

  // Handle cancellation message choice
  if (currentState?.waiting_for === 'delete_event_send_cancellation') {
    const normalized = message.toLowerCase().trim();
    if (['yes', 'y', 'yep', 'yeah', 'sure'].includes(normalized)) {
      return { action: 'DELETE_EVENT_SEND_CANCELLATION_YES', extractedData: {} };
    }
    if (['no', 'n', 'nope'].includes(normalized)) {
      return { action: 'DELETE_EVENT_SEND_CANCELLATION_NO', extractedData: {} };
    }
  }

  // Handle cancellation message input
  if (currentState?.waiting_for === 'delete_event_cancellation_message') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'skip') {
      return { action: 'DELETE_EVENT_CANCELLATION_SKIP', extractedData: {} };
    }
    return {
      action: 'DELETE_EVENT_CANCELLATION_MESSAGE',
      extractedData: { message: message.trim() }
    };
  }

  // End of MANAGE_EVENT waiting_for handlers
  // ======================================================================

  // ======================================================================
  // EDIT_CONTACT waiting_for handlers
  // ======================================================================
  
  if (currentState?.waiting_for === 'edit_contact_search_input') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'exit') {
      return { action: 'EXIT', extractedData: {} };
    }
    return {
      action: 'EDIT_CONTACT_SEARCH',
      extractedData: { search_query: message.trim() }
    };
  }

  if (currentState?.waiting_for === 'edit_contact_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const contactIndex = parseInt(numericMatch[1]) - 1;
      return {
        action: 'EDIT_CONTACT_SELECTION',
        extractedData: { contact_index: contactIndex }
      };
    }
    const normalized = message.toLowerCase().trim();
    if (normalized === 'exit') {
      return { action: 'EXIT', extractedData: {} };
    }
    // Invalid input - return INVALID_UNCLEAR_COMMAND for specific error message
    return {
      action: 'INVALID_UNCLEAR_COMMAND',
      extractedData: {}
    };
  }

  if (currentState?.waiting_for === 'edit_contact_actions_menu') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const menuOption = parseInt(numericMatch[1]);
      if (menuOption >= 1 && menuOption <= 4) {
        return {
          action: 'EDIT_CONTACT_MENU_SELECTION',
          extractedData: { menu_option: menuOption }
        };
      }
      // Invalid menu option (not 1-4) - return specific action for EC-008
      return {
        action: 'EDIT_CONTACT_MENU_INVALID_SELECTION',
        extractedData: {}
      };
    }
    const normalized = message.toLowerCase().trim();
    if (normalized === 'exit') {
      return { action: 'EXIT', extractedData: {} };
    }
    // Invalid input (not numeric, not exit) - return specific action for EC-008
    return {
      action: 'EDIT_CONTACT_MENU_INVALID_SELECTION',
      extractedData: {}
    };
  }

  if (currentState?.waiting_for === 'edit_contact_name_input') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'exit') {
      return { action: 'EXIT', extractedData: {} };
    }
    // Check for blank/empty input
    if (!message || message.trim().length === 0) {
      return {
        action: 'EDIT_CONTACT_NAME_INPUT_INVALID',
        extractedData: { error: 'blank_message' }
      };
    }
    return {
      action: 'EDIT_CONTACT_NAME_INPUT',
      extractedData: { new_name: message.trim() }
    };
  }

  if (currentState?.waiting_for === 'edit_contact_phone_input') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'exit') {
      return { action: 'EXIT', extractedData: {} };
    }
    if (normalized === 'back') {
      return { action: 'EDIT_CONTACT_BACK_TO_MENU', extractedData: {} };
    }
    // Extract 10-digit phone number
    const phoneMatch = message.replace(/\D/g, '');
    return {
      action: 'EDIT_CONTACT_PHONE_INPUT',
      extractedData: { new_phone: phoneMatch }
    };
  }

  if (currentState?.waiting_for === 'edit_contact_delete_confirmation') {
    const normalized = message.toLowerCase().trim();
    if (normalized === 'delete') {
      return { action: 'EDIT_CONTACT_DELETE_CONFIRMED', extractedData: {} };
    }
    if (normalized === 'back') {
      return { action: 'EDIT_CONTACT_BACK_TO_MENU', extractedData: {} };
    }
    // Invalid input - return specific action for delete confirmation
    return {
      action: 'EDIT_CONTACT_DELETE_INVALID',
      extractedData: {}
    };
  }

  // End of EDIT_CONTACT waiting_for handlers
  // ======================================================================

  // Check for crew name input EARLY (before other pattern checks that might interfere)
  if (currentState?.waiting_for === 'crew_name_input' || currentState?.waiting_for === 'crew_name') {
    console.log('✅ Crew name input detected via waiting_for field, using pattern matching');
    return {
      action: 'CREATE_CREW',
      extractedData: { crew_name: message.trim() }
    };
  }

  // Check CHECK_RSVPS patterns FIRST (before conversation state checks)
  const checkRsvpsResult = checkCheckRsvpsPattern(message);
  if (checkRsvpsResult.isMatch) {
    return {
      action: 'CHECK_RSVPS',
      extractedData: {
        event_name: checkRsvpsResult.eventName || null
      }
    };
  }

  // Check MANAGE_EVENT patterns (after CHECK_RSVPS)
  const manageEventResult = checkManageEventPattern(message);
  if (manageEventResult.isMatch) {
    return {
      action: 'MANAGE_EVENT',
      extractedData: {
        event_name: manageEventResult.eventName || null
      }
    };
  }

  // Check EDIT_CONTACT patterns
  // First check simple patterns that should match even with leading/trailing spaces
  const trimmedMessage = message.trim();
  if (/^edit contact$/i.test(trimmedMessage) || /^manage contact$/i.test(trimmedMessage)) {
    return {
      action: 'EDIT_CONTACT',
      extractedData: {}
    };
  }
  
  // Then check patterns that extract names (use original message for better extraction)
  const editContactPatterns = [
    /^fix\s+(.+?)(?:'s)?\s+(?:number|phone|name)/i,  // "fix Tom's number", "fix Tom number"
    /^change\s+(.+?)(?:'s)?\s+(?:number|phone|name)/i,  // "change Sarah's name", "change Tom number"
    /^update\s+(.+?)(?:'s)?\s+contact/i,  // "update Tom's contact", "update Tom contact"
    /^edit\s+(.+)$/i  // "edit Tom", "edit Sarah" (must be last to avoid conflicts)
  ];

  for (const pattern of editContactPatterns) {
    const match = trimmedMessage.match(pattern);
    if (match) {
      // Extract name and clean up (original case preserved for better search)
      const extractedName = match[1]?.trim();
      // Don't treat "contact" as a name if it's the exact word after "edit"
      if (extractedName && extractedName.toLowerCase() === 'contact') {
        return {
          action: 'EDIT_CONTACT',
          extractedData: {}
        };
      }
      return {
        action: 'EDIT_CONTACT',
        extractedData: extractedName ? { search_query: extractedName } : {}
      };
    }
  }

  // Check for invite more people specific patterns BEFORE general ADD_CREW_MEMBERS
  if (currentState?.waiting_for === 'send_invites_or_add_members') {
    if (/^send\s+invites?$/i.test(message)) {
      return { action: 'SEND_UNINVITED_INVITES', extractedData: {} };
    }
    if (/^add\s+members?$/i.test(message)) {
      return { action: 'ADD_MEMBERS_TO_EVENT', extractedData: {} };
    }
    // Invalid input in send_invites_or_add_members state
    return { action: 'INVALID_UNINVITED_MEMBERS_INPUT', extractedData: {} };
  }
  if (currentState?.waiting_for === 'add_members_or_exit') {
    console.log('DEBUG: Found add_members_or_exit state, message:', message);
    if (/^add\s+members?$/i.test(message)) {
      console.log('DEBUG: Matched add members pattern');
      return { action: 'ADD_MEMBERS_TO_EVENT', extractedData: {} };
    }
    // Invalid input in add_members_or_exit state
    console.log('DEBUG: Invalid input in add_members_or_exit state, returning INVALID_ADD_MEMBERS_OR_EXIT_INPUT');
    return { action: 'INVALID_ADD_MEMBERS_OR_EXIT_INPUT', extractedData: {} };
  }
  if (currentState?.waiting_for === 'member_input_for_event') {
    if (/^send\s+invites?$/i.test(message)) {
      return { action: 'SEND_INVITES_AFTER_ADDING', extractedData: {} };
    }
    // Parse member info for adding members
    console.log('Checking member input for event, message:', message);
    const extractedMembers = parseMemberInfo(message);
    console.log('Extracted members in pattern matching:', extractedMembers);
    if (extractedMembers.length > 0) {
      return { action: 'MEMBER_INPUT_FOR_EVENT', extractedData: { contacts: extractedMembers } };
    }
    // No members parsed → explicit invalid for Invite More flow
    return { action: 'INVALID_MEMBER_INPUT_FOR_EVENT', extractedData: {} };
  }
  
  // Field-specific pattern matching for partial event details collection (high priority)
  if (currentState?.waiting_for === 'event_name_input') {
    if (!isValidEventName(message.trim())) {
      return { action: 'INVALID_EVENT_NAME_INPUT', extractedData: {} };
    }
    return { action: 'PARTIAL_EVENT_NAME', extractedData: { event_name: message.trim() } };
  }
  if (currentState?.waiting_for === 'event_date_input') {
    // Validate the original input first
    if (!isValidDate(message.trim())) {
      return { action: 'INVALID_DATE_INPUT', extractedData: {} };
    }
    // Parse date or day name
    const parsedDate = convertDayNameToDate(message.trim());
    return { action: 'PARTIAL_EVENT_DATE', extractedData: { date: parsedDate } };
  }
  if (currentState?.waiting_for === 'event_location_input') {
    const normalizedMessage = message.toLowerCase().trim();
    
    // Allow skipping location with 'done' or 'skip'
    if (normalizedMessage === 'done' || normalizedMessage === 'skip') {
      return { action: 'PARTIAL_EVENT_LOCATION', extractedData: { location: null } };
    }
    
    if (!isValidLocation(message.trim())) {
      return { action: 'INVALID_LOCATION_INPUT', extractedData: {} };
    }
    return { action: 'PARTIAL_EVENT_LOCATION', extractedData: { location: message.trim() } };
  }
  if (currentState?.waiting_for === 'event_time_input') {
    const normalizedMessage = message.toLowerCase().trim();
    
    // Allow skipping time with 'done' or 'skip'
    if (normalizedMessage === 'done' || normalizedMessage === 'skip') {
      return { action: 'PARTIAL_EVENT_TIME', extractedData: { start_time: null } };
    }
    
    // Parse time - support ranges like "5-7pm" or "5pm-7pm"
    const timeRangeMatch = message.match(/(\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
    if (timeRangeMatch) {
      // Parse time range: "5-7pm" or "5pm-7pm"
      const startTime = timeRangeMatch[1].trim();
      let endTime = timeRangeMatch[2].trim();
      
      // If start time doesn't have am/pm, infer from end time
      if (!/[ap]m/i.test(startTime) && /[ap]m/i.test(endTime)) {
        const endAmPm = endTime.match(/([ap]m)/i)?.[1];
        if (endAmPm) {
          const startTimeWithAmPm = startTime + endAmPm;
          return { 
            action: 'PARTIAL_EVENT_TIME', 
            extractedData: { 
              start_time: isValidTime(startTimeWithAmPm) ? startTimeWithAmPm : startTime,
              end_time: endTime 
            } 
          };
        }
      }
      
      if (isValidTime(startTime) && isValidTime(endTime)) {
        return { 
          action: 'PARTIAL_EVENT_TIME', 
          extractedData: { start_time: startTime, end_time: endTime } 
        };
      }
    }
    
    // Parse single time - improved regex to better match formats like "7pm", "7 pm", "7:30pm"
    // Pattern: digits (1-2) optionally followed by :MM, optionally followed by space, then am/pm
    const timeMatch = message.match(/(\d{1,2}(?::\d{2})?)\s*(am|pm)/i);
    if (timeMatch) {
      const parsedTime = `${timeMatch[1]}${timeMatch[2]}`.toLowerCase();
      if (isValidTime(parsedTime)) {
        return { action: 'PARTIAL_EVENT_TIME', extractedData: { start_time: parsedTime } };
      }
    }
    
    // Try alternative pattern: digits directly followed by am/pm (no space, no colon)
    const simpleTimeMatch = message.match(/(\d{1,2})(am|pm)/i);
    if (simpleTimeMatch) {
      const parsedTime = `${simpleTimeMatch[1]}${simpleTimeMatch[2]}`.toLowerCase();
      if (isValidTime(parsedTime)) {
        return { action: 'PARTIAL_EVENT_TIME', extractedData: { start_time: parsedTime } };
      }
    }
    
    // If no match, return invalid
    return { action: 'INVALID_TIME_INPUT', extractedData: {} };
  }
  if (currentState?.waiting_for === 'event_notes_input') {
    const normalizedMessage = message.toLowerCase().trim();
    // Handle skip: 'n' or 'no' means skip notes
    if (normalizedMessage === 'n' || normalizedMessage === 'no' || normalizedMessage === 'skip') {
      return { action: 'PARTIAL_EVENT_NOTES', extractedData: { notes: '' } };
    }
    // Any other input is treated as notes
    return { action: 'PARTIAL_EVENT_NOTES', extractedData: { notes: message.trim() } };
  }

  
  // Handle SEND_MESSAGE continuation based on waiting_for state (must come before explicit command checks)
  if (currentState?.waiting_for === 'send_message_context') {
    console.log('🔍 SEND_MESSAGE context selection - message:', message, 'waiting_for:', currentState?.waiting_for);
    // Step 2: Handle context selection
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === '1') {
      // Sync up messaging - not implemented yet
      return { action: 'SEND_MESSAGE', extractedData: { context: 'sync_up' } };
    } else if (normalizedMessage === '2') {
      // Event messaging - show event list
      return { action: 'SEND_MESSAGE', extractedData: { context: 'event' } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'event_selection_send_message') {
    // Step 3: Handle event selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const eventIndex = parseInt(numericMatch[1]) - 1;
      return { action: 'SEND_MESSAGE', extractedData: { event_index: eventIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'sync_up_selection_send_message') {
    // Step 3: Handle sync up selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const syncUpIndex = parseInt(numericMatch[1]) - 1;
      return { action: 'SEND_MESSAGE', extractedData: { sync_up_index: syncUpIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'targeting_selection') {
    // Step 4: Handle targeting selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const targetingIndex = parseInt(numericMatch[1]);
      return { action: 'SEND_MESSAGE', extractedData: { targeting_index: targetingIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'targeting_selection_sync_up') {
    // Step 4: Handle sync up targeting selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const targetingIndex = parseInt(numericMatch[1]);
      return { action: 'SEND_MESSAGE', extractedData: { targeting_index: targetingIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'message_text' || currentState?.waiting_for === 'message_collection') {
    // Step 5: Handle message input
    return { action: 'SEND_MESSAGE', extractedData: { message_text: message.trim() } };
  }
  
  if (currentState?.waiting_for === 'message_text_sync_up') {
    // Step 5: Handle sync up message input
    return { action: 'SEND_MESSAGE', extractedData: { message_text: message.trim() } };
  }
  
  if (currentState?.waiting_for === 'message_confirmation') {
    // Step 6: Handle confirmation
    const normalizedMessage = message.toLowerCase().trim();
    const yesSet = new Set(['yes', 'y', 'confirm', 'yep', 'yeah', 'sure', 'send it', 'sendit']);
    const noSet = new Set(['no', 'n', 'cancel']);
    if (yesSet.has(normalizedMessage)) {
      return { action: 'SEND_MESSAGE', extractedData: { confirm: true } };
    } else if (noSet.has(normalizedMessage)) {
      return { action: 'SEND_MESSAGE', extractedData: { confirm: false } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'message_confirmation_sync_up') {
    // Step 6: Handle sync up message confirmation
    const normalizedMessage = message.toLowerCase().trim();
    const yesSet = new Set(['yes', 'y', 'confirm', 'yep', 'yeah', 'sure', 'send it', 'sendit']);
    const noSet = new Set(['no', 'n', 'cancel']);
    if (yesSet.has(normalizedMessage)) {
      return { action: 'SEND_MESSAGE', extractedData: { confirm: true } };
    } else if (noSet.has(normalizedMessage)) {
      return { action: 'SEND_MESSAGE', extractedData: { confirm: false } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  // Explicit SEND_MESSAGE commands should take priority over any waiting_for
  const sendMessageCmd = checkSendMessagePattern(message);
  if (sendMessageCmd.isMatch) {
    return { action: 'SEND_MESSAGE', extractedData: {} };
  }
  
  // Explicit RE_SYNC commands should take priority over any waiting_for
  const reSyncCmd = checkReSyncPattern(message);
  if (reSyncCmd.isMatch) {
    return { action: 'RE_SYNC', extractedData: { eventName: reSyncCmd.eventName } };
  }
  
  
  // Check for ADD_MEMBERS patterns (including crew name extraction)
  const addMembersResult = checkAddCrewMembersPattern(message);
  if (addMembersResult.isMatch) {
    return {
      action: 'ADD_CREW_MEMBERS',
      extractedData: { 
        crew_members: addMembersResult.extractedMembers,
        crewName: addMembersResult.crewName
      }
    };
  }
  
  // Handle SYNC_UP continuation based on waiting_for state
  if (currentState?.waiting_for === 'crew_selection_for_sync_up') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const crewIndex = parseInt(numericMatch[1]) - 1;
      return {
        action: 'CREW_SELECTION_SYNC_UP',
        extractedData: { crew_index: crewIndex }
      };
    }
  }

  if (currentState?.waiting_for === 'sync_up_event_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      // Event selection requires looking up the event from extracted_data
      return {
        action: 'SYNC_UP_EVENT_SELECTION',
        extractedData: { selection_number: parseInt(numericMatch[1]) }
      };
    }
  }

  if (currentState?.waiting_for === 'sync_status_selection') {
    console.log('🔍 sync_status_selection check: message=', message, 'waiting_for=', currentState.waiting_for);
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      console.log('✅ Numeric match found for sync_status_selection:', numericMatch[1]);
      return {
        action: 'SYNC_STATUS_SELECTION',
        extractedData: { selection_number: parseInt(numericMatch[1]) }
      };
    } else {
      // Non-numeric input - return invalid selection error
      console.log('❌ Non-numeric input for sync_status_selection:', message.trim());
      return {
        action: 'SYNC_STATUS_SELECTION_ERROR',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  // After status is displayed, handle option number selection
  if (currentState?.waiting_for === 'sync_status_option_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      return {
        action: 'SYNC_STATUS_OPTION_SELECTED',
        extractedData: { option_number: parseInt(numericMatch[1]) }
      };
    }
    
    // Check for RE_SYNC trigger
    const reSyncCmd = checkReSyncPattern(message);
    if (reSyncCmd.isMatch) {
      return { action: 'RE_SYNC', extractedData: { eventName: reSyncCmd.eventName } };
    }
  }

  // Handle invitation confirmation after option selected
  if (currentState?.waiting_for === 'sync_status_invite_confirmation') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm' ||
        normalizedMessage === 'yep' || normalizedMessage === 'yeah' || normalizedMessage === 'sure') {
      return {
        action: 'SYNC_STATUS_CONFIRM_INVITE',
        extractedData: {}
      };
    } else if (normalizedMessage === 'exit' || normalizedMessage === 'quit' || normalizedMessage === 'stop' || normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
      // Exit/cancel - handled by EXIT action
      return { action: 'EXIT', extractedData: {} };
    } else {
      // Invalid input
      return {
        action: 'SYNC_STATUS_CONFIRM_INVITE_ERROR',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  // Progressive SYNC_UP workflow pattern matching
  if (currentState?.waiting_for === 'sync_up_event_name_input') {
    if (!isValidEventName(message.trim())) {
      return { action: 'INVALID_SYNC_UP_EVENT_NAME_INPUT', extractedData: {} };
    }
    return { action: 'PARTIAL_SYNC_UP_EVENT_NAME', extractedData: { event_name: message.trim() } };
  }

  if (currentState?.waiting_for === 'sync_up_location_input') {
    if (!isValidLocation(message.trim())) {
      return { action: 'INVALID_SYNC_UP_LOCATION_INPUT', extractedData: {} };
    }
    return { action: 'PARTIAL_SYNC_UP_LOCATION', extractedData: { location: message.trim() } };
  }

  if (currentState?.waiting_for === 'sync_up_time_options_input') {
    // Check if this is RE_SYNC flow (separate from progressive workflow)
    if (currentState?.current_state === 're_sync_time_options') {
      const timeOptionsResult = parseReSyncTimeOptions(message);
      if (timeOptionsResult.isValid && timeOptionsResult.timeOptions.length >= 1) {
        return {
          action: 'SYNC_UP_TIME_OPTIONS_INPUT',
          extractedData: { 
            time_options: timeOptionsResult.timeOptions,
            original_message: message 
          }
        };
      } else {
        return {
          action: 'SYNC_UP_TIME_OPTIONS_ERROR',
          extractedData: { invalid_input: message.trim() }
        };
      }
    }
    
    // Progressive workflow: Parse 1-3 time options using parseReSyncTimeOptions
    const timeOptionsResult = parseReSyncTimeOptions(message);
    if (!timeOptionsResult.isValid || timeOptionsResult.timeOptions.length < 1 || timeOptionsResult.timeOptions.length > 3) {
      return { action: 'INVALID_SYNC_UP_TIME_OPTIONS_INPUT', extractedData: {} };
    }
    return { 
      action: 'PARTIAL_SYNC_UP_TIME_OPTIONS', 
      extractedData: { time_options: timeOptionsResult.timeOptions } 
    };
  }

  if (currentState?.waiting_for === 'sync_up_notes_input') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'n' || normalizedMessage === 'no' || normalizedMessage === 'skip' || normalizedMessage === 'none') {
      return { action: 'PARTIAL_SYNC_UP_NOTES', extractedData: { notes: '' } };
    }
    return { action: 'PARTIAL_SYNC_UP_NOTES', extractedData: { notes: message.trim() } };
  }

  if (currentState?.waiting_for === 'sync_up_change_request') {
    // User wants to change something - parse what they want to change
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage.includes('event name') || normalizedMessage.includes('event') || normalizedMessage.includes('name')) {
      return { action: 'SYNC_UP_CONFIRMATION_CHANGE_EVENT_NAME', extractedData: {} };
    } else if (normalizedMessage.includes('location') || normalizedMessage.includes('where')) {
      return { action: 'SYNC_UP_CONFIRMATION_CHANGE_LOCATION', extractedData: {} };
    } else if (normalizedMessage.includes('time') || normalizedMessage.includes('option') || normalizedMessage.includes('schedule')) {
      return { action: 'SYNC_UP_CONFIRMATION_CHANGE_TIME_OPTIONS', extractedData: {} };
    } else if (normalizedMessage.includes('note') || normalizedMessage.includes('comment')) {
      return { action: 'SYNC_UP_CONFIRMATION_CHANGE_NOTES', extractedData: {} };
    } else {
      return { action: 'SYNC_UP_CONFIRMATION_CHANGE_INVALID', extractedData: {} };
    }
  }

  if (currentState?.waiting_for === 'sync_up_confirmation') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm' || 
        normalizedMessage === 'yep' || normalizedMessage === 'yeah' || normalizedMessage === 'sure') {
      return {
        action: 'SYNC_UP_CONFIRMATION_YES',
        extractedData: {}
      };
    } else if (normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
      return {
        action: 'EXIT',
        extractedData: {}
      };
    } else {
      return {
        action: 'SYNC_UP_CONFIRMATION_INVALID',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  // Helper to format time like "Thu 12/19, 6-8pm" or "Sat 12/21, 10am-12pm"
  function formatTimeRangeForOption(startIso: string, endIso: string | null): { dayMonth: string; timeText: string } {
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : null;
    const weekday = start.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

    const formatLower = (d: Date) => {
      let hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      const minutesStr = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
      return `${hours}${minutesStr}${ampm}`;
    };

    if (!end) {
      return { dayMonth: `${weekday} ${monthDay}`, timeText: `${formatLower(start)}` };
    }

    const samePeriod = (start.getHours() >= 12) === (end.getHours() >= 12);
    const startText = samePeriod ? `${(() => {
      let h = start.getHours() % 12; if (h === 0) h = 12; const m = start.getMinutes();
      return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
    })()}` : formatLower(start);
    const endText = formatLower(end);
    return { dayMonth: `${weekday} ${monthDay}`, timeText: `${startText}-${endText}` };
  }


  // Handle SYNC_UP change requests
  if (currentState?.waiting_for === 'sync_up_change_request') {
    const normalizedMessage = message.toLowerCase().trim();
    
    // Check for exit
    if (normalizedMessage === 'exit' || normalizedMessage === 'cancel') {
      return {
        action: 'EXIT',
        extractedData: {}
      };
    }
    
    // Check for change location pattern
    const locationMatch = message.match(/^change\s+(the\s+)?location\s+(to\s+)?(.+)$/i);
    if (locationMatch) {
      return {
        action: 'SYNC_UP_CHANGE_LOCATION',
        extractedData: { location: locationMatch[3].trim() }
      };
    }
    
    // Check for change event name pattern
    const eventNameMatch = message.match(/^change\s+(the\s+)?(event\s+)?name\s+(to\s+)?(.+)$/i);
    if (eventNameMatch) {
      return {
        action: 'SYNC_UP_CHANGE_EVENT_NAME',
        extractedData: { eventName: eventNameMatch[4].trim() }
      };
    }
    
    // Check for change time options pattern
    const timeOptionsMatch = message.match(/^change\s+(the\s+)?(time|times|time\s+options|options)\s+(to\s+)?(.+)$/i);
    if (timeOptionsMatch) {
      return {
        action: 'SYNC_UP_CHANGE_TIME_OPTIONS',
        extractedData: { raw: timeOptionsMatch[4].trim() }
      };
    }
    
    // Invalid input for change requests
    return {
      action: 'SYNC_UP_CHANGE_INVALID',
      extractedData: { invalid_input: message.trim() }
    };
  }

  // Handle RE_SYNC continuation based on waiting_for state
  if (currentState?.waiting_for === 're_sync_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      return {
        action: 'RE_SYNC_SELECTION',
        extractedData: { selection_number: parseInt(numericMatch[1]) }
      };
    } else {
      // Invalid input for RE_SYNC selection - provide context-specific error
      return {
        action: 'RE_SYNC_INVALID_SELECTION',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  if (currentState?.waiting_for === 're_sync_time_options') {
    // RE_SYNC uses parseReSyncTimeOptions instead of checkSyncUpDetailsInputPattern
    const timeOptionsResult = parseReSyncTimeOptions(message);
    if (timeOptionsResult.isValid && timeOptionsResult.timeOptions.length >= 1) {
      return {
        action: 'RE_SYNC_TIME_OPTIONS',
        extractedData: { time_options: timeOptionsResult.timeOptions }
      };
    } else {
      // Invalid input for RE_SYNC time options - provide context-specific error
      return {
        action: 'RE_SYNC_INVALID_TIME_OPTIONS',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  if (currentState?.waiting_for === 're_sync_confirmation') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm') {
      return {
        action: 'RE_SYNC_CONFIRMATION_YES',
        extractedData: {}
      };
    } else if (normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
      return {
        action: 'RE_SYNC_CONFIRMATION_NO',
        extractedData: {}
      };
    } else {
      // Invalid input for RE_SYNC confirmation - provide context-specific error
      return {
        action: 'RE_SYNC_CONFIRMATION_INVALID',
        extractedData: { invalid_input: message.trim() }
      };
    }
  }

  if (currentState?.waiting_for === 'reset_confirmation') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm') {
      return {
        action: 'RESET_CONFIRMATION_YES',
        extractedData: {}
      };
    } else if (normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
      return {
        action: 'RESET_CONFIRMATION_NO',
        extractedData: {}
      };
    }
  }
  
  // Handle SEND_MESSAGE continuation based on waiting_for state
  if (currentState?.waiting_for === 'send_message_context') {
    console.log('🔍 SEND_MESSAGE context selection - message:', message, 'waiting_for:', currentState?.waiting_for);
    // Step 2: Handle context selection
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === '1') {
      // Sync up messaging - not implemented yet
      return { action: 'SEND_MESSAGE', extractedData: { context: 'sync_up' } };
    } else if (normalizedMessage === '2') {
      // Event messaging - show event list
      return { action: 'SEND_MESSAGE', extractedData: { context: 'event' } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'event_selection_send_message') {
    // Step 3: Handle event selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const eventIndex = parseInt(numericMatch[1]) - 1;
      return { action: 'SEND_MESSAGE', extractedData: { event_index: eventIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'sync_up_selection_send_message') {
    // Step 3: Handle sync up selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const syncUpIndex = parseInt(numericMatch[1]) - 1;
      return { action: 'SEND_MESSAGE', extractedData: { sync_up_index: syncUpIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  if (currentState?.waiting_for === 'targeting_selection') {
    // Step 4: Handle targeting selection
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const targetingIndex = parseInt(numericMatch[1]);
      return { action: 'SEND_MESSAGE', extractedData: { targeting_index: targetingIndex } };
    } else {
      return { action: 'SEND_MESSAGE', extractedData: { invalid_input: true } };
    }
  }
  
  // Handle crew name input via waiting_for field (moved earlier, see line ~1535)
  
  // Handle member adding mode - treat any message as member info
  if (currentState?.waiting_for === 'member_adding_mode') {
    console.log('Member adding mode detected via waiting_for field, using pattern matching');
    
    // Check for special commands in member adding mode
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'create crew' || normalizedMessage.startsWith('create crew ')) {
      // Allow creating a new crew even when in add-members mode
      const crewNameMatch = message.match(/create crew\s+(.+)/i);
      if (crewNameMatch) {
        return {
          action: 'CREATE_CREW',
          extractedData: { crew_name: crewNameMatch[1].trim() }
        };
      } else {
        return {
          action: 'CREATE_CREW',
          extractedData: { crew_name: null }
        };
      }
    }
    if (normalizedMessage === 'create event' || normalizedMessage === 'create event for') {
      // Auto-select the current crew for event creation
      return {
        action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
        extractedData: { auto_select_current_crew: true }
      };
    }
    if (normalizedMessage === 'sync up' || normalizedMessage === 'syncup') {
      return {
        action: 'SYNC_UP',
        extractedData: {}
      };
    }
    if (normalizedMessage === 'menu' || normalizedMessage === 'help' || normalizedMessage === 'commands') {
      return {
        action: 'HELP',
        extractedData: {}
      };
    }

    
    // Check for mixed input (some entries with phones, some without) - reject immediately
    if (hasMixedInput(message)) {
      return {
        action: 'INVALID_MEMBER_ADDING_MODE',
        extractedData: {}
      };
    }
    
    // Check if input contains phone number pattern
    const phonePattern = /[\+\d\(\)\-\s]{7,}/;
    const hasPhoneNumber = phonePattern.test(message);
    
    if (hasPhoneNumber) {
      // Name + phone number - parse and add
      const extractedMembers = parseMemberInfo(message);
      if (extractedMembers.length > 0) {
        return {
          action: 'ADD_CREW_MEMBERS',
          extractedData: { crew_members: extractedMembers }
        };
      } else {
        // Phone pattern detected but parsing failed (invalid format) - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
    } else {
      // Name only - check for comma-separated names (multiple names without phone numbers)
      const nameOnlyPattern = /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*(?:\s*,\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)*)+$/;
      if (nameOnlyPattern.test(message.trim())) {
        // Multiple names without phone numbers - return ADD_CREW_MEMBERS with invalid members to trigger error handling
        const names = message.split(',').map(n => n.trim()).filter(n => n);
        const invalidMembers = names.map(name => ({ name, phone: null }));
        return {
          action: 'ADD_CREW_MEMBERS',
          extractedData: { crew_members: invalidMembers }
        };
      }
      
      // Check for space-separated multiple names (e.g., "Tom Sarah Mike")
      const words = message.trim().split(/\s+/);
      if (words.length >= 2 && words.every(word => /^[a-zA-Z]+$/.test(word))) {
        // Multiple space-separated names without phone numbers - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
      
      // Check for numeric input when no list is active (e.g., user types "2" after no search results)
      const numericMatch = message.trim().match(/^(\d+)$/);
      if (numericMatch) {
        // Numeric input when no active list - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
      
      // Single name - search for existing contact (but exclude special commands)
      const nameOnly = message.trim();
      const specialCommands = ['create crew', 'create event', 'sync up', 'syncup', 'exit', 'quit', 'stop', 'menu', 'help', 'commands'];
      const isSpecialCommand = specialCommands.some(cmd => normalizedMessage === cmd || normalizedMessage.startsWith(cmd + ' '));
      
      if (nameOnly && /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*$/.test(nameOnly) && !isSpecialCommand) {
        return {
          action: 'SEARCH_CONTACT_BY_NAME',
          extractedData: { search_name: nameOnly }
        };
      }
    }
    
    // If nothing matched, return INVALID action
    return {
      action: 'INVALID_MEMBER_ADDING_MODE',
      extractedData: {}
    };
  }
  
  // Handle crew_member_addition state (similar to member_adding_mode)
  if (currentState?.waiting_for === 'crew_member_addition') {
    console.log('Crew member addition mode detected via waiting_for field, using pattern matching');
    
    // Check for special commands
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'create crew' || normalizedMessage.startsWith('create crew ')) {
      // Allow creating a new crew even when in add-members mode
      const crewNameMatch = message.match(/create crew\s+(.+)/i);
      if (crewNameMatch) {
        return {
          action: 'CREATE_CREW',
          extractedData: { crew_name: crewNameMatch[1].trim() }
        };
      } else {
        return {
          action: 'CREATE_CREW',
          extractedData: { crew_name: null }
        };
      }
    }
    if (normalizedMessage === 'create event' || normalizedMessage === 'create event for') {
      return {
        action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
        extractedData: { auto_select_current_crew: true }
      };
    }
    if (normalizedMessage === 'sync up' || normalizedMessage === 'syncup') {
      return {
        action: 'SYNC_UP',
        extractedData: {}
      };
    }
    if (normalizedMessage === 'menu' || normalizedMessage === 'help' || normalizedMessage === 'commands') {
      return {
        action: 'HELP',
        extractedData: {}
      };
    }
  
    
    // Check for mixed input (some entries with phones, some without) - reject immediately
    if (hasMixedInput(message)) {
      return {
        action: 'INVALID_MEMBER_ADDING_MODE',
        extractedData: {}
      };
    }
    
    // Check if input contains phone number pattern
    const phonePattern = /[\+\d\(\)\-\s]{7,}/;
    const hasPhoneNumber = phonePattern.test(message);
    
    if (hasPhoneNumber) {
      // Name + phone number - parse and add
      const extractedMembers = parseMemberInfo(message);
      if (extractedMembers.length > 0) {
        return {
          action: 'ADD_CREW_MEMBERS',
          extractedData: { crew_members: extractedMembers }
        };
      } else {
        // Phone pattern detected but parsing failed (invalid format) - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
    } else {
      // Check for space-separated multiple names (e.g., "Tom Sarah Mike")
      const words = message.trim().split(/\s+/);
      if (words.length >= 2 && words.every(word => /^[a-zA-Z]+$/.test(word))) {
        // Multiple space-separated names without phone numbers - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
      
      // Check for numeric input when no list is active (e.g., user types "2" after no search results)
      const numericMatch = message.trim().match(/^(\d+)$/);
      if (numericMatch) {
        // Numeric input when no active list - return INVALID_MEMBER_ADDING_MODE
        return {
          action: 'INVALID_MEMBER_ADDING_MODE',
          extractedData: {}
        };
      }
      
      // Name only - search for existing contact (but exclude special commands)
      const nameOnly = message.trim();
      const specialCommands = ['create crew', 'create event', 'sync up', 'syncup', 'exit', 'quit', 'stop', 'menu', 'help', 'commands'];
      const isSpecialCommand = specialCommands.some(cmd => normalizedMessage === cmd || normalizedMessage.startsWith(cmd + ' '));
      
      if (nameOnly && /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*$/.test(nameOnly) && !isSpecialCommand) {
        return {
          action: 'SEARCH_CONTACT_BY_NAME',
          extractedData: { search_name: nameOnly }
        };
      }
    }
  }
  
  // Handle contact search confirmation
  if (currentState?.waiting_for === 'confirm_add_contact') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm' ||
        normalizedMessage === 'yep' || normalizedMessage === 'yeah' || normalizedMessage === 'sure') {
      return {
        action: 'CONFIRM_ADD_CONTACT',
        extractedData: {}
      };
    } 
  }
  
  // Handle contact search selection (multiple matches)
  if (currentState?.waiting_for === 'contact_search_selection') {
    const numericMatch = message.trim().match(/^(\d+)$/);
    if (numericMatch) {
      const selectionNumber = parseInt(numericMatch[1]);
      // Accept any positive number - handler will validate against actual contact list
      if (selectionNumber >= 1) {
        return {
          action: 'CONTACT_SEARCH_SELECTION',
          extractedData: { selection_number: selectionNumber }
        };
      } else {
        // Invalid number (0 or negative) - return as invalid selection
        return {
          action: 'CONTACT_SEARCH_SELECTION',
          extractedData: { selection_number: selectionNumber }
        };
      }
    } else {
      // Non-numeric input - return as invalid selection (will be handled by handler)
      return {
        action: 'CONTACT_SEARCH_SELECTION',
        extractedData: { selection_number: 0 }
      };
    }
  }
  
  // ONBOARDING OPTIMIZATION: Check if user needs onboarding or is in onboarding flow
  if (!isOnboarded || userCrewCount === 0 || currentState?.current_state?.startsWith('onboarding_')) {
    console.log('User needs onboarding or is in onboarding flow - checking for onboarding patterns');
    
    // Check for onboarding start patterns
    const onboardingStartPatterns = [
      /^hi$/i,
      /^hello$/i,
      /^hey$/i,
      /^start$/i,
      /^begin$/i,
      /^help$/i,
      /^help me$/i,
      /^get started$/i,
      /^tutorial$/i,
      /^assist$/i
    ];
    
    for (const pattern of onboardingStartPatterns) {
      if (pattern.test(message.trim())) {
        return {
          action: 'ONBOARDING_START',
          extractedData: {}
        };
      }
    }
    
    // Check for crew name in onboarding
    if (currentState?.current_state?.startsWith('onboarding_') && currentState?.onboarding_step === 1) {
      // User is in step 1 (crew creation) - treat any message as crew name
      return {
        action: 'ONBOARDING_CONTINUE',
        extractedData: { crew_name: message.trim() }
      };
    }
    
    // Crew name check already handled earlier in function (line ~1537)
    
    // Check for member info in onboarding step 2
    if (currentState?.current_state?.startsWith('onboarding_') && currentState?.onboarding_step === 2) {
      // Extract member info using regex
      const memberPattern = /([a-zA-Z]+)\s*\+?1?(\d{10})/g;
      const members = [];
      let match;
      
      while ((match = memberPattern.exec(message)) !== null) {
        members.push({
          name: match[1],
          phone: `+1${match[2]}`
        });
      }
      
      if (members.length > 0) {
        return {
          action: 'ONBOARDING_CONTINUE',
          extractedData: { crew_members: members }
        };
      }
    }
  }
  
  // Check CREATE_CREW patterns
  const createCrewResult = checkCreateCrewPattern(message);
  if (createCrewResult.isMatch) {
    return {
      action: 'CREATE_CREW',
      extractedData: { crew_name: createCrewResult.crewName }
    };
  }
  
  // Check for rename crew input (must come before CHECK_CREW_MEMBERS to avoid matching crew names)
  if (currentState?.waiting_for === 'rename_crew_input') {
    const normalizedMessage = message.toLowerCase().trim();
    if (normalizedMessage === 'done' || normalizedMessage === 'back') {
      return {
        action: 'CREW_CHECK_DONE',
        extractedData: {}
      };
    }
    // Check for blank/empty message
    if (!message || message.trim().length === 0) {
      return {
        action: 'RENAME_CREW_INPUT_INVALID',
        extractedData: { error: 'blank_message' }
      };
    }
    // Any other input is treated as new crew name
    return {
      action: 'RENAME_CREW_INPUT',
      extractedData: { new_crew_name: message.trim() }
    };
  }
  
         // Check for numeric crew selection (1, 2, 3, etc.)
         const numericMatch = message.trim().match(/^(\d+)$/);
         if (numericMatch && currentState?.waiting_for === 'crew_selection_for_members') {
           const crewIndex = parseInt(numericMatch[1]) - 1;
           return {
             action: 'CREW_SELECTION',
             extractedData: { crew_index: crewIndex }
           };
         }
         
         // Check for numeric crew selection for CHECK_CREW_MEMBERS (old state)
         if (numericMatch && currentState?.waiting_for === 'crew_selection_for_check_members') {
           const crewIndex = parseInt(numericMatch[1]) - 1;
           return {
             action: 'CREW_SELECTION_CHECK_MEMBERS',
             extractedData: { crew_index: crewIndex }
           };
         }
         
         // Check for numeric crew selection for crew management (new paginated state)
         if (numericMatch && currentState?.waiting_for === 'crew_selection_manage') {
           const crewIndex = parseInt(numericMatch[1]) - 1;
           return {
             action: 'CREW_SELECTION_MANAGE',
             extractedData: { crew_index: crewIndex }
           };
         }
         
         // Check for "Next/N", "Prev/P", and "Done/D" in crew selection pagination
         if (currentState?.waiting_for === 'crew_selection_manage') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'next' || normalizedMessage === 'n') {
             return {
               action: 'CREW_SELECTION_MORE',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'prev' || normalizedMessage === 'p' || normalizedMessage === 'previous') {
             return {
               action: 'CREW_SELECTION_BACK',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'done' || normalizedMessage === 'd') {
             return {
               action: 'CREW_CHECK_DONE',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'create crew' || normalizedMessage.startsWith('create crew ')) {
             // Allow CREATE_CREW to be handled by its pattern matcher
             // Don't return here, let it fall through
           } else if (normalizedMessage !== 'exit' && normalizedMessage !== 'quit' && normalizedMessage !== 'stop') {
             // Invalid input in crew_selection_manage state
             return {
               action: 'INVALID_UNCLEAR_COMMAND',
               extractedData: {}
             };
           }
         }
         
         // Check for menu selection (accept any number - handler will validate range)
         if (numericMatch && currentState?.waiting_for === 'crew_management_menu') {
           const menuOption = parseInt(numericMatch[1]);
           if (menuOption >= 1) {
             return {
               action: 'CREW_MANAGEMENT_MENU_SELECTION',
               extractedData: { menu_option: menuOption }
             };
           }
         }
         
         // Check for "done" in crew_management_menu state (return to menu)
         if (currentState?.waiting_for === 'crew_management_menu') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'done') {
             return {
               action: 'CREW_CHECK_DONE',
               extractedData: {}
             };
           }
         }
         
         // Check for invalid input in crew_management_menu state (non-numeric input)
         if (currentState?.waiting_for === 'crew_management_menu' && !numericMatch) {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage !== 'exit' && normalizedMessage !== 'quit' && normalizedMessage !== 'stop' && normalizedMessage !== 'done') {
             return {
               action: 'INVALID_UNCLEAR_COMMAND',
               extractedData: {}
             };
           }
         }
         
         // Check for member removal selection (numbers, Next/N, Prev/P, Done/D)
         if (currentState?.waiting_for === 'remove_members_selection' || currentState?.waiting_for === 'remove_members_pagination') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'done' || normalizedMessage === 'd') {
             return {
               action: 'CREW_CHECK_DONE',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'prev' || normalizedMessage === 'p' || normalizedMessage === 'previous') {
             return {
               action: 'REMOVE_MEMBERS_BACK',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'next' || normalizedMessage === 'n') {
             return {
               action: 'REMOVE_MEMBERS_MORE',
               extractedData: {}
             };
           }
           // Handle multiple numbers: "1 3" or "1,3"
           const numberMatches = message.match(/\d+/g);
           if (numberMatches && numberMatches.length > 0) {
             const indices = numberMatches.map(n => parseInt(n) - 1).filter(n => n >= 0 && n < 10);
             if (indices.length > 0) {
               return {
                 action: 'REMOVE_MEMBERS_SELECTION',
                 extractedData: { member_indices: indices }
               };
             }
           }
         }
         
         
         // Check for delete crew confirmation
         if (currentState?.waiting_for === 'delete_crew_confirmation') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'delete') {
             return {
               action: 'DELETE_CREW_CONFIRM',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'done') {
             return {
               action: 'CREW_CHECK_DONE',
               extractedData: {}
             };
           }
           if (normalizedMessage === 'exit') {
             return {
               action: 'EXIT',
               extractedData: {}
             };
           }
           // Invalid input - return specific action for error handling
           return {
             action: 'DELETE_CREW_INVALID_INPUT',
             extractedData: { invalid_input: message.trim() }
           };
         }
         
         // Handle "exit" in all management states
         if (currentState?.waiting_for === 'crew_selection_manage' || 
             currentState?.waiting_for === 'crew_management_menu' ||
             currentState?.waiting_for === 'remove_members_selection' ||
             currentState?.waiting_for === 'remove_members_pagination' ||
             currentState?.waiting_for === 'rename_crew_input' ||
             currentState?.waiting_for === 'delete_crew_confirmation' ||
             // MANAGE_EVENT states
             currentState?.waiting_for === 'manage_event_selection' ||
             currentState?.waiting_for === 'event_management_menu' ||
             currentState?.waiting_for === 'event_edit_field_selection' ||
             currentState?.waiting_for === 'event_edit_field_input' ||
             currentState?.waiting_for === 'event_edit_continue_or_done' ||
             currentState?.waiting_for === 'event_edit_confirm_changes' ||
             currentState?.waiting_for === 'event_edit_resend_confirmation' ||
             currentState?.waiting_for === 'duplicate_event_name_input' ||
             currentState?.waiting_for === 'duplicate_event_date_input' ||
             currentState?.waiting_for === 'duplicate_event_time_input' ||
             currentState?.waiting_for === 'duplicate_send_invitations' ||
             currentState?.waiting_for === 'delete_event_confirmation' ||
             currentState?.waiting_for === 'delete_event_send_cancellation' ||
             currentState?.waiting_for === 'delete_event_cancellation_message') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'exit' || normalizedMessage === 'quit' || normalizedMessage === 'stop') {
             return {
               action: 'EXIT',
               extractedData: {}
             };
           }
         }
         
         // Check for numeric crew selection for SEND_INVITATIONS
         if (numericMatch && currentState?.waiting_for === 'crew_selection_for_send_invitations') {
           const crewIndex = parseInt(numericMatch[1]) - 1;
           return {
             action: 'CREW_SELECTION_SEND_INVITATIONS',
             extractedData: { crew_index: crewIndex }
           };
         }
         
         // Check for numeric event selection
         if (numericMatch && currentState?.waiting_for === 'event_selection') {
           const eventIndex = parseInt(numericMatch[1]) - 1;
           return {
             action: 'EVENT_SELECTION',
             extractedData: { event_index: eventIndex }
           };
         }
         
         // Check for invalid input when waiting for event selection (non-numeric, negative, etc.)
         if (currentState?.waiting_for === 'event_selection' && !numericMatch) {
           return {
             action: 'INVALID_EVENT_SELECTION',
             extractedData: { invalid_input: message.trim() }
           };
         }
         
        // EVENT_DETAILS_INPUT removed - progressive step-by-step workflow only
        // Users should use progressive workflow: event_name_input → event_date_input → event_location_input → event_time_input → event_notes_input
         
         // Check for EVENT_CONFIRMATION patterns (when waiting for event confirmation)
         if (currentState?.waiting_for === 'event_confirmation') {
           const normalizedMessage = message.toLowerCase().trim();
           if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm' ||
               normalizedMessage === 'yep' || normalizedMessage === 'yeah' || normalizedMessage === 'sure') {
             return {
               action: 'EVENT_CONFIRMATION_YES',
               extractedData: {}
             };
           } else if (normalizedMessage === 'no' || normalizedMessage === 'n' || normalizedMessage === 'cancel') {
             return {
               action: 'EVENT_CONFIRMATION_NO',
               extractedData: {}
             };
           }
         }
         
        // Check SEND_INVITATIONS patterns
        const sendInvitationsResult = checkSendInvitationsPattern(message);
        if (sendInvitationsResult.isMatch) {
          return {
            action: 'SEND_INVITATIONS',
            extractedData: sendInvitationsResult.extractedData
          };
        }
        
        // Check SYNC_UP patterns
        const syncUpResult = checkSyncUpPattern(message);
        if (syncUpResult.isMatch) {
          return {
            action: 'SYNC_UP',
            extractedData: {
              crewName: syncUpResult.crewName
            }
          };
        }
        
        // Check for SYNC_STATUS pattern (HOST ONLY feature)
        const syncStatusCheck = checkSyncStatusPattern(message);
        if (syncStatusCheck.isMatch) {
          return {
            action: 'CHECK_SYNC_STATUS',
            extractedData: { event_name: syncStatusCheck.eventName }
          };
        }
        
        // DUPLICATE SYNC_UP CHECKS MOVED TO TOP OF checkPatternMatches (lines 630-676)
        // Commented out to avoid confusion - priority checks are now at the top
        /*
        // Check for numeric crew selection for SYNC_UP
        if (numericMatch && currentState?.waiting_for === 'crew_selection_for_sync_up') {
          const crewIndex = parseInt(numericMatch[1]) - 1;
          return {
            action: 'CREW_SELECTION_SYNC_UP',
            extractedData: { crew_index: crewIndex }
          };
        }
        
        // _DEPRECATED: SYNC_UP_DETAILS_INPUT pattern check removed - now using progressive workflow
        // Old single-message detail collection is no longer supported
        
        // Check for SYNC_UP_CONFIRMATION patterns (when waiting for sync up confirmation)
        if (currentState?.waiting_for === 'sync_up_confirmation') {
          const normalizedMessage = message.toLowerCase().trim();
          if (normalizedMessage === 'yes' || normalizedMessage === 'y' || normalizedMessage === 'confirm' ||
              normalizedMessage === 'yep' || normalizedMessage === 'yeah' || normalizedMessage === 'sure') {
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
        */
        
       // ADD_CREW_MEMBERS patterns are now checked earlier in the function
         
         // Check INVITE_MORE_PEOPLE patterns
         const inviteMorePeopleResult = checkInviteMorePeoplePattern(message);
         if (inviteMorePeopleResult.isMatch) {
           return {
             action: 'INVITE_MORE_PEOPLE',
             extractedData: {
               event_name: inviteMorePeopleResult.eventName || null
             }
           };
         }
         
        // Check for numeric event selection for INVITE_MORE_PEOPLE
        if (currentState?.waiting_for === 'invite_more_people_event_selection') {
          if (numericMatch) {
            const eventIndex = parseInt(numericMatch[1]) - 1;
            return {
              action: 'INVITE_MORE_PEOPLE_STEP_2',
              extractedData: { event_index: eventIndex }
            };
          } else {
            // Non-numeric input - return invalid selection error
            return {
              action: 'INVITE_MORE_PEOPLE_SELECTION_ERROR',
              extractedData: { invalid_input: message.trim() }
            };
          }
        }
    // Check CHECK_CREW_MEMBERS patterns (moved to end to avoid interfering with other actions)
    const checkCrewMembersResult = await checkCheckCrewMembersPattern(message, supabase, userId);
    if (checkCrewMembersResult.isMatch) {
      return {
        action: 'CHECK_CREW_MEMBERS',
        extractedData: {
          crewName: checkCrewMembersResult.crewName
        }
      };
    }
  // Check for HELP command (only when user is idle/not in another action)
  if (!currentState?.waiting_for || currentState?.waiting_for === null || currentState?.current_state === 'normal') {
    if (checkHelpPattern(message)) {
      return { action: 'HELP', extractedData: {} };
    }
  }
  
  // Check for invalid input in post_crew_members_view state
  if (currentState?.waiting_for === 'post_crew_members_view') {
    return {
      action: 'INVALID_UNCLEAR_COMMAND',
      extractedData: {}
    };
  }
  
  // Check for invalid input in crew_management_menu state
  if (currentState?.waiting_for === 'crew_management_menu') {
    return {
      action: 'INVALID_UNCLEAR_COMMAND',
      extractedData: {}
    };
  }
  
  // Check for invalid input in crew_selection_manage state
  if (currentState?.waiting_for === 'crew_selection_manage') {
    return {
      action: 'INVALID_UNCLEAR_COMMAND',
      extractedData: {}
    };
  }
  
  return { action: null, extractedData: {} };
}

// Helper function to handle ONBOARDING_CONTINUE actions
async function handleOnboardingContinue(userId: string, extractedParams: any, supabase: any, phoneNumber?: string, substep?: number) {
  try {
    console.log('Handling ONBOARDING_CONTINUE with extracted params:', extractedParams, 'substep:', substep);
    
    // Handle crew name extraction - create new crew
    if (extractedParams.crew_name) {
      console.log('Creating new crew:', extractedParams.crew_name);
      
      const { data: crewData, error: crewError } = await supabase
        .from('crews')
        .insert({
          creator_id: userId,
          name: extractedParams.crew_name,
          description: `Crew created during onboarding`,
          crew_type: 'social',
          settings: {
            visibility: 'private',
            auto_invite_new_members: false
          }
        })
        .select('id, name')
        .single();
      
      if (crewError) {
        console.error('Error creating crew:', crewError);
        return {
          action: 'CREW_CREATION_ERROR',
          content: 'Failed to create crew. Please try again.',
          error: crewError.message
        };
      } else {
        console.log('Successfully created crew:', crewData.id);
        
        // Mark user as onboarded on first crew creation
        await supabase
          .from('profiles')
          .update({
            is_onboarded: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
        
        console.log('User marked as onboarded after first crew creation');
        
        // Wait for the trigger to complete and generate invite URL with retry logic
        console.log('Waiting for invite URL generation...');
        let inviteUrl = null;
        let retryCount = 0;
        const maxRetries = 5;
        
        while (retryCount < maxRetries && !inviteUrl) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          
          // Fetch the crew data again to get the generated invite URL
          const { data: updatedCrewData, error: fetchError } = await supabase
            .from('crews')
            .select('id, name, invite_url, invite_code')
            .eq('id', crewData.id)
            .single();
          
          if (fetchError) {
            console.error(`Error fetching crew data (attempt ${retryCount + 1}):`, fetchError);
          } else if (updatedCrewData.invite_url) {
            console.log('Fetched crew data with invite URL:', updatedCrewData.invite_url);
            inviteUrl = updatedCrewData.invite_url;
            crewData.invite_url = updatedCrewData.invite_url;
            break;
          } else {
            console.log(`Invite URL not ready yet (attempt ${retryCount + 1}/${maxRetries})`);
          }
          
          retryCount++;
        }
        
        if (!inviteUrl) {
          console.warn('Invite URL not generated after maximum retries, continuing without it');
        }
        
        // Get existing extracted_data and append new crew data
        const { data: conversationStateData } = await supabase
          .from('conversation_state')
          .select('extracted_data')
          .eq('user_id', userId)
          .single();
        
        const existingData = conversationStateData?.extracted_data || [];
        // Ensure existingData is an array
        const existingDataArray = Array.isArray(existingData) ? existingData : [];
        const extractedDataList = [...existingDataArray, {
          extracted_data: extractedParams,
          executed_data: {
            crew_id: crewData.id,
            crew_name: extractedParams.crew_name,
            action: 'CREW_CREATED',
            timestamp: new Date().toISOString()
          }
        }];
        
        // Generate crew link for the response
        // Update conversation state to member adding mode (step 2)
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'onboarding_step_2',
            onboarding_step: 2,
            waiting_for: 'member_adding_mode',
            extracted_data: extractedDataList
          })
          .eq('user_id', userId);
        
        // Send SMS response for crew creation
        if (phoneNumber) {
          const smsMessage = `${extractedParams.crew_name} created!\n\nTo add members:\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${crewData?.invite_url??""}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
          const smsResult = await sendSMS(phoneNumber, smsMessage, send_sms, phoneNumber);
          console.log('Crew creation SMS result:', smsResult);
        }
        
        // Return success message for crew creation
        return {
          action: 'CREW_CREATED',
          content: `${extractedParams.crew_name} created!\n\nTo add members:\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${crewData?.invite_url??""}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`,
          crew_id: crewData.id,
          crew_name: extractedParams.crew_name
        };
      }
    }
    
    
    // Handle member addition in "member adding mode"
    else if (extractedParams.crew_members || extractedParams.member_name || extractedParams.member_phone) {
      console.log('Handling member addition in member adding mode:', extractedParams);
      
      // Get existing conversation state to find the crew
      const { data: conversationStateData } = await supabase
        .from('conversation_state')
        .select('extracted_data')
        .eq('user_id', userId)
        .single();
      
      let crewId = null;
      let crewName = 'crew';
      
      // Extract crew info from previous extracted_data (search from end for latest)
      if (conversationStateData && conversationStateData.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
        // Search from the end of the array to find the most recent crew
        for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
          const item = conversationStateData.extracted_data[i];
          if (item.executed_data && item.executed_data.action === 'CREW_CREATED') {
            crewId = item.executed_data.crew_id;
            crewName = item.executed_data.crew_name;
            break;
          }
        }
      }
      
      // If no crew found, this is an error - should not happen
      if (!crewId) {
        console.error('No crew_id found during member adding mode - this should not happen');

          if (phoneNumber) {
          const smsMessage = 'Error: No crew found. Please start over by saying "hi".';
            const smsResult = await sendSMS(phoneNumber, smsMessage, send_sms, phoneNumber);
            console.log('Onboarding error SMS result:', smsResult);
          }
          
          return {
            action: 'ONBOARDING_ERROR',
          content: 'Error: No crew found. Please start over by saying "hi".'
          };
      }
      
      // Process crew members
      const crewMembers = extractedParams.crew_members || [];
      if (crewMembers.length === 0) {
        // Handle single member format
        if (extractedParams.member_name && extractedParams.member_phone) {
          crewMembers.push({
            name: extractedParams.member_name,
            phone: extractedParams.member_phone
          });
        }
      }
      
      if (crewMembers.length > 0) {
        const addedMembers = [];
        
        for (const member of crewMembers) {
          try {
            // Check if contact already exists
            const { data: existingContact } = await supabase
              .from('contacts')
              .select('id, first_name')
              .eq('user_id', userId)
              .eq('phone_number', member.phone)
              .single();

            let contactData;
            if (existingContact) {
              console.log('Updating existing contact name:', existingContact.id);
              // Parse the new name into first_name and last_name
              const { first_name, last_name } = parseNameIntoFirstAndLast(member.name);
              
              // Update the contact with the new name
              const { data: updatedContact, error: updateError } = await supabase
                .from('contacts')
                .update({
                  first_name: first_name,
                  last_name: last_name
                })
                .eq('id', existingContact.id)
                .select()
                .single();
              
              if (updateError) {
                console.error('Error updating contact name:', updateError);
                // Continue with existing contact if update fails
                contactData = existingContact;
              } else {
                contactData = updatedContact;
              }
            } else {
              // Create new contact record
              const { first_name, last_name } = parseNameIntoFirstAndLast(member.name);
              const { data: newContactData, error: contactError } = await supabase
                .from('contacts')
                .insert({
                  user_id: userId,
                  first_name: first_name,
                  last_name: last_name,
                  phone_number: member.phone
                })
                .select()
                .single();

              if (contactError) {
                console.error('Error creating contact:', contactError);
                continue;
              }
              contactData = newContactData;
            }

            // Create crew_members record
            const { data: memberData, error: memberError } = await supabase
              .from('crew_members')
              .insert({
                crew_id: crewId,
                contact_id: contactData.id,
                role: 'member'
              })
              .select()
              .single();
            
            if (memberError) {
              console.error('Error adding crew member:', memberError);
              continue;
            }
            
            addedMembers.push({
              contact_id: contactData.id,
              member_id: memberData.id,
              name: member.name,
              phone: member.phone
            });
            
            console.log('Successfully added crew member:', memberData.id);
          } catch (error) {
            console.error('Error processing member:', member, error);
          }
        }
        
        if (addedMembers.length > 0) {
          // Update extracted_data with member addition
          const updatedExtractedData = Array.isArray(conversationStateData?.extracted_data) ? conversationStateData.extracted_data : [];
          updatedExtractedData.push({
            extracted_data: extractedParams,
            executed_data: {
              added_members: addedMembers,
              action: 'MEMBERS_ADDED',
              timestamp: new Date().toISOString()
            }
          });
          
          // Stay in member adding mode - update conversation state
          await supabase
            .from('conversation_state')
            .update({
              current_state: 'onboarding_step_2',
              onboarding_step: 2,
              waiting_for: 'member_adding_mode',
              extracted_data: updatedExtractedData
            })
            .eq('user_id', userId);
          
          // Send SMS response confirming member addition and staying in mode
          if (phoneNumber) {
            const memberNames = addedMembers.map(m => m.name).join(', ');
            const joinLink = await getCrewJoinLink(supabase, crewId);
            const smsMessage = `Added ${memberNames} to "${crewName}".\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            const smsResult = await sendSMS(phoneNumber, smsMessage, send_sms, phoneNumber);
            console.log('Member addition SMS result:', smsResult);
          }
          
          // Return success message for member addition
          const joinLink = await getCrewJoinLink(supabase, crewId);
          return {
            action: 'MEMBERS_ADDED',
            content: `Added ${addedMembers.map(m => m.name).join(', ')} to "${crewName}".\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`,
            crew_name: crewName,
            crew_id: crewId,
            added_members: addedMembers
          };
        } else {
          return {
            action: 'MEMBER_ADDITION_ERROR',
            content: 'Failed to add crew members. Please try again.'
          };
        }
      } else {
        return {
          action: 'NO_MEMBERS_PROVIDED',
          content: 'No crew members provided. Please provide contact info like "tom +14155554321".'
        };
      }
    }
    
    
    // Unknown action - return "unknown message"
    else {
      console.log('Unknown ONBOARDING_CONTINUE action, no data extracted');
      return {
        action: 'UNKNOWN_MESSAGE',
        content: 'Unknown message'
      };
    }
    
  } catch (error) {
    console.error('Error in handleOnboardingContinue:', error);
    return {
      action: 'ONBOARDING_ERROR',
      content: 'An error occurred during onboarding. Please try again.',
      error: error.message
    };
  }
}

// Format sync up status for display
async function formatSyncUpStatus(supabase: any, syncUp: any): Promise<string> {
  // Get all sync up options
  const { data: options } = await supabase
    .from('sync_up_options')
    .select('*')
    .eq('sync_up_id', syncUp.id)
    .order('idx');
  
  // Get all responses from sync_up_responses table
  const { data: responses } = await supabase
    .from('sync_up_responses')
    .select(`
      *,
      contacts (first_name, last_name, phone_number)
    `)
    .eq('sync_up_id', syncUp.id);
  
  let status = `${syncUp.events.title} at ${syncUp.events.location} - ${syncUp.crews.name}\n\n`;
  
  // Fetch the global None option id (idx = 0), if it exists
  let noneOptionId: string | null = null;
  try {
    const { data: noneOpt } = await supabase
      .from('sync_up_options')
      .select('id')
      .eq('idx', 0)
      .maybeSingle();
    noneOptionId = noneOpt?.id || null;
  } catch (_) {}

  // Group responses by option
  const responsesByOption = new Map();
  const noResponse = [];
  const noneResponses = [];
  
  if (responses && responses.length > 0) {
    responses.forEach(resp => {
      const contactName = resp.contacts ? 
        (resp.contacts.last_name ? `${resp.contacts.first_name} ${resp.contacts.last_name}` : resp.contacts.first_name) : 
        'Unknown';
      
      if (resp.option_ids && Array.isArray(resp.option_ids) && resp.option_ids.length > 0) {
        // If explicitly selected the global None option id, count as None
        if (noneOptionId && resp.option_ids.includes(noneOptionId)) {
          noneResponses.push(contactName);
        } else {
          // Otherwise, group by selected option ids
          resp.option_ids.forEach(optionId => {
            if (!responsesByOption.has(optionId)) {
              responsesByOption.set(optionId, []);
            }
            responsesByOption.get(optionId).push(contactName);
          });
        }
      } else {
        // No selected options (including legacy response_type = 'none'): treat as No Response
        noResponse.push(contactName);
      }
    });
  }
  
  // Display each option with numbering (only those with at least 1 response)
  if (options && options.length > 0) {
    let displayIndex = 1;
    options.forEach((opt) => {
      const names = responsesByOption.get(opt.id) || [];
      const count = names.length;
      if (count === 0) return; // skip empty options
      const displayNames = count <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')}...`;
      status += `${displayIndex}. ${opt.option_text}: ${displayNames} (${count})\n`;
      displayIndex += 1;
    });
  }
  
  // Display "None" responses
  if (noneResponses.length > 0) {
    const displayNames = noneResponses.length <= 3 ? noneResponses.join(', ') : `${noneResponses.slice(0, 3).join(', ')}...`;
    status += `None: ${displayNames} (${noneResponses.length})\n`;
  }
  
  // Display no response
  if (noResponse.length > 0) {
    const displayNames = noResponse.length <= 3 ? noResponse.join(', ') : `${noResponse.slice(0, 3).join(', ')}...`;
    status += `No Response: ${displayNames} (${noResponse.length})`;
  }
  
  // Add interactive prompt
  status += `\n\nSend invites for one of these times? Reply with the option number, 'Re Sync' to send new time options, or 'exit'.`;
  
  return status;
}

// Show uninvited crew members for an event
async function showUninvitedCrewMembers(supabase: any, event: any, userId: string, phoneNumber: string, send_sms: any): Promise<string> {
  try {
    // Get event's crew_id
    const { data: eventData } = await supabase
      .from('events')
      .select('crew_id, crews(name)')
      .eq('id', event.id)
      .single();
    
    if (!eventData?.crew_id) {
      return 'Error: No crew found for this event.';
    }
    
    // Get all crew members
    const { data: crewMembers } = await supabase
      .from('crew_members')
      .select(`
        contacts (
          id,
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('crew_id', eventData.crew_id);
    
    if (!crewMembers || crewMembers.length === 0) {
      return `No members found in ${eventData.crews?.name || 'this crew'}. Type 'Add Members' to add more people or 'exit'.`;
    }
    
    // Get already invited members for this event
    const { data: invitedMembers } = await supabase
      .from('invitations')
      .select('contact_id')
      .eq('event_id', event.id);
    
    const invitedContactIds = new Set(invitedMembers?.map(inv => inv.contact_id) || []);
    
    // Filter out uninvited members
    const uninvitedMembers = crewMembers
      .filter(member => member.contacts && !invitedContactIds.has(member.contacts.id))
      .map(member => {
        const contact = member.contacts;
        return contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name;
      });
    
    const crewName = eventData.crews?.name || 'this crew';
    
    if (uninvitedMembers.length === 0) {
      // Everyone is already invited
      return `Everyone in ${crewName} is already invited to ${event.title}. Type 'Add Members' to invite more people or 'exit'.`;
    } else {
      // Show uninvited members
      const memberNames = uninvitedMembers.length <= 5 ? uninvitedMembers.join(', ') : 
        `${uninvitedMembers.slice(0, 5).join(', ')}...`;
      
      return `These people in ${crewName} haven't been invited yet: ${memberNames} (${uninvitedMembers.length}). Type 'Send Invites' to invite, 'Add Members' to add more people, or 'exit'.`;
    }
  } catch (error) {
    console.error('Error showing uninvited crew members:', error);
    return 'Error: Failed to check crew members. Please try again.';
  }
}
// Check RSVPs for a specific event with enhanced display
const checkRSVPsForEvent = async (supabase, eventId, userId, phoneNumber, send_sms) => {
  try {
    // Get event details with shorten_event_url
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, location, notes, status, shorten_event_url')
      .eq('id', eventId)
      .single();

    if (eventError || !eventData) {
      return 'Sorry, I couldn\'t find that event. Please try again.';
    }

    // Get all invitations for this event with contact details
    const { data: invitations, error: invitationsError } = await supabase
      .from('invitations')
      .select(`
        id,
        status,
        response_note,
        created_at,
        contact_id,
        contacts (
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    console.log('DEBUG: invitations query result:', { invitations, invitationsError });

    // Initialize categorized responses for all cases
    const categorizedResponses = {
      in: { names: [], total: 0, notes: [] },
      out: { names: [], total: 0, notes: [] },
      maybe: { names: [], total: 0, notes: [] },
      no_response: { names: [], total: 0, notes: [] }
    };

    // Format event details for header
    const eventDate = new Date(`${eventData.event_date}T${eventData.start_time || '00:00:00'}`);
    const formattedDate = eventDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const formattedTime = eventDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Build single-line header: "[Event Name] - [Location], [Date], [Time]"
    let rsvpResponse = `${eventData.title} - ${eventData.location || 'Location TBD'}, ${formattedDate}, ${formattedTime}\n`;

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      return 'Sorry, I couldn\'t fetch the RSVP data. Please try again.';
    } else if (!invitations || invitations.length === 0) {
      console.log('DEBUG: No invitations found for event');
      rsvpResponse += 'No invitations have been sent yet.\n\n';
      rsvpResponse += 'What would you like to do next?';
    } else {
      console.log('DEBUG: Processing invitations:', invitations.length, 'invitations found');

      // Debug: Log each invitation
      invitations.forEach((invitation, index) => {
        console.log(`DEBUG: Invitation ${index + 1}:`, {
          id: invitation.id,
          status: invitation.status,
          response_note: invitation.response_note,
          contact: invitation.contacts
        });
      });

      // Categorize responses
      const categorizedResponses = {
        in: { names: [], total: 0, notes: [] },
        out: { names: [], total: 0, notes: [] },
        maybe: { names: [], total: 0, notes: [] },
        no_response: { names: [], total: 0, notes: [] }
      };

      invitations.forEach(invitation => {
        // Skip host invitations (contact_id == null)
        if (!invitation.contact_id) {
          return;
        }
        
        const contact = invitation.contacts;
        const name = contact ? (contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name) : 'Unknown';
        const responseNote = invitation.response_note?.toLowerCase();
        
        // Only categorize based on response_note, ignore status
        if (responseNote === 'in' || responseNote === 'yes' || responseNote === '1') {
          categorizedResponses.in.names.push(name);
          categorizedResponses.in.total++;
          if (invitation.response_note && invitation.response_note !== 'in' && invitation.response_note !== 'yes' && invitation.response_note !== '1') {
            categorizedResponses.in.notes.push(`${name}: ${invitation.response_note}`);
          }
        } else if (responseNote === 'out' || responseNote === 'no' || responseNote === '2') {
          categorizedResponses.out.names.push(name);
          categorizedResponses.out.total++;
          if (invitation.response_note && invitation.response_note !== 'out' && invitation.response_note !== 'no' && invitation.response_note !== '2') {
            categorizedResponses.out.notes.push(`${name}: ${invitation.response_note}`);
          }
        } else if (responseNote === 'maybe' || responseNote === '3') {
          categorizedResponses.maybe.names.push(name);
          categorizedResponses.maybe.total++;
          if (invitation.response_note && invitation.response_note !== 'maybe' && invitation.response_note !== '3') {
            categorizedResponses.maybe.notes.push(`${name}: ${invitation.response_note}`);
          }
        } else {
          // No response_note or response_note is 'no_response' - treat as no response
          categorizedResponses.no_response.names.push(name);
          categorizedResponses.no_response.total++;
        }
      });

      // Format categorized responses with 3-name limit + total count (no emojis)
      const formatCategory = (category, label) => {
        if (category.total === 0) return '';

        const names = category.names.slice(0, 3).join(', ');
        const nameDisplay = category.total > 3 ? `${names}...` : names;

        return `${label}: ${nameDisplay} (${category.total}) `;
      };

      // Build RSVP Summary in single line format
      rsvpResponse += 'RSVP Summary: ';
      rsvpResponse += formatCategory(categorizedResponses.in, 'In');
      rsvpResponse += formatCategory(categorizedResponses.out, 'Out');
      rsvpResponse += formatCategory(categorizedResponses.maybe, 'Maybe');
      rsvpResponse += formatCategory(categorizedResponses.no_response, 'No Response');
      rsvpResponse = rsvpResponse.trim(); // Remove trailing space
      rsvpResponse += '\n';

      // Add full details link using shorten_event_url with fallback
      const eventLink = formatEventLink(eventId, eventData.shorten_event_url);
      rsvpResponse += `Full list: ${eventLink}`;
    }

    // Send SMS directly with RSVP response
    console.log('DEBUG: Sending RSVP SMS with content length:', rsvpResponse.length);

    if (phoneNumber) {
      const smsResult = await sendSMS(phoneNumber, rsvpResponse, send_sms, phoneNumber);
      console.log('RSVP SMS sent successfully:', smsResult);
    }

    // Update conversation state and reset extracted data
    await supabase
      .from('conversation_state')
      .update({
        current_event_id: eventId,
        current_state: 'check_rsvps_complete',
        waiting_for: null,
        extracted_data: []
      })
      .eq('user_id', userId);

    // Return the RSVP response content
    return rsvpResponse;

  } catch (error) {
    console.error('Error in checkRSVPsForEvent:', error);
    return 'Failed to check RSVPs. Please try again.';
  }
};

// Send message for a specific event with targeting options
const sendMessageForEvent = async (supabase, eventId, userId, phoneNumber, responseContent, shouldSendSMS) => {
  try {
    console.log('DEBUG: sendMessageForEvent called with eventId:', eventId);

    // Get event details
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, location, notes, status')
      .eq('id', eventId)
      .single();

    console.log('DEBUG: Event query result:', { eventData, eventError });

    if (eventError || !eventData) {
      console.error('DEBUG: Event not found or error:', eventError);
      responseContent = 'Sorry, I couldn\'t find that event. Please try again.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, conversationStateData: null };
    }

    // Get all invitations for this event with contact details
    const { data: invitations, error: invitationsError } = await supabase
      .from('invitations')
      .select(`
        id,
        status,
        response_note,
        created_at,
        contact_id
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    console.log('DEBUG: sendMessageForEvent - invitations query result:', { invitations, invitationsError });

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      responseContent = 'Sorry, I couldn\'t fetch the invitation data. Please try again.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, conversationStateData: null };
    }

    // Get contact details for invitations that have contact_id
    const contactIds = invitations
      .map(inv => inv.contact_id)
      .filter(id => id !== null);

    let contactMap = {};
    if (contactIds.length > 0) {
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone_number')
        .in('id', contactIds);

      if (!contactsError && contacts) {
        contactMap = contacts.reduce((acc, contact) => {
          acc[contact.id] = contact;
          return acc;
        }, {});
      }
    }

    // Filter out host invitations and get valid contacts
    const validInvitations = invitations
      .filter(invitation => invitation.contact_id && contactMap[invitation.contact_id])
      .map(invitation => ({
        ...invitation,
        contacts: contactMap[invitation.contact_id]
      }));
    console.log('DEBUG: Valid invitations count:', validInvitations.length);

    if (validInvitations.length === 0) {
      console.log('DEBUG: No valid invitations found');
      responseContent = 'No valid contacts found for this event. Please invite some people first.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, conversationStateData: null };
    }

    // Calculate targeting options
    const targetingOptionsData = {
      everyone: validInvitations.length,
      non_responders: validInvitations.filter(inv => inv.status === 'sent' || (inv.status === 'failed' && inv.response_note === 'no_response')).length,
      coming: validInvitations.filter(inv => inv.response_note === 'in' || inv.response_note === 'yes' || inv.response_note === '1').length,
      maybe: validInvitations.filter(inv => inv.response_note === 'maybe' || inv.response_note === '3').length,
      out: validInvitations.filter(inv => inv.response_note === 'out' || inv.response_note === 'no' || inv.response_note === '2').length
    };

    // Show targeting options (simplified phrasing as requested)
    const targetingOptions = `Who should we message?\n\n1) Everyone\n2) Non-responders\n3) Coming (In!)\n4) Maybe\n5) Can't come (Out)\n\nReply with the number.`;

    console.log('DEBUG: Setting targeting options, length:', targetingOptions.length);
    responseContent = targetingOptions;
    shouldSendSMS = true;

    // Update conversation state for targeting selection
    console.log('DEBUG: Updating conversation state for targeting selection');
    await supabase
      .from('conversation_state')
      .update({
        current_state: 'send_message_step_2',
        waiting_for: 'targeting_selection',
        extracted_data: [
          {
            action: 'SEND_MESSAGE',
            substep: 2,
            event_id: eventId,
            event_title: eventData.title,
            event_date: eventData.event_date,
            event_time: eventData.start_time,
            event_location: eventData.location,
            available_invitations: validInvitations.map(inv => ({
              id: inv.id,
              status: inv.status,
              response_note: inv.response_note,
              contacts: inv.contacts
            })),
            targeting_options: targetingOptionsData
          }
        ]
      })
      .eq('user_id', userId);

    console.log('DEBUG: Conversation state updated successfully');

    // Get the updated current state to return
    const { data: updatedState } = await supabase
      .from('conversation_state')
      .select('current_state, waiting_for, extracted_data')
      .eq('user_id', userId)
      .single();

    return { responseContent, shouldSendSMS, conversationStateData: updatedState };

  } catch (error) {
    console.error('Error in sendMessageForEvent:', error);
    responseContent = 'Failed to process message targeting. Please try again.';
    shouldSendSMS = true;
    return { responseContent, shouldSendSMS, conversationStateData: null };
  }
};
Deno.serve(async (req) => {
  const startTime = Date.now();
  console.log(`🚀 [${new Date().toISOString()}] Request started`);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  // Ensure it's a POST request
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    // Parse request body
    const parseTime = Date.now();
    const { message, phone_number, model = 'gpt-4o-mini', is_host = true, send_sms = true } = await req.json();
    console.log(`📝 [${Date.now() - startTime}ms] Request parsed`);
    console.log(`🔍 DEBUG: is_host=${is_host}, send_sms=${send_sms}, message="${message}", phone_number="${phone_number}"`);

    // Initialize response variables early
    let responseContent = '';
    let shouldSendSMS = send_sms; // Use the send_sms parameter from request

    // Validate input
    if (!message) {
      return new Response(JSON.stringify({
        error: 'Message is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );
if (is_host === true) {   
    // Initialize userId and isOnboarded before pattern matching
    let userId = null;
    let isOnboarded = false;
    
    // Quick user lookup for pattern matching
    if (phone_number) {
      const normalizedPhone = phone_number.replace(/\D/g, '');
      const phoneVariations = [normalizedPhone];
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      const plusVariations = phoneVariations.map(phone => '+' + phone);
      phoneVariations.push(...plusVariations);
      
      const { data } = await supabase
        .from('profiles')
        .select('id, is_onboarded')
        .in('phone_number', phoneVariations)
        .limit(1);
      
      if (data && data.length > 0) {
        userId = data[0].id;
        isOnboarded = data[0].is_onboarded === true;
      }
    }
    
    // Store incoming user message in message_thread when send_sms=false
    if (userId && !send_sms) {
      await supabase
        .from('message_thread')
        .insert({
          user_id: userId,
          phone_number: phone_number,
          message: message,
          role: 'user',
          sent: false,
          sent_at: null
        });
      console.log('User message saved to message_thread (send_sms=false)');
    }
    
    // Get current conversation state for pattern matching
    let conversationState = null;
    let isInOnboarding = false;
    if (userId) {
      const { data: stateData, error: stateError } = await supabase
        .from('conversation_state')
        .select('current_state, onboarding_step, waiting_for, extracted_data')
        .eq('user_id', userId)
        .maybeSingle(); // Use maybeSingle() instead of single() to handle null gracefully
      
      if (stateError && stateError.code !== 'PGRST116') { // PGRST116 = no rows returned (expected)
        console.error('Error fetching conversation state:', stateError);
      }
      
      conversationState = stateData || null;
      console.log('🔍 Retrieved conversation state:', { 
        current_state: conversationState?.current_state, 
        waiting_for: conversationState?.waiting_for,
        has_extracted_data: !!conversationState?.extracted_data,
        full_state: conversationState
      });
      
      if (conversationState && conversationState.current_state?.startsWith('onboarding_')) {
        isInOnboarding = true;
        console.log('User is in onboarding workflow, skipping pattern matching');
      }
    }
    
    // Get user crew count for onboarding optimization
    let userCrewCount = 0;
    if (userId) {
      const { count } = await supabase
        .from('crews')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', userId);
      userCrewCount = count || 0;
    }
    
    // SEPARATE LOGIC FOR HOSTS VS CREW MEMBERS
    console.log(`🔍 Processing request: is_host=${is_host}, message="${message}"`);
    
    // Check if this message should skip usage tracking (applies to both hosts and crew members)
    const skipUsageTracking = isSkippableMessage(message);
    
    // CREW MEMBER LOGIC (is_host = false)

    
    // HOST LOGIC (is_host = true)
    // OPTIMIZATION: Check for pattern matches first (bypass AI for common commands)
    console.log('🔍 Calling checkPatternMatches with:', { 
      message, 
      conversationState: conversationState ? {
        waiting_for: conversationState.waiting_for,
        current_state: conversationState.current_state,
        has_extracted_data: !!conversationState.extracted_data
      } : 'null',
      isOnboarded,
      userCrewCount 
    });
    const patternResult = await checkPatternMatches(message, conversationState, isOnboarded, userCrewCount, supabase, userId);
    console.log('🔍 Pattern result:', patternResult);
    
    // Handle MESSAGE_TOO_LONG immediately (before other checks, regardless of userId)
    if (patternResult.action === 'MESSAGE_TOO_LONG') {
      responseContent = 'That message is too long. Try again or type \'menu\' to see what you can do.';
      shouldSendSMS = true;
      await sendSMS(phone_number, responseContent, send_sms, phone_number);
      
      return new Response(JSON.stringify({
        success: true,
        action: 'MESSAGE_TOO_LONG',
        response: responseContent,
        optimization: 'pattern_matching'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Check usage limits for substantive interactions only (skip for simple navigation/casual responses)
    // TEMPORARILY DISABLED FOR TESTING
    if (false && !skipUsageTracking) {
      console.log('🔒 Checking AI usage limits before processing...');
      
      try {
        const usageLimitResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-usage-limits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            phone_number: phone_number,
            action_type: 'ai_interaction'
          })
        });
        
        const usageLimitData = await usageLimitResponse.json();
        
        if (!usageLimitData.allowed) {
          console.log('❌ Usage limit exceeded:', usageLimitData);
          
          const upgradeMessage = usageLimitData.upgrade_message || 
            "You've been organizing a lot this month! Upgrade for more fun: funlet.ai/upgrade";
          
          await sendSMS(phone_number, upgradeMessage, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'USAGE_LIMIT_REACHED',
            response: upgradeMessage,
            plan: usageLimitData.plan,
            usage: usageLimitData.usage,
            limits: usageLimitData.limits,
            limit_exceeded: usageLimitData.limit_exceeded
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        console.log('✅ Usage check passed:', usageLimitData);
      } catch (error) {
        console.error('⚠️ Error checking usage limits:', error);
        // Continue processing on error (fail open)
      }
    }
    
    // Allow pattern matching for specific onboarding actions (crew name input, member addition, etc.)
    const allowPatternMatching = true;
    if (patternResult.action && userId && allowPatternMatching) {
      console.log(`${patternResult.action} detected via pattern matching, bypassing AI`);
      const action = patternResult.action;
      const extractedData = patternResult.extractedData;
      
      // Handle MESSAGE_TOO_LONG action first (before other actions)
      if (action === 'MESSAGE_TOO_LONG') {
        responseContent = 'That message is too long. Try again or type \'menu\' to see what you can do.';
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        
        return new Response(JSON.stringify({
          success: true,
          action: 'MESSAGE_TOO_LONG',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Handle CREATE_CREW action directly
      if (action === 'CREATE_CREW') {
        const crewName = extractedData.crew_name;
        
        if (!crewName) {
          responseContent = 'What should we name your crew?';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          // Update conversation state to wait for crew name (use upsert to create if doesn't exist)
          console.log(`🔄 Updating conversation state for user ${userId} to wait for crew name`);
          const { data: updateData, error: updateError } = await supabase
            .from('conversation_state')
            .upsert({
              user_id: userId,
              phone_number: phone_number,
              current_state: 'normal',
              onboarding_step: null,
              waiting_for: 'crew_name_input',
              last_action: 'CREATE_CREW',
              last_action_timestamp: new Date().toISOString()
            }, {
              onConflict: 'user_id'
            });
          
          if (updateError) {
            console.error(`❌ Error updating conversation state:`, updateError);
          } else {
            console.log(`✅ Conversation state updated successfully:`, updateData);
          }
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CREATE_CREW',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Validate crew name length and characters
        if (crewName.length < 2) {
          responseContent = 'Crew name must be at least 2 characters long. Please provide a valid crew name.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CREATE_CREW',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else if (crewName.length > 50) {
          responseContent = 'Crew name must be 50 characters or less. Please provide a shorter name.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CREATE_CREW',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else {
          // Create crew immediately (allow duplicate names)
          const { data: crewData, error: crewError } = await supabase
            .from('crews')
            .insert({
              creator_id: userId,
              name: crewName,
              description: `Crew created via CREATE_CREW command`,
              crew_type: 'social',
              settings: {
                visibility: 'private',
                auto_invite_new_members: false
              }
            })
            .select('id, name')
            .single();

          if (crewError) {
            console.error('Error creating crew:', crewError);
            
            const responseContent = 'Failed to create crew. Please try again.';
            
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            
            return new Response(JSON.stringify({
              success: true,
              action: 'CREATE_CREW',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
              console.log('Successfully created crew:', crewData.id);
              
              // Wait for invite URL generation
              let inviteUrl = null;
              let retryCount = 0;
              const maxRetries = 5;
              
              while (retryCount < maxRetries && !inviteUrl) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const { data: updatedCrewData, error: fetchError } = await supabase
                  .from('crews')
                  .select('id, name, invite_url, invite_code')
                  .eq('id', crewData.id)
                  .single();
                
                if (!fetchError && updatedCrewData.invite_url) {
                  inviteUrl = updatedCrewData.invite_url;
                  break;
                }
                retryCount++;
              }
              
              // Update conversation state to member adding mode
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'onboarding_step_2',
                  onboarding_step: 2,
                  waiting_for: 'member_adding_mode',
                  extracted_data: [{
                    extracted_data: { crew_name: crewName },
                    executed_data: {
                      action: 'CREW_CREATED',
                      crew_id: crewData.id,
                      crew_name: crewName,
                      timestamp: new Date().toISOString()
                    }
                  }],
                  last_action: 'CREW_CREATED',
                  last_action_timestamp: new Date().toISOString()
                })
                .eq('user_id', userId);
              
              responseContent = `${crewName} created!\n\nTo add members:\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${inviteUrl || ''}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'CREATE_CREW',
                response: responseContent,
                optimization: 'pattern_matching',
                crew_created: {
                  id: crewData.id,
                  name: crewName,
                  invite_url: inviteUrl
                }
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
          }
        }
      } else if (action === 'ONBOARDING_START') {
        console.log('ONBOARDING_START detected via pattern matching, bypassing AI');
        
        // Start onboarding workflow
        responseContent = 'Welcome to Funlet! Let\'s create your first crew. What should we name it?';
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        
        // Update conversation state to onboarding step 1
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'onboarding_step_1',
            onboarding_step: 1,
            waiting_for: 'crew_name_input',
            last_action: 'ONBOARDING_START',
            last_action_timestamp: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        return new Response(JSON.stringify({
          success: true,
          action: 'ONBOARDING_START',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (action === 'ONBOARDING_CONTINUE') {
        console.log('ONBOARDING_CONTINUE detected via pattern matching, bypassing AI');
        
        // Use the existing handleOnboardingContinue function
        const onboardingResult = await handleOnboardingContinue(userId, extractedData, supabase, phone_number);
        
        if (onboardingResult) {
          responseContent = onboardingResult.content;
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: onboardingResult.action,
            response: responseContent,
            optimization: 'pattern_matching',
            ...onboardingResult
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'CHECK_RSVPS') {
        console.log('CHECK_RSVPS detected via pattern matching, bypassing AI');
        
        try {
          const eventName = extractedData.event_name;
          
          // Get user's recent events
          const { data: recentEvents, error: eventsError } = await supabase
            .from('events')
            .select('id, title, event_date, start_time, location, status')
            .eq('creator_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(5);

          if (eventsError) {
            console.error('Error fetching events:', eventsError);
            responseContent = 'Sorry, I couldn\'t fetch your events. Please try again.';
            shouldSendSMS = true;
          } else if (recentEvents && recentEvents.length > 0) {
            // If event name was provided, try to find a matching event
            if (eventName) {
              const matchingEvent = recentEvents.find(event => 
                event.title.toLowerCase().includes(eventName.toLowerCase()) ||
                eventName.toLowerCase().includes(event.title.toLowerCase())
              );
              
              if (matchingEvent) {
                // Auto-select the matching event and show RSVP details
                responseContent = await checkRSVPsForEvent(supabase, matchingEvent.id, userId, phone_number, send_sms);
                shouldSendSMS = true;
                
                // Clear conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: null,
                    current_state: 'normal',
                    extracted_data: [],
                    last_action: null,
                    last_action_timestamp: null
                  })
                  .eq('user_id', userId);
              } else {
                // Event name not found, show available events
                responseContent = `I couldn't find an event matching "${eventName}". Here are your events:\n\n`;
                let eventsList = '';
                recentEvents.forEach((event, index) => {
                  const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
                  const formattedDate = eventDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  });
                  eventsList += `${index + 1}. ${event.title} - ${formattedDate}\n`;
                });
                eventsList += '\nReply with the event number or \'exit\'';
                responseContent += eventsList;
                shouldSendSMS = true;

                // Update conversation state to wait for event selection
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'event_selection',
                    current_state: 'check_rsvps_step_1',
                    extracted_data: [
                      {
                        action: 'CHECK_RSVPS',
                        substep: 1,
                        available_events: recentEvents.map(e => ({ id: e.id, title: e.title }))
                      }
                    ]
                  })
                  .eq('user_id', userId);
              }
            } else {
              // No event name provided - check if only one event exists for auto-selection
              if (recentEvents.length === 1) {
                // Auto-select the only event and show RSVP details
                const onlyEvent = recentEvents[0];
                responseContent = await checkRSVPsForEvent(supabase, onlyEvent.id, userId, phone_number, send_sms);
                shouldSendSMS = true;

                // Clear conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: null,
                    current_state: 'normal',
                    extracted_data: [],
                    last_action: null,
                    last_action_timestamp: null
                  })
                  .eq('user_id', userId);
              } else {
                // Multiple events - show event list for selection
                let eventsList = 'Which event?\n\n';
                recentEvents.forEach((event, index) => {
                  const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
                  const formattedDate = eventDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  });
                  eventsList += `${index + 1}. ${event.title} - ${formattedDate}\n`;
                });
                eventsList += '\nReply with the event number or \'exit\'';

                responseContent = eventsList;
                shouldSendSMS = true;

                // Update conversation state to wait for event selection
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'event_selection',
                    current_state: 'check_rsvps_step_1',
                    extracted_data: [
                      {
                        action: 'CHECK_RSVPS',
                        substep: 1,
                        available_events: recentEvents.map(e => ({ id: e.id, title: e.title }))
                      }
                    ]
                  })
                  .eq('user_id', userId);
              }
            }
          } else {
            responseContent = 'No events found. Type \'Create Event\' to create your first event.';
            shouldSendSMS = true;
          }
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CHECK_RSVPS',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in CHECK_RSVPS pattern matching:', error);
          responseContent = 'Failed to check RSVPs. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CHECK_RSVPS',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'MANAGE_EVENT') { //#Manage_Event - Manage your events
        console.log('MANAGE_EVENT detected via pattern matching');
        
        try {
          const eventName = extractedData.event_name; // This should now preserve case from checkManageEventPattern
          
          // Get user's events (only creator's own events, not invited events)
          // Order by soonest upcoming first
          const { data: userEvents, error: eventsError } = await supabase
            .from('events')
            .select('id, title, event_date, start_time, location, status')
            .eq('creator_id', userId)
            .eq('status', 'active')
            .gte('event_date', new Date().toISOString().split('T')[0])
            .order('event_date', { ascending: true })
            .order('start_time', { ascending: true });
          
          if (eventsError) {
            console.error('Error fetching events:', eventsError);
            responseContent = 'Sorry, I couldn\'t fetch your events. Please try again.';
            shouldSendSMS = true;
          } else if (!userEvents || userEvents.length === 0) {
            responseContent = 'No events found. Type \'Create Event\' to make your first event.';
            shouldSendSMS = true;
            
            // Clear state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                current_state: 'normal',
                extracted_data: []
              })
              .eq('user_id', userId);
          } else if (userEvents.length === 1) {
            // Auto-select the only event
            responseContent = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, userEvents[0].id, phone_number);
            shouldSendSMS = true;
          } else if (eventName) {
            // Find all events matching the name (case-insensitive comparison)
            const matchingEvents = userEvents.filter(e => 
              e.title.toLowerCase() === eventName.toLowerCase()
            );
            
            if (matchingEvents.length === 1) {
              // Only one match - auto-select it
              responseContent = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, matchingEvents[0].id, phone_number);
              shouldSendSMS = true;
            } else if (matchingEvents.length >= 2) {
              // Multiple matches - show list of matching events
              const page = 0;
              const pageSize = 5;
              const totalEvents = matchingEvents.length;
              const eventsOnPage = matchingEvents.slice(page * pageSize, (page + 1) * pageSize);
              
              // Use original eventName from user input (preserve case)
              let eventList = `Found ${totalEvents} event${totalEvents === 1 ? '' : 's'} named "${eventName}".\n\nWhich one would you like to manage?\n\n`;
              eventsOnPage.forEach((event, index) => {
                const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
                const formattedDate = eventDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                eventList += `${index + 1}. ${event.title} — ${formattedDate}`;
                if (event.location) {
                  eventList += ` (${event.location})`;
                }
                eventList += '\n';
              });
              
              const hasMore = totalEvents > (page + 1) * pageSize;
              const hasPrevious = page > 0;
              eventList += '\n';
              
              // Build prompt with conditional pagination
              if (eventsOnPage.length < pageSize) {
                eventList += `Reply with a number (1-${eventsOnPage.length})`;
              } else {
                eventList += 'Reply with a number (1-5)';
              }
              
              // Only show pagination actions if available
              if (hasMore && hasPrevious) {
                eventList += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
              } else if (hasMore) {
                eventList += ', \'Next\' or \'N\' for the next 5';
              } else if (hasPrevious) {
                eventList += ', \'Prev\' or \'P\' for the previous 5';
              }
              eventList += ', \'Done\' or \'D\' to return to menu, or \'exit\'.';
              
              responseContent = eventList;
              shouldSendSMS = true;
              
              // Save state with pagination
              await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number,
                  waiting_for: 'manage_event_selection',
                  current_state: 'manage_event_selection',
                  extracted_data: [{
                    action: 'MANAGE_EVENT',
                    current_page: page,
                    event_list: matchingEvents.map(e => ({ id: e.id, title: e.title, event_date: e.event_date, start_time: e.start_time, location: e.location })),
                    timestamp: new Date().toISOString()
                  }]
                }, {
                  onConflict: 'user_id'
                });
            } else {
              // No exact match - show paginated list
              const page = 0;
              const pageSize = 5;
              const totalEvents = userEvents.length;
              const eventsOnPage = userEvents.slice(page * pageSize, (page + 1) * pageSize);
              
              let eventList = `You have ${totalEvents} upcoming event${totalEvents === 1 ? '' : 's'}.\n\nWhich event would you like to manage?\n\n`;
              eventsOnPage.forEach((event, index) => {
                const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
                const formattedDate = eventDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                eventList += `${index + 1}. ${event.title} — ${formattedDate}`;
                if (event.location) {
                  eventList += ` (${event.location})`;
                }
                eventList += '\n';
              });
              
              const hasMore = totalEvents > (page + 1) * pageSize;
              const hasPrevious = page > 0;
              eventList += '\n';
              
              // Build prompt with conditional pagination
              if (eventsOnPage.length < pageSize) {
                eventList += `Reply with a number (1-${eventsOnPage.length})`;
              } else {
                eventList += 'Reply with a number (1-5)';
              }
              
              // Only show pagination actions if available
              if (hasMore && hasPrevious) {
                eventList += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
              } else if (hasMore) {
                eventList += ', \'Next\' or \'N\' for the next 5';
              } else if (hasPrevious) {
                eventList += ', \'Prev\' or \'P\' for the previous 5';
              }
              eventList += ', \'Done\' or \'D\' to return to menu, or \'exit\'.';
              
              responseContent = eventList;
              shouldSendSMS = true;
              
              // Save state with pagination
              await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number,
                  waiting_for: 'manage_event_selection',
                  current_state: 'manage_event_selection',
                  extracted_data: [{
                    action: 'MANAGE_EVENT',
                    current_page: page,
                    event_list: userEvents.map(e => ({ id: e.id, title: e.title, event_date: e.event_date, start_time: e.start_time, location: e.location })),
                    timestamp: new Date().toISOString()
                  }]
                }, {
                  onConflict: 'user_id'
                });
            }
          } else {
            // No event name - show paginated list
            const page = 0;
            const pageSize = 5;
            const totalEvents = userEvents.length;
            const eventsOnPage = userEvents.slice(page * pageSize, (page + 1) * pageSize);
            
            let eventList = `You have ${totalEvents} upcoming event${totalEvents === 1 ? '' : 's'}.\n\nWhich event would you like to manage?\n\n`;
            eventsOnPage.forEach((event, index) => {
              const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
              const formattedDate = eventDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              });
              eventList += `${index + 1}. ${event.title} — ${formattedDate}`;
              if (event.location) {
                eventList += ` (${event.location})`;
              }
              eventList += '\n';
            });
            
            const hasMore = totalEvents > (page + 1) * pageSize;
            eventList += '\n';
            if (hasMore) {
              eventList += 'Reply with a number (1-5), \'More\' to see the next 5, or \'exit\'.';
            } else {
              eventList += `Reply with a number (1-${eventsOnPage.length}), or \'exit\'.`;
            }
            
            responseContent = eventList;
            shouldSendSMS = true;
            
            // Save state with pagination
            await supabase
              .from('conversation_state')
              .upsert({
                user_id: userId,
                phone_number: phone_number,
                waiting_for: 'manage_event_selection',
                current_state: 'manage_event_selection',
                extracted_data: [{
                  action: 'MANAGE_EVENT',
                  current_page: page,
                  event_list: userEvents.map(e => ({ id: e.id, title: e.title, event_date: e.event_date, start_time: e.start_time, location: e.location })),
                  timestamp: new Date().toISOString()
                }]
              }, {
                onConflict: 'user_id'
              });
          }
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in MANAGE_EVENT:', error);
          responseContent = 'Failed to manage event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'MANAGE_EVENT_SELECTION') {
        console.log('MANAGE_EVENT_SELECTION detected via pattern matching');
        
        try {
          const eventIndex = extractedData?.event_index;
          
          // Get event list and current page from conversation state
          const eventList = conversationState?.extracted_data?.[0]?.event_list || [];
          const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
          const pageSize = 5;
          
          // Calculate the actual index in the full list
          const actualIndex = (currentPage * pageSize) + eventIndex;
          
          if (eventIndex < 0 || eventIndex >= pageSize || actualIndex < 0 || actualIndex >= eventList.length) {
            // Invalid selection - show error message only (don't re-display list)
            const hasMore = eventList.length > (currentPage + 1) * pageSize;
            const hasPrevious = currentPage > 0;
            if (hasMore && hasPrevious) {
              responseContent = 'I didn\'t understand that. Reply with a number (1–5), \'Next\' or \'N\', \'Prev\' or \'P\', \'Done\' or \'D\', or \'exit\'.';
            } else if (hasMore) {
              responseContent = 'I didn\'t understand that. Reply with a number (1–5), \'Next\' or \'N\', \'Done\' or \'D\', or \'exit\'.';
            } else if (hasPrevious) {
              const eventsOnPage = eventList.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
              responseContent = `I didn't understand that. Reply with a number (1–${eventsOnPage.length}), 'Prev' or 'P', 'Done' or 'D', or 'exit'.`;
            } else {
              const eventsOnPage = eventList.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
              responseContent = `I didn't understand that. Reply with a number (1–${eventsOnPage.length}), 'Done' or 'D', or 'exit'.`;
            }
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'MANAGE_EVENT_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const selectedEvent = eventList[actualIndex];
          
          // Show event details and menu
          responseContent = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, selectedEvent.id, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_SELECTION',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in MANAGE_EVENT_SELECTION:', error);
          responseContent = 'Failed to select event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_SELECTION',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'MANAGE_EVENT_MORE') {
        console.log('MANAGE_EVENT_MORE detected via pattern matching');
        
        try {
          // Get event list and current page
          const eventList = conversationState?.extracted_data?.[0]?.event_list || [];
          const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
          const pageSize = 5;
          const totalEvents = eventList.length;
          const newPage = currentPage + 1;
          
          // Check if there are more events
          if (newPage * pageSize >= totalEvents) {
            responseContent = 'No more events to show.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'MANAGE_EVENT_MORE',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const eventsOnPage = eventList.slice(newPage * pageSize, (newPage + 1) * pageSize);
          
          let eventListText = `You have ${totalEvents} upcoming event${totalEvents === 1 ? '' : 's'}.\n\nWhich event would you like to manage?\n\n`;
          eventsOnPage.forEach((event, index) => {
            const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
            const formattedDate = eventDate.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
            eventListText += `${index + 1}. ${event.title} — ${formattedDate}`;
            if (event.location) {
              eventListText += ` (${event.location})`;
            }
            eventListText += '\n';
          });
          
          const hasMore = totalEvents > (newPage + 1) * pageSize;
          const hasPrevious = newPage > 0;
          eventListText += '\n';
          
          // Build prompt with conditional pagination
          if (eventsOnPage.length < pageSize) {
            eventListText += `Reply with a number (1-${eventsOnPage.length})`;
          } else {
            eventListText += 'Reply with a number (1-5)';
          }
          
          // Only show pagination actions if available
          if (hasMore && hasPrevious) {
            eventListText += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
          } else if (hasMore) {
            eventListText += ', \'Next\' or \'N\' for the next 5';
          } else if (hasPrevious) {
            eventListText += ', \'Prev\' or \'P\' for the previous 5';
          }
          eventListText += ', \'Done\' or \'D\' to return to menu, or \'exit\'.';
          
          responseContent = eventListText;
          shouldSendSMS = true;
          
          // Update page in conversation state
          await supabase
            .from('conversation_state')
            .update({
              extracted_data: [{
                action: 'MANAGE_EVENT',
                current_page: newPage,
                event_list: eventList,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_MORE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in MANAGE_EVENT_MORE:', error);
          responseContent = 'Failed to load more events. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_MORE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'MANAGE_EVENT_BACK') {
        console.log('MANAGE_EVENT_BACK detected via pattern matching');
        
        try {
          // Get event list and current page
          const eventList = conversationState?.extracted_data?.[0]?.event_list || [];
          const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
          const pageSize = 5;
          const totalEvents = eventList.length;
          const newPage = currentPage - 1;
          
          // Check if we can go back
          if (newPage < 0) {
            responseContent = 'You\'re already on the first page.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'MANAGE_EVENT_BACK',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          const eventsOnPage = eventList.slice(newPage * pageSize, (newPage + 1) * pageSize);
          
          let eventListText = `You have ${totalEvents} upcoming event${totalEvents === 1 ? '' : 's'}.\n\nWhich event would you like to manage?\n\n`;
          eventsOnPage.forEach((event, index) => {
            const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
            const formattedDate = eventDate.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
            eventListText += `${index + 1}. ${event.title} — ${formattedDate}`;
            if (event.location) {
              eventListText += ` (${event.location})`;
            }
            eventListText += '\n';
          });
          
          const hasMore = totalEvents > (newPage + 1) * pageSize;
          const hasPrevious = newPage > 0;
          eventListText += '\n';
          
          // Build prompt with conditional pagination
          if (eventsOnPage.length < pageSize) {
            eventListText += `Reply with a number (1-${eventsOnPage.length})`;
          } else {
            eventListText += 'Reply with a number (1-5)';
          }
          
          // Only show pagination actions if available
          if (hasMore && hasPrevious) {
            eventListText += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
          } else if (hasMore) {
            eventListText += ', \'Next\' or \'N\' for the next 5';
          } else if (hasPrevious) {
            eventListText += ', \'Prev\' or \'P\' for the previous 5';
          }
          eventListText += ', \'Done\' or \'D\' to return to menu, or \'exit\'.';
          
          responseContent = eventListText;
          shouldSendSMS = true;
          
          // Update page in conversation state
          await supabase
            .from('conversation_state')
            .update({
              extracted_data: [{
                action: 'MANAGE_EVENT',
                current_page: newPage,
                event_list: eventList,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_BACK',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in MANAGE_EVENT_BACK:', error);
          responseContent = 'Failed to go back. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_BACK',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'MANAGE_EVENT_DONE') {
        console.log('MANAGE_EVENT_DONE detected via pattern matching');
        
        try {
          // Return to main menu by clearing the event selection state
          // This effectively ends the MANAGE_EVENT flow and returns to normal state
          responseContent = 'What would you like to do next?';
          shouldSendSMS = true;
          
          // Clear conversation state to return to normal
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: [],
              last_action: 'MANAGE_EVENT_DONE',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_DONE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in MANAGE_EVENT_DONE:', error);
          responseContent = 'Failed to return to menu. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'MANAGE_EVENT_DONE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_MANAGEMENT_MENU_SELECTION') {
        console.log('EVENT_MANAGEMENT_MENU_SELECTION detected via pattern matching');
        
        try {
          const menuOption = extractedData?.menu_option;
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Validate menu option range (1-5)
          if (menuOption < 1 || menuOption > 5) {
            // Invalid selection - show error message only (don't re-display menu)
            responseContent = 'I didn\'t understand that. Reply with a number (1–5), or type \'exit\'.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          if (menuOption === 1) {
            // Edit Event Details
            responseContent = `What would you like to change? (name/date/time/location/notes)`;
            shouldSendSMS = true;
            
            // Update state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'event_edit_field_selection',
                current_state: 'event_edit_field_selection',
                extracted_data: [{
                  action: 'EDIT_EVENT',
                  event_id: eventId,
                  event_title: eventTitle,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (menuOption === 2) {
            // Invite More People - trigger INVITE_MORE_PEOPLE flow with event and crew pre-selected
            // Get full event data with crews relation (same format as INVITE_MORE_PEOPLE expects)
            const { data: eventData, error: eventError } = await supabase
              .from('events')
              .select(`
                id,
                title,
                event_date,
                start_time,
                location,
                crews (id, name)
              `)
              .eq('id', eventId)
              .single();
            
            if (eventError || !eventData) {
              responseContent = 'Event not found. Please try again.';
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_MANAGEMENT_MENU_SELECTION',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Call showUninvitedCrewMembers (same as INVITE_MORE_PEOPLE does)
            responseContent = await showUninvitedCrewMembers(supabase, eventData, userId, phone_number, send_sms);
            shouldSendSMS = true;
            
            // Set conversation state exactly like INVITE_MORE_PEOPLE does when event is selected
            let waitingFor = null;
            if (responseContent.includes("haven't been invited yet")) {
              waitingFor = 'send_invites_or_add_members';
            } else if (responseContent.includes("already invited") || responseContent.includes("No members found")) {
              waitingFor = 'add_members_or_exit';
            }
            
            if (waitingFor) {
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: waitingFor,
                  current_state: 'invite_more_people_step_2',
                  extracted_data: [{
                    action: 'INVITE_MORE_PEOPLE',
                    event_id: eventData.id,
                    event_title: eventData.title,
                    crew_id: eventData.crews?.id,
                    crew_name: eventData.crews?.name,
                    timestamp: new Date().toISOString()
                  }]
                })
                .eq('user_id', userId);
            } else {
              // Clear conversation state if no specific waiting state
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: null,
                  current_state: 'normal',
                  extracted_data: []
                })
                .eq('user_id', userId);
            }
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (menuOption === 3) {
            // Duplicate Event
            responseContent = `What should we call the new event? Type a new name or 'same' to keep '${eventTitle}'.`;
            shouldSendSMS = true;
            
            // Update state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'duplicate_event_name_input',
                current_state: 'duplicate_event_name_input',
                extracted_data: [{
                  action: 'DUPLICATE_EVENT',
                  source_event_id: eventId,
                  source_event_title: eventTitle,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (menuOption === 4) {
            // Delete Event
            responseContent = `Delete '${eventTitle}'? Type 'delete' to confirm or 'exit' to stop.`;
            shouldSendSMS = true;
            
            // Update state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'delete_event_confirmation',
                current_state: 'delete_event_confirmation',
                extracted_data: [{
                  action: 'DELETE_EVENT',
                  event_id: eventId,
                  event_title: eventTitle,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (menuOption === 5) {
            // Exit
            responseContent = 'What would you like to do next?';
            shouldSendSMS = true;
            
            // Clear state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                current_state: 'normal',
                extracted_data: []
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_MANAGEMENT_MENU_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Error in EVENT_MANAGEMENT_MENU_SELECTION:', error);
          responseContent = 'Failed to process menu selection. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_MANAGEMENT_MENU_SELECTION',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_FIELD_SELECTED') {
        console.log('EVENT_EDIT_FIELD_SELECTED detected via pattern matching');
        
        try {
          const field = extractedData?.field;
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Get current value
          const { data: eventData } = await supabase
            .from('events')
            .select('title, event_date, start_time, end_time, location, notes')
            .eq('id', eventId)
            .single();
          
          let currentValue = '';
          if (field === 'name') currentValue = eventData.title;
          else if (field === 'date') currentValue = formatEventDate(eventData.event_date);
          else if (field === 'time') currentValue = formatEventTime(eventData.start_time, eventData.end_time);
          else if (field === 'location') currentValue = eventData.location || 'Not set';
          else if (field === 'notes') currentValue = eventData.notes || 'Not set';
          
          responseContent = `Current ${field}: ${currentValue}\n\n`;
          responseContent += `Enter the new ${field}:`;
          shouldSendSMS = true;
          
          // Update state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'event_edit_field_input',
              extracted_data: [{
                action: 'EDIT_EVENT',
                event_id: eventId,
                event_title: eventTitle,
                field: field,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_FIELD_SELECTED',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_FIELD_SELECTED:', error);
          responseContent = 'Failed to select field. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_FIELD_SELECTED',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_FIELD_INPUT') {
        console.log('EVENT_EDIT_FIELD_INPUT detected via pattern matching');
        
        try {
          const value = extractedData?.value;
          const field = conversationState?.extracted_data?.[0]?.field;
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Validate the input based on field type
          let validatedValue = value;
          
          if (field === 'date') {
            // Use convertDayNameToDate to parse natural language dates
            const parsedDateStr = convertDayNameToDate(value);
            let inputDate: Date;
            
            // Check if convertDayNameToDate returned a YYYY-MM-DD format or the original string
            if (/^\d{4}-\d{2}-\d{2}$/.test(parsedDateStr)) {
              // It's a valid YYYY-MM-DD date
              inputDate = new Date(parsedDateStr + 'T00:00:00');
              validatedValue = parsedDateStr; // Store as YYYY-MM-DD
            } else {
              // Try parsing as-is
              inputDate = new Date(parsedDateStr);
              if (isNaN(inputDate.getTime())) {
                responseContent = "I didn't understand that. Enter a new date or type 'exit'.";
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'EVENT_EDIT_FIELD_INPUT',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              // Convert to YYYY-MM-DD format
              validatedValue = inputDate.toISOString().split('T')[0];
            }
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            inputDate.setHours(0, 0, 0, 0);
            
            if (inputDate <= today) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_EDIT_FIELD_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else if (field === 'time') {
            // Parse time - handle formats like "7pm", "7:00 PM", "19:00"
            let timeValue = value.trim();
            const timeMatch = timeValue.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
            
            if (timeMatch) {
              let hours = parseInt(timeMatch[1]);
              const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
              const ampm = timeMatch[3]?.toLowerCase();
              
              if (ampm) {
                // 12-hour format
                if (ampm === 'pm' && hours !== 12) hours += 12;
                if (ampm === 'am' && hours === 12) hours = 0;
              }
              
              if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                validatedValue = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
              } else {
                responseContent = "I didn't understand that. Enter a new time or type 'exit'.";
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'EVENT_EDIT_FIELD_INPUT',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(timeValue)) {
              // Already in HH:MM or HH:MM:SS format
              validatedValue = timeValue.length === 5 ? `${timeValue}:00` : timeValue;
            } else {
              responseContent = "I didn't understand that. Enter a new time or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_EDIT_FIELD_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Validate combined date/time is in future
            const eventIdForTime = conversationState?.extracted_data?.[0]?.event_id;
            const { data: currentEventDataForTime } = await supabase
              .from('events')
              .select('event_date')
              .eq('id', eventIdForTime)
              .single();
            
            const dateToUse = conversationState?.extracted_data?.[0]?.pending_changes?.date || currentEventDataForTime?.event_date;
            if (dateToUse) {
              try {
                const eventDateTime = new Date(`${dateToUse}T${validatedValue}`);
                const now = new Date();
                if (isNaN(eventDateTime.getTime()) || eventDateTime <= now) {
                  responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: 'EVENT_EDIT_FIELD_INPUT',
                    response: responseContent,
                    optimization: 'pattern_matching'
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
              } catch (error) {
                // If validation fails, continue - the date validation will catch it
              }
            }
          } else if (field === 'notes') {
            if (value.length > 160) {
              responseContent = "Notes are too long. Keep it under 160 characters.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_EDIT_FIELD_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else if (field === 'name') {
            if (!value || value.trim().length < 2) {
              responseContent = "I didn't understand that. Enter a new name or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_EDIT_FIELD_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else if (field === 'location') {
            if (!value || value.trim().length < 2) {
              responseContent = "I didn't understand that. Enter a new location or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EVENT_EDIT_FIELD_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
          
          // Stage the changes (don't save to database yet)
          const existingPendingChanges = conversationState?.extracted_data?.[0]?.pending_changes || {};
          const updatedPendingChanges = { ...existingPendingChanges, [field]: validatedValue };
          
          // Track which fields have been edited
          const existingEditedFields = conversationState?.extracted_data?.[0]?.edited_fields || [];
          const updatedEditedFields = [...existingEditedFields];
          if (!updatedEditedFields.includes(field)) {
            updatedEditedFields.push(field);
          }
          
          // Ask if they want to edit another field (per spec)
          responseContent = `What would you like to change? (name/date/time/location/notes)`;
          shouldSendSMS = true;
          
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'event_edit_continue_or_done',
              extracted_data: [{
                action: 'EDIT_EVENT',
                event_id: eventId,
                event_title: eventTitle,
                edited_fields: updatedEditedFields,
                pending_changes: updatedPendingChanges,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_FIELD_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_FIELD_INPUT:', error);
          responseContent = 'Failed to save changes. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_FIELD_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'INVALID_EVENT_EDIT_FIELD_SELECTION') {
        console.log('INVALID_EVENT_EDIT_FIELD_SELECTION detected via pattern matching');
        
        responseContent = `I didn't understand that. Type one of: name, date, time, location, notes — or 'exit'.`;
        shouldSendSMS = true;
        
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID_EVENT_EDIT_FIELD_SELECTION',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (action === 'INVALID_EVENT_EDIT_CONTINUE') {
        console.log('INVALID_EVENT_EDIT_CONTINUE detected via pattern matching');
        
        responseContent = `I didn't understand that. Edit another field? (name/date/time/location/notes) or type 'Done'`;
        shouldSendSMS = true;
        
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID_EVENT_EDIT_CONTINUE',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (action === 'EVENT_EDIT_DONE') {
        console.log('EVENT_EDIT_DONE detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          const editedFields = conversationState?.extracted_data?.[0]?.edited_fields || [];
          const pendingChanges = conversationState?.extracted_data?.[0]?.pending_changes || {};
          
          if (editedFields.length === 0) {
            // No changes made
            responseContent = `No changes to save.\n\n`;
            const menuDisplay = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, eventId, phone_number);
            responseContent += menuDisplay;
            shouldSendSMS = true;
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_EDIT_DONE',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Show summary of pending changes
          responseContent = `Review your changes:\n\n`;
          for (const field of editedFields) {
            const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
            responseContent += `• ${fieldLabel}: ${pendingChanges[field]}\n`;
          }
          responseContent += `\nSave these changes? Reply 'yes' to confirm or 'no' to cancel.`;
          shouldSendSMS = true;
          
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'event_edit_confirm_changes',
              extracted_data: [{
                action: 'EDIT_EVENT',
                event_id: eventId,
                event_title: eventTitle,
                edited_fields: editedFields,
                pending_changes: pendingChanges,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_DONE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_DONE:', error);
          responseContent = 'Failed to prepare changes. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_DONE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_CONFIRM_CHANGES') {
        console.log('EVENT_EDIT_CONFIRM_CHANGES detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          const editedFields = conversationState?.extracted_data?.[0]?.edited_fields || [];
          const pendingChanges = conversationState?.extracted_data?.[0]?.pending_changes || {};
          
          // Build update data from pending changes
          const updateData: any = {};
          for (const field of editedFields) {
            const value = pendingChanges[field];
            if (field === 'name') {
              updateData.title = value;
            } else if (field === 'date') {
              updateData.event_date = value;
            } else if (field === 'time') {
              updateData.start_time = value.length === 5 ? `${value}:00` : value;
            } else if (field === 'location') {
              updateData.location = value;
            } else if (field === 'notes') {
              updateData.notes = value;
            }
          }
          
          // Update the event in database
          const { error: updateError } = await supabase
            .from('events')
            .update(updateData)
            .eq('id', eventId);
          
          if (updateError) {
            console.error('Error updating event:', updateError);
            responseContent = 'Failed to save changes. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_EDIT_CONFIRM_CHANGES',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Check if any edited fields require resending invitations
          const resendFields = ['name', 'date', 'time', 'location'];
          const needsResend = editedFields.some((field: string) => resendFields.includes(field));
          
          if (needsResend) {
            // Ask if they want to resend invitations
            responseContent = `All changes saved!\n\n`;
            responseContent += `Would you like to send updated invitations to all guests? Reply 'yes' or 'no'.`;
            shouldSendSMS = true;
            
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'event_edit_resend_confirmation',
                extracted_data: [{
                  action: 'EDIT_EVENT',
                  event_id: eventId,
                  event_title: eventTitle,
                  edited_fields: editedFields,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_EDIT_CONFIRM_CHANGES',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            // No resend needed, show menu again
            responseContent = `All changes saved!\n\n`;
            const menuDisplay = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, eventId, phone_number);
            responseContent += menuDisplay;
            shouldSendSMS = true;
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'EVENT_EDIT_CONFIRM_CHANGES',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Error in EVENT_EDIT_CONFIRM_CHANGES:', error);
          responseContent = 'Failed to save changes. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_CONFIRM_CHANGES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_CANCEL_CHANGES') {
        console.log('EVENT_EDIT_CANCEL_CHANGES detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          
          // Discard changes and return to menu
          responseContent = `Changes cancelled.\n\n`;
          const menuDisplay = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, eventId, phone_number);
          responseContent += menuDisplay;
          shouldSendSMS = true;
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_CANCEL_CHANGES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_CANCEL_CHANGES:', error);
          responseContent = 'Failed to cancel. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_CANCEL_CHANGES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_RESEND_YES') {
        console.log('EVENT_EDIT_RESEND_YES detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          
          // Get all invitations for this event
          const { data: invitations } = await supabase
            .from('invitations')
            .select('id, contact_id, contacts(phone_number, first_name)')
            .eq('event_id', eventId);
          
          if (invitations && invitations.length > 0) {
            responseContent = `Sending updated invitations to ${invitations.length} guest${invitations.length === 1 ? '' : 's'}...\n\n`;
            // In production, would actually send SMS invitations here
          } else {
            responseContent = 'No invitations found for this event.\n\n';
          }
          
          // Show menu again
          const menuDisplay = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, eventId, phone_number);
          responseContent += menuDisplay;
          shouldSendSMS = true;
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_RESEND_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_RESEND_YES:', error);
          responseContent = 'Failed to send invitations. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_RESEND_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'EVENT_EDIT_RESEND_NO') {
        console.log('EVENT_EDIT_RESEND_NO detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          
          // Show menu again
          responseContent = await showEventDetailsAndMenu(supabase, userId, phone_number, send_sms, eventId, phone_number);
          shouldSendSMS = true;
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_RESEND_NO',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in EVENT_EDIT_RESEND_NO:', error);
          responseContent = 'Failed to return to menu. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'EVENT_EDIT_RESEND_NO',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_EVENT_SAME_NAME' || action === 'DUPLICATE_EVENT_NAME_INPUT') {
        console.log(`${action} detected via pattern matching`);
        
        try {
          const sourceEventId = conversationState?.extracted_data?.[0]?.source_event_id;
          const sourceEventTitle = conversationState?.extracted_data?.[0]?.source_event_title;
          
          let newEventName;
          if (action === 'DUPLICATE_EVENT_SAME_NAME') {
            newEventName = sourceEventTitle;
          } else {
            newEventName = extractedData?.name;
          }
          
          responseContent = `Enter the new date (e.g., Fri Nov 21).`;
          shouldSendSMS = true;
          
          // Update state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'duplicate_event_date_input',
              extracted_data: [{
                action: 'DUPLICATE_EVENT',
                source_event_id: sourceEventId,
                source_event_title: sourceEventTitle,
                new_event_name: newEventName,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error(`Error in ${action}:`, error);
          responseContent = 'Failed to process name. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_EVENT_NAME_INVALID_INPUT') {
        console.log('DUPLICATE_EVENT_NAME_INVALID_INPUT detected via pattern matching');
        
        try {
          responseContent = "I didn't understand that. Reply 'same' or type a new name – or type 'exit'.";
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_NAME_INVALID_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DUPLICATE_EVENT_NAME_INVALID_INPUT:', error);
          responseContent = 'Failed to process input. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_NAME_INVALID_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_EVENT_DATE_INPUT') {
        console.log('DUPLICATE_EVENT_DATE_INPUT detected via pattern matching');
        
        try {
          const dateValue = extractedData?.date;
          const newEventName = conversationState?.extracted_data?.[0]?.new_event_name;
          const sourceEventId = conversationState?.extracted_data?.[0]?.source_event_id;
          
          // Check for explicit year in the input (e.g., "Jan 1 2024", "Nov 1 2024")
          const yearMatch = dateValue.match(/\b(19|20)\d{2}\b/);
          if (yearMatch) {
            const explicitYear = parseInt(yearMatch[0]);
            const currentYear = new Date().getFullYear();
            if (explicitYear < currentYear) {
              // Explicit past year - reject immediately
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
          
          // Use convertDayNameToDate to parse natural language dates (same as Update Event)
          const parsedDateStr = convertDayNameToDate(dateValue);
          
          // Get today's date string in YYYY-MM-DD format (UTC) for comparison
          const now = new Date();
          const todayDateStr = now.toISOString().split('T')[0];
          
          // Validate immediately: check if parsed date string is in YYYY-MM-DD format
          let validatedValue: string;
          if (/^\d{4}-\d{2}-\d{2}$/.test(parsedDateStr)) {
            // It's a valid YYYY-MM-DD date - compare date strings directly
            if (parsedDateStr <= todayDateStr) {
              // Date is today or in the past - reject immediately
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Additional validation: ensure the date is actually in the future (not just today)
            // Create a date object at start of the parsed date (midnight UTC)
            const parsedDate = new Date(parsedDateStr + 'T00:00:00Z');
            if (isNaN(parsedDate.getTime()) || parsedDate <= now) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            validatedValue = parsedDateStr; // Store as YYYY-MM-DD
          } else {
            // Try parsing as-is to convert to YYYY-MM-DD
            // For dates with explicit years, parse in UTC to avoid timezone issues
            let inputDate: Date;
            if (/\b(19|20)\d{2}\b/.test(parsedDateStr)) {
              // Date has explicit year - parse carefully to avoid timezone issues
              // Create date at noon UTC to avoid day shift
              const tempDate = new Date(parsedDateStr + ' UTC');
              if (isNaN(tempDate.getTime())) {
                // Try parsing as local time if UTC fails
                inputDate = new Date(parsedDateStr);
              } else {
                inputDate = tempDate;
              }
            } else {
              inputDate = new Date(parsedDateStr);
            }
            
            if (isNaN(inputDate.getTime())) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Convert to YYYY-MM-DD format using UTC date components to avoid timezone shift
            const year = inputDate.getUTCFullYear();
            const month = String(inputDate.getUTCMonth() + 1).padStart(2, '0');
            const day = String(inputDate.getUTCDate()).padStart(2, '0');
            validatedValue = `${year}-${month}-${day}`;
            
            // Validate the converted date string is in the future
            if (validatedValue <= todayDateStr) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
            
            // Additional validation: ensure the date is actually in the future (not just today)
            // Create a date object at start of the parsed date (midnight UTC)
            const parsedDate = new Date(validatedValue + 'T00:00:00Z');
            if (isNaN(parsedDate.getTime()) || parsedDate <= now) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
          
          responseContent = `Enter the new time (e.g., 7:00 PM).`;
          shouldSendSMS = true;
          
          // Update state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'duplicate_event_time_input',
              extracted_data: [{
                action: 'DUPLICATE_EVENT',
                source_event_id: sourceEventId,
                new_event_name: newEventName,
                new_event_date: validatedValue,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_DATE_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DUPLICATE_EVENT_DATE_INPUT:', error);
          responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_DATE_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_EVENT_TIME_INPUT') {
        console.log('DUPLICATE_EVENT_TIME_INPUT detected via pattern matching');
        
        try {
          const timeValue = extractedData?.time;
          const newEventName = conversationState?.extracted_data?.[0]?.new_event_name;
          const newEventDate = conversationState?.extracted_data?.[0]?.new_event_date;
          const sourceEventId = conversationState?.extracted_data?.[0]?.source_event_id;
          
          // Parse time - handle formats like "7pm", "7:00 PM", "19:00" (same as Update Event)
          let validatedTime = timeValue.trim();
          const timeMatch = validatedTime.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
          
          if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const ampm = timeMatch[3]?.toLowerCase();
            
            if (ampm) {
              // 12-hour format
              if (ampm === 'pm' && hours !== 12) hours += 12;
              if (ampm === 'am' && hours === 12) hours = 0;
            }
            
            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
              validatedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
            } else {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_TIME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(validatedTime)) {
            // Already in HH:MM or HH:MM:SS format - validate hours and minutes
            const parts = validatedTime.split(':');
            const hours = parseInt(parts[0]);
            const minutes = parseInt(parts[1]);
            
            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
              validatedTime = validatedTime.length === 5 ? `${validatedTime}:00` : validatedTime;
            } else {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_TIME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else {
            responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DUPLICATE_EVENT_TIME_INPUT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Validate combined date/time is in future (same as Update Event)
          try {
            const eventDateTime = new Date(`${newEventDate}T${validatedTime}`);
            const now = new Date();
            if (isNaN(eventDateTime.getTime()) || eventDateTime <= now) {
              responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'DUPLICATE_EVENT_TIME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } catch (error) {
            responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DUPLICATE_EVENT_TIME_INPUT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Get source event data
          const { data: sourceEvent, error: sourceError } = await supabase
            .from('events')
            .select('*')
            .eq('id', sourceEventId)
            .single();
          
          if (sourceError || !sourceEvent) {
            responseContent = 'Source event not found. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DUPLICATE_EVENT_TIME_INPUT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Format confirmation message per spec (don't create event yet - only when user says yes)
          const eventDate = new Date(`${newEventDate}T${validatedTime}`);
          const formattedDate = eventDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          });
          const formattedTime = eventDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          
          responseContent = `New event: ${newEventName} on ${formattedDate}, ${formattedTime} at ${sourceEvent.location || 'TBD'}.\n\n`;
          responseContent += `Send invitations now? Reply 'yes' or 'no'.`;
          
          // Update state with event details (don't create event yet)
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'duplicate_send_invitations',
              extracted_data: [{
                action: 'DUPLICATE_EVENT',
                source_event_id: sourceEventId,
                new_event_name: newEventName,
                new_event_date: newEventDate,
                new_event_time: validatedTime,
                new_event_location: sourceEvent.location,
                new_event_notes: sourceEvent.notes,
                new_event_crew_id: sourceEvent.crew_id,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_TIME_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DUPLICATE_EVENT_TIME_INPUT:', error);
          responseContent = "Date/time must be in the future. Enter a new value or type 'exit'.";
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_EVENT_TIME_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_SEND_INVITATIONS_YES') {
        console.log('DUPLICATE_SEND_INVITATIONS_YES detected via pattern matching');
        
        try {
          // Get event details from conversation state
          const eventData = conversationState?.extracted_data?.[0];
          const newEventName = eventData?.new_event_name;
          const newEventDate = eventData?.new_event_date;
          const validatedTime = eventData?.new_event_time;
          const newEventLocation = eventData?.new_event_location;
          const newEventNotes = eventData?.new_event_notes;
          const newEventCrewId = eventData?.new_event_crew_id;
          
          // Create the event now (only when user says yes)
          const { data: newEvent, error: createError } = await supabase
            .from('events')
            .insert({
              title: newEventName,
              event_date: newEventDate,
              start_time: validatedTime,
              location: newEventLocation,
              notes: newEventNotes,
              crew_id: newEventCrewId, // Copy crew_id from source event
              creator_id: userId,
              status: 'active'
            })
            .select()
            .single();
          
          if (createError || !newEvent) {
            console.error('Error creating duplicate event:', createError);
            responseContent = 'Failed to create event. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DUPLICATE_SEND_INVITATIONS_YES',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Check if event has a crew_id before calling send-invitations
          if (!newEvent.crew_id) {
            // Event doesn't have a crew, so no invitations to send
            const { shorten_event_url, event: eventData } = await fetchEventWithShortUrl(supabase, newEvent.id);
            const eventLink = formatEventLink(newEvent.id, shorten_event_url);
            
            // Format date and time
            let dateStr = '';
            let timeStr = '';
            
            if (eventData && eventData.event_date) {
              const eventDate = new Date(eventData.event_date + 'T00:00:00');
              dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }
            
            if (eventData && eventData.start_time) {
              const [hours, minutes] = eventData.start_time.split(':').map(Number);
              const timeDate = new Date();
              timeDate.setHours(hours, minutes, 0, 0);
              timeStr = timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            }
            
            responseContent = `Event created: ${eventData?.title || newEvent.title} on ${dateStr} at ${timeStr}. No crew found to send invitations to. Check RSVPs: ${eventLink}`;
          } else {
            // Call send-invitations edge function to send SMS invitations
            const inviteResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                event_id: newEvent.id,
                inviting_user_id: userId,
                crew_id: newEvent.crew_id,
                send_sms: send_sms
              })
            });
            
            const inviteResult = await inviteResponse.json();
            console.log('send-invitations response:', inviteResult);
            
            // Check if invitations were processed successfully
            const invitationsProcessed = inviteResult.message === 'Invitations processed' || inviteResult.results || inviteResult.success;
            
            if (invitationsProcessed) {
              // Count successful invitations from results array
              const successfulInvites = inviteResult.results ? inviteResult.results.filter((r: any) => r.status === 'success' || r.status === 'sent').length : 0;
              const totalInvites = inviteResult.results ? inviteResult.results.length : 0;
              
              // Fetch event with shorten_event_url
              const { shorten_event_url, event: eventData } = await fetchEventWithShortUrl(supabase, newEvent.id);
              const eventLink = formatEventLink(newEvent.id, shorten_event_url);
              
              // Format date and time
              let dateStr = '';
              let timeStr = '';
              
              if (eventData && eventData.event_date) {
                const eventDate = new Date(eventData.event_date + 'T00:00:00');
                dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              }
              
              if (eventData && eventData.start_time) {
                const [hours, minutes] = eventData.start_time.split(':').map(Number);
                const timeDate = new Date();
                timeDate.setHours(hours, minutes, 0, 0);
                timeStr = timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              }
              
              // Use successful count if available, otherwise use total count
              const invitesSent = successfulInvites > 0 ? successfulInvites : (totalInvites > 0 ? totalInvites : 0);
              responseContent = `${invitesSent} invites sent for ${eventData?.title || newEvent.title} on ${dateStr} at ${timeStr}. Check RSVPs: ${eventLink}`;
            } else {
              console.error('send-invitations returned unsuccessful result:', inviteResult);
              const errorMessage = inviteResult.error || inviteResult.message || 'Unknown error';
              responseContent = `Failed to send invitations: ${errorMessage}. Please try again.`;
            }
          }
          
          // Clear state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: []
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_SEND_INVITATIONS_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DUPLICATE_SEND_INVITATIONS_YES:', error);
          responseContent = 'Failed to send invitations. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_SEND_INVITATIONS_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DUPLICATE_SEND_INVITATIONS_NO') {
        console.log('DUPLICATE_SEND_INVITATIONS_NO detected via pattern matching');
        
        try {
          // Get event details from conversation state
          const eventData = conversationState?.extracted_data?.[0];
          const newEventName = eventData?.new_event_name;
          const newEventDate = eventData?.new_event_date;
          const validatedTime = eventData?.new_event_time;
          const newEventLocation = eventData?.new_event_location;
          const newEventNotes = eventData?.new_event_notes;
          const newEventCrewId = eventData?.new_event_crew_id;
          
          // Create the event but don't send invitations
          const { data: newEvent, error: createError } = await supabase
            .from('events')
            .insert({
              title: newEventName,
              event_date: newEventDate,
              start_time: validatedTime,
              location: newEventLocation,
              notes: newEventNotes,
              crew_id: newEventCrewId, // Copy crew_id from source event
              creator_id: userId,
              status: 'active'
            })
            .select()
            .single();
          
          if (createError || !newEvent) {
            console.error('Error creating duplicate event:', createError);
            responseContent = 'Failed to create event. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DUPLICATE_SEND_INVITATIONS_NO',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Get event link for confirmation
          const { shorten_event_url, event: eventDataWithUrl } = await fetchEventWithShortUrl(supabase, newEvent.id, userId);
          const eventLink = formatEventLink(newEvent.id, shorten_event_url);
          
          // Format date and time
          let dateStr = '';
          let timeStr = '';
          
          if (eventDataWithUrl && eventDataWithUrl.event_date) {
            const eventDate = new Date(eventDataWithUrl.event_date + 'T00:00:00');
            dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          }
          
          if (eventDataWithUrl && eventDataWithUrl.start_time) {
            const [hours, minutes] = eventDataWithUrl.start_time.split(':').map(Number);
            const timeDate = new Date();
            timeDate.setHours(hours, minutes, 0, 0);
            timeStr = timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          }
          
          responseContent = `Got it. Invitations not sent. Action ends.`;
          
          // Clear state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: []
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_SEND_INVITATIONS_NO',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DUPLICATE_SEND_INVITATIONS_NO:', error);
          responseContent = 'Failed to complete. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DUPLICATE_SEND_INVITATIONS_NO',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_INVALID_INPUT') {
        console.log('DELETE_EVENT_INVALID_INPUT detected via pattern matching');
        
        try {
          responseContent = `I didn't understand that. Type 'delete' to confirm or 'exit'.`;
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_INVALID_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DELETE_EVENT_INVALID_INPUT:', error);
          responseContent = 'Failed to process input. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_INVALID_INPUT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_CONFIRMED') {
        console.log('DELETE_EVENT_CONFIRMED detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Check if there are any invitations
          const { data: invitations } = await supabase
            .from('invitations')
            .select('id')
            .eq('event_id', eventId);
          
          if (invitations && invitations.length > 0) {
            // Ask if they want to send cancellation message
            responseContent = `Would you like to send a cancellation message to invitees? Reply 'yes' or 'no'.`;
            shouldSendSMS = true;
            
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'delete_event_send_cancellation',
                extracted_data: [{
                  action: 'DELETE_EVENT',
                  event_id: eventId,
                  event_title: eventTitle,
                  invitation_count: invitations.length,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DELETE_EVENT_CONFIRMED',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            // No invitations, just delete the event
            const { error: deleteError } = await supabase
              .from('events')
              .update({ status: 'cancelled' })
              .eq('id', eventId);
            
            if (deleteError) {
              console.error('Error deleting event:', deleteError);
              responseContent = 'Failed to delete event. Please try again.';
            } else {
              responseContent = `Event "${eventTitle}" has been deleted.`;
            }
            
            // Clear state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                current_state: 'normal',
                extracted_data: []
              })
              .eq('user_id', userId);
            
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'DELETE_EVENT_CONFIRMED',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Error in DELETE_EVENT_CONFIRMED:', error);
          responseContent = 'Failed to delete event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_CONFIRMED',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_SEND_CANCELLATION_YES') {
        console.log('DELETE_EVENT_SEND_CANCELLATION_YES detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          responseContent = `Type a short message to include (or type 'skip' to send without a note).`;
          shouldSendSMS = true;
          
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: 'delete_event_cancellation_message',
              extracted_data: [{
                action: 'DELETE_EVENT',
                event_id: eventId,
                event_title: eventTitle,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_SEND_CANCELLATION_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DELETE_EVENT_SEND_CANCELLATION_YES:', error);
          responseContent = 'Failed to process. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_SEND_CANCELLATION_YES',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_SEND_CANCELLATION_NO') {
        console.log('DELETE_EVENT_SEND_CANCELLATION_NO detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Delete all invitations
          await supabase
            .from('invitations')
            .delete()
            .eq('event_id', eventId);
          
          // Mark event as cancelled
          const { error: deleteError } = await supabase
            .from('events')
            .update({ status: 'cancelled' })
            .eq('id', eventId);
          
          if (deleteError) {
            console.error('Error deleting event:', deleteError);
            responseContent = 'Failed to delete event. Please try again.';
          } else {
            responseContent = `Event deleted. No cancellation messages were sent. Action ends.`;
          }
          
          // Clear state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: []
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error(`Error in ${action}:`, error);
          responseContent = 'Failed to delete event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_CANCELLATION_SKIP') {
        console.log('DELETE_EVENT_CANCELLATION_SKIP detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          
          // Get all invitations
          const { data: invitations } = await supabase
            .from('invitations')
            .select('id, contact_id, contacts(phone_number, first_name)')
            .eq('event_id', eventId);
          
          let sentCount = 0;
          let failedCount = 0;
          
          if (invitations && invitations.length > 0) {
            // Send standard cancellation message
            const messageToSend = `"${eventTitle}" has been canceled.`;
            
            // Send cancellation messages to all invitees
            for (const invitation of invitations) {
              if (invitation.contact_id && invitation.contacts && invitation.contacts.phone_number) {
                try {
                  const contactPhone = invitation.contacts.phone_number;
                  const contactName = invitation.contacts.first_name || 'there';
                  
                  // Personalize message if we have a name
                  const personalizedMessage = contactName !== 'there' 
                    ? `Hi ${contactName}, ${messageToSend}` 
                    : messageToSend;
                  
                  await sendSMS(contactPhone, personalizedMessage, send_sms, phone_number);
                  sentCount++;
                } catch (error) {
                  console.error(`Failed to send cancellation to ${invitation.contacts?.phone_number}:`, error);
                  failedCount++;
                }
              }
            }
            
            // Build response message
            if (sentCount > 0) {
              responseContent = `Event deleted. Sent cancellation to ${sentCount} invitee${sentCount === 1 ? '' : 's'}. Action ends.`;
              if (failedCount > 0) {
                responseContent += ` (${failedCount} failed)`;
              }
            } else {
              responseContent = `Event deleted. Failed to send cancellation messages. Action ends.`;
            }
          } else {
            responseContent = `Event "${eventTitle}" has been deleted.`;
          }
          
          // Delete all invitations
          await supabase
            .from('invitations')
            .delete()
            .eq('event_id', eventId);
          
          // Mark event as cancelled
          const { error: deleteError } = await supabase
            .from('events')
            .update({ status: 'cancelled' })
            .eq('id', eventId);
          
          if (deleteError) {
            console.error('Error deleting event:', deleteError);
            responseContent = 'Failed to delete event. Please try again.';
          }
          
          // Clear state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: []
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error(`Error in ${action}:`, error);
          responseContent = 'Failed to delete event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: action,
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'DELETE_EVENT_CANCELLATION_MESSAGE') {
        console.log('DELETE_EVENT_CANCELLATION_MESSAGE detected via pattern matching');
        
        try {
          const eventId = conversationState?.extracted_data?.[0]?.event_id;
          const eventTitle = conversationState?.extracted_data?.[0]?.event_title;
          const cancellationMessage = extractedData?.message;
          
          // Get all invitations
          const { data: invitations } = await supabase
            .from('invitations')
            .select('id, contact_id, contacts(phone_number, first_name)')
            .eq('event_id', eventId);
          
          let sentCount = 0;
          let failedCount = 0;
          
          if (invitations && invitations.length > 0) {
            // Build cancellation message
            const messageToSend = cancellationMessage && cancellationMessage.trim() !== 'skip' 
              ? cancellationMessage.trim() 
              : `"${eventTitle}" has been canceled.`;
            
            // Send cancellation messages to all invitees
            for (const invitation of invitations) {
              if (invitation.contact_id && invitation.contacts && invitation.contacts.phone_number) {
                try {
                  const contactPhone = invitation.contacts.phone_number;
                  const contactName = invitation.contacts.first_name || 'there';
                  
                  // Personalize message if we have a name
                  const personalizedMessage = contactName !== 'there' 
                    ? `Hi ${contactName}, ${messageToSend}` 
                    : messageToSend;
                  
                  await sendSMS(contactPhone, personalizedMessage, send_sms, phone_number);
                  sentCount++;
                } catch (error) {
                  console.error(`Failed to send cancellation to ${invitation.contacts?.phone_number}:`, error);
                  failedCount++;
                }
              }
            }
            
            // Build response message
            if (sentCount > 0) {
              responseContent = `Event deleted. Sent cancellation to ${sentCount} invitee${sentCount === 1 ? '' : 's'}`;
              if (cancellationMessage && cancellationMessage.trim() !== 'skip') {
                responseContent += ` with your note.`;
              } else {
                responseContent += `.`;
              }
              responseContent += ` Action ends.`;
              if (failedCount > 0) {
                responseContent += ` (${failedCount} failed)`;
              }
            } else {
              responseContent = `Event deleted. Failed to send cancellation messages. Action ends.`;
            }
          } else {
            responseContent = `Event "${eventTitle}" has been deleted.`;
          }
          
          // Delete all invitations
          await supabase
            .from('invitations')
            .delete()
            .eq('event_id', eventId);
          
          // Mark event as cancelled (or delete it entirely)
          const { error: deleteError } = await supabase
            .from('events')
            .update({ status: 'cancelled' })
            .eq('id', eventId);
          
          if (deleteError) {
            console.error('Error deleting event:', deleteError);
            responseContent = 'Failed to delete event. Please try again.';
          }
          
          // Clear state
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              current_state: 'normal',
              extracted_data: []
            })
            .eq('user_id', userId);
          
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_CANCELLATION_MESSAGE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in DELETE_EVENT_CANCELLATION_MESSAGE:', error);
          responseContent = 'Failed to delete event. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'DELETE_EVENT_CANCELLATION_MESSAGE',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
             } else if (action === 'CREW_SELECTION') {
               console.log('CREW_SELECTION detected via pattern matching, bypassing AI');
               
               try {
                 const crewIndex = extractedData.crew_index;
                 
                 // Get the crew list from the most recent CREW_LIST_SHOWN action
                 let crewList = null;
                 if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                   for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationState.extracted_data[i];
                     if (item.action === 'CREW_LIST_SHOWN' && item.crew_list) {
                       crewList = item.crew_list;
                       break;
                     }
                   }
                 }
                 
                 if (!crewList || crewIndex < 0 || crewIndex >= crewList.length) {
                   responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
                   shouldSendSMS = true;
                 } else {
                   const selectedCrew = crewList[crewIndex];
                   
                   // Update conversation state to member adding mode
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'member_adding_mode',
                       current_state: 'normal',
                       extracted_data: [
                         ...(conversationState?.extracted_data || []),
                         {
                           action: 'CREW_SELECTED',
                           crew_id: selectedCrew.id,
                           crew_name: selectedCrew.name,
                           timestamp: new Date().toISOString()
                         }
                       ]
                     })
                     .eq('user_id', userId);
                   
                   responseContent = `Add members to ${selectedCrew.name} by texting member info (eg. Tom 4155551234). When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION pattern matching:', error);
                 responseContent = 'Failed to select crew. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_SELECTION_CHECK_MEMBERS') {
               console.log('CREW_SELECTION_CHECK_MEMBERS detected via pattern matching, bypassing AI');
               
               try {
                 const crewIndex = extractedData.crew_index;
                 
                 // Get the crew list from the most recent CHECK_CREW_MEMBERS action
                 let crewList = null;
                 if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                   for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationState.extracted_data[i];
                     if (item.action === 'CHECK_CREW_MEMBERS' && item.available_crews) {
                       crewList = item.available_crews;
                       break;
                     }
                   }
                 }
                 
                 if (!crewList || crewIndex < 0 || crewIndex >= crewList.length) {
                   responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
                   shouldSendSMS = true;
                 } else {
                   const selectedCrew = crewList[crewIndex];
                   
                   // Get crew members
                   const { data: crewMembers, error: membersError } = await supabase
                     .from('crew_members')
                     .select(`
                       contacts (
                         first_name,
                         phone_number
                       )
                     `)
                     .eq('crew_id', selectedCrew.id);
                   
                   if (membersError) {
                     console.error('Error fetching crew members:', membersError);
                     responseContent = `Sorry, I couldn't fetch members for ${selectedCrew.name}. Please try again.`;
                     shouldSendSMS = true;
                   } else if (crewMembers && crewMembers.length > 0) {
                    // Show only first 5 members if crew has more than 5
                    const displayLimit = 5;
                    const memberNames = crewMembers
                      .slice(0, displayLimit)
                      .map(member => member.contacts.first_name)
                      .join(', ');
                    
                    // Format message based on crew size
                    const memberDisplay = crewMembers.length > displayLimit
                      ? `${selectedCrew.name}: ${memberNames}... (${crewMembers.length} total)`
                      : `${selectedCrew.name} (${crewMembers.length}): ${memberNames}`;
                    
                    responseContent = `${memberDisplay}\n\nType 'Add Members' to add people to ${selectedCrew.name}, 'Create Event' to send invitations, or 'exit' to do something else.`;
                     shouldSendSMS = true;
                   } else {
                     responseContent = `${selectedCrew.name} has no members yet.\n\nType 'Add Members' to add people to ${selectedCrew.name}, 'Create Event' to send invitations, or 'exit' to do something else.`;
                     shouldSendSMS = true;
                   }
                   
                  // Update conversation state to track that user just viewed crew members
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'post_crew_members_view',
                      current_state: 'crew_members_viewed',
                      extracted_data: [
                        ...(conversationState?.extracted_data || []),
                        {
                          action: 'CREW_MEMBERS_VIEWED',
                          crew_id: selectedCrew.id,
                          crew_name: selectedCrew.name,
                          timestamp: new Date().toISOString()
                        }
                      ]
                    })
                    .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_CHECK_MEMBERS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION_CHECK_MEMBERS pattern matching:', error);
                 responseContent = 'Failed to check crew members. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_CHECK_MEMBERS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_SELECTION_SEND_INVITATIONS') {
               console.log('CREW_SELECTION_SEND_INVITATIONS detected via pattern matching, bypassing AI');
               
               try {
                 const crewIndex = extractedData.crew_index;
                 
                 // Get the crew list from the most recent SEND_INVITATIONS action
                 let crewList = null;
                 let initialEventDetails = null;
                 if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                   for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationState.extracted_data[i];
                     if (item.action === 'SEND_INVITATIONS' && item.available_crews) {
                       crewList = item.available_crews;
                       initialEventDetails = item.initial_event_details;
                       break;
                     }
                   }
                 }
                 
                 if (!crewList || crewIndex < 0 || crewIndex >= crewList.length) {
                   responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
                   shouldSendSMS = true;
                 } else {
                   const selectedCrew = crewList[crewIndex];
                   
                   // Start progressive event details collection - ask for event name first
                   responseContent = "What's the Event name?";
                   shouldSendSMS = true;
                     
                     // Update conversation state to wait for event name
                     await supabase
                       .from('conversation_state')
                       .update({
                         waiting_for: 'event_name_input',
                         current_state: 'send_invitations_step_2',
                         extracted_data: [
                           ...(conversationState?.extracted_data || []),
                           {
                             action: 'CREW_SELECTED_FOR_SEND_INVITATIONS',
                             crew_id: selectedCrew.id,
                             crew_name: selectedCrew.name,
                             timestamp: new Date().toISOString()
                           },
                           {
                             action: 'PARTIAL_EVENT_DETAILS',
                             crew_id: selectedCrew.id,
                             crew_name: selectedCrew.name,
                             event_name: null,
                             date: null,
                             location: null,
                             start_time: null,
                             end_time: null,
                             notes: null,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       })
                       .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_SEND_INVITATIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION_SEND_INVITATIONS pattern matching:', error);
                 responseContent = 'Failed to select crew for event creation. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_SEND_INVITATIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CHECK_CREW_MEMBERS') {
               console.log('CHECK_CREW_MEMBERS detected via pattern matching, bypassing AI');
               
               try {
                 const crewName = extractedData?.crewName;
                 
                 // Get user's crews (only their own crews - creator_id = userId)
                 const { data: userCrews, error: crewsError } = await supabase
                   .from('crews')
                   .select('id, name')
                   .eq('creator_id', userId)
                   .order('name');
                 
                 if (crewsError) {
                   console.error('Error fetching crews:', crewsError);
                   responseContent = 'Sorry, I couldn\'t fetch your crews. Please try again.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CHECK_CREW_MEMBERS',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Section 1: Crew Selection
                 if (!userCrews || userCrews.length === 0) {
                   // 0 crews - jump to CREATE_CREW
                   responseContent = 'No crews found. Type \'Create Crew\' to create your first crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREATE_CREW',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (userCrews.length === 1) {
                   // 1 crew - skip selection, go to Section 2
                   const crew = userCrews[0];
                   responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crew.id, crew.name, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CHECK_CREW_MEMBERS',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else {
                   // 2+ crews
                   if (crewName) {
                     // User specified crew name - find all matches (exact first, then partial)
                     const exactMatches = userCrews.filter(c => c.name.toLowerCase() === crewName.toLowerCase());
                     const partialMatches = userCrews.filter(c => 
                       c.name.toLowerCase().includes(crewName.toLowerCase()) && 
                       !exactMatches.some(e => e.id === c.id)
                     );
                     
                     // Combine: exact matches first, then partial matches
                     const allMatches = [...exactMatches, ...partialMatches];
                     
                     if (allMatches.length === 0) {
                       // No matches found
                       responseContent = `Crew '${crewName}' not found or you don't have permission to manage it.`;
                       shouldSendSMS = true;
                     } else if (allMatches.length === 1) {
                       // Single match - go directly to it
                       const selectedCrew = allMatches[0];
                       const ownership = await validateCrewOwnership(supabase, selectedCrew.id, userId);
                       if (ownership.isValid) {
                         responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, selectedCrew.id, selectedCrew.name, phone_number);
                         return new Response(JSON.stringify({
                           success: true,
                           action: 'CHECK_CREW_MEMBERS',
                           response: responseContent,
                           optimization: 'pattern_matching'
                         }), {
                           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                         });
                       } else {
                         responseContent = `Crew '${crewName}' not found or you don't have permission to manage it.`;
                         shouldSendSMS = true;
                       }
                     } else {
                       // Multiple matches (duplicate or similar names) - show top 5 with pagination
                       const topMatches = allMatches.slice(0, 5);
                       const totalMatches = allMatches.length;
                       const page = 0;
                       const pageSize = 5;
                       
                       let crewList = `Found ${totalMatches} crew${totalMatches === 1 ? '' : 's'} matching '${crewName}'.\n\n`;
                       topMatches.forEach((crew, index) => {
                         crewList += `${index + 1}. ${crew.name}\n`;
                       });
                       
                       const hasMore = totalMatches > pageSize;
                       crewList += '\n';
                       if (hasMore) {
                         crewList += 'Reply with a number (1-5), \'Next\' or \'N\' for the next 5';
                       } else {
                         crewList += 'Reply with a number (1-5)';
                       }
                       crewList += ', \'Done\' or \'D\' to return to menu, \'Create Crew\' to make a new one, or \'exit\'.';
                       
                       responseContent = crewList;
                       shouldSendSMS = true;
                       
                       // Store matched crew list and page in conversation state
                       const { error: stateError } = await supabase
                         .from('conversation_state')
                         .upsert({
                           user_id: userId,
                           phone_number: phone_number,
                           waiting_for: 'crew_selection_manage',
                           current_state: 'check_crew_members_selection',
                           extracted_data: [{
                             action: 'CHECK_CREW_MEMBERS',
                             current_page: page,
                             crew_list: allMatches.map(c => ({ id: c.id, name: c.name })),
                             search_query: crewName,
                             timestamp: new Date().toISOString()
                           }]
                         }, {
                           onConflict: 'user_id'
                         });
                       
                       if (stateError) {
                         console.error('Error saving conversation state:', stateError);
                       }
                     }
                  } else {
                    // No crew name - show paginated list (first 5)
                    const page = 0;
                    const pageSize = 5;
                    const totalCrews = userCrews.length;
                    const crewsOnPage = userCrews.slice(page * pageSize, (page + 1) * pageSize);
                    
                    let crewList = `You have ${totalCrews} crew${totalCrews === 1 ? '' : 's'}. Which crew would you like to manage?\n\n`;
                    crewsOnPage.forEach((crew, index) => {
                      crewList += `${index + 1}. ${crew.name}\n`;
                    });
                    
                    const hasMore = totalCrews > (page + 1) * pageSize;
                    const hasPrevious = page > 0;
                    crewList += '\n';
                    
                    // Build prompt with conditional pagination
                    if (crewsOnPage.length < pageSize) {
                      crewList += `Reply with a number (1-${crewsOnPage.length})`;
                    } else {
                      crewList += 'Reply with a number (1-5)';
                    }
                    
                    if (hasMore && hasPrevious) {
                      crewList += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
                    } else if (hasMore) {
                      crewList += ', \'Next\' or \'N\' for the next 5';
                    } else if (hasPrevious) {
                      crewList += ', \'Prev\' or \'P\' for the previous 5';
                    }
                    
                    crewList += ', \'Done\' or \'D\' to return to menu, \'Create Crew\' to make a new one, or \'exit\'.';
                    
                    responseContent = crewList;
                     shouldSendSMS = true;
                     
                     // Store crew list and page in conversation state
                     const { error: stateError } = await supabase
                       .from('conversation_state')
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number,
                         waiting_for: 'crew_selection_manage',
                         current_state: 'check_crew_members_selection',
                         extracted_data: [{
                           action: 'CHECK_CREW_MEMBERS',
                           current_page: page,
                           crew_list: userCrews.map(c => ({ id: c.id, name: c.name })),
                           timestamp: new Date().toISOString()
                         }]
                       }, {
                         onConflict: 'user_id'
                       });
                     
                     if (stateError) {
                       console.error('Error saving conversation state:', stateError);
                     }
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CHECK_CREW_MEMBERS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CHECK_CREW_MEMBERS pattern matching:', error);
                 responseContent = 'Failed to check crew members. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CHECK_CREW_MEMBERS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_SELECTION_MANAGE') {
               console.log('CREW_SELECTION_MANAGE detected via pattern matching');
               try {
                 const crewIndex = extractedData?.crew_index;
                 
                 // Get crew list and current page from conversation state
                 const crewList = conversationState?.extracted_data?.[0]?.crew_list || [];
                 const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
                 const pageSize = 5;
                 
                 // Calculate the actual index in the full list: (page * pageSize) + crewIndex
                 const actualIndex = (currentPage * pageSize) + crewIndex;
                 
                if (crewIndex < 0 || crewIndex >= pageSize || actualIndex < 0 || actualIndex >= crewList.length) {
                  // Invalid selection - show error message only (do NOT re-display list)
                  const totalCrews = crewList.length;
                  const hasMore = totalCrews > (currentPage + 1) * pageSize;
                  const hasPrevious = currentPage > 0;
                  
                  responseContent = 'I didn\'t understand that. Reply with a crew number';
                  // Only show pagination actions if available
                  if (hasMore && hasPrevious) {
                    responseContent += ', \'Next\' or \'N\', \'Prev\' or \'P\'';
                  } else if (hasMore) {
                    responseContent += ', \'Next\' or \'N\'';
                  } else if (hasPrevious) {
                    responseContent += ', \'Prev\' or \'P\'';
                  }
                  responseContent += ', \'Create Crew\', or \'exit\'.';
                  
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: 'CREW_SELECTION_MANAGE',
                    response: responseContent,
                    optimization: 'pattern_matching'
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                 
                 const selectedCrew = crewList[actualIndex];
                 
                 // Validate ownership
                 const ownership = await validateCrewOwnership(supabase, selectedCrew.id, userId);
                 if (!ownership.isValid) {
                   responseContent = 'You don\'t have permission to manage this crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_SELECTION_MANAGE',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Show crew members and menu
                 responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, selectedCrew.id, selectedCrew.name, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_MANAGE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION_MANAGE:', error);
                 responseContent = 'Failed to select crew. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_MANAGE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_SELECTION_MORE') {
               console.log('CREW_SELECTION_MORE detected via pattern matching');
               try {
                 const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
                 const crewList = conversationState?.extracted_data?.[0]?.crew_list || [];
                 const searchQuery = conversationState?.extracted_data?.[0]?.search_query;
                 const pageSize = 5;
                 const newPage = currentPage + 1;
                 const totalCrews = crewList.length;
                 const crewsOnPage = crewList.slice(newPage * pageSize, (newPage + 1) * pageSize);
                 
                 if (crewsOnPage.length === 0) {
                   responseContent = 'No more crews to show.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_SELECTION_MORE',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Use search query message if available, otherwise use generic message
                 let crewListText = '';
                 if (searchQuery) {
                   crewListText = `Found ${totalCrews} crew${totalCrews === 1 ? '' : 's'} matching '${searchQuery}'.\n\n`;
                 } else {
                   crewListText = `You have ${totalCrews} crew${totalCrews === 1 ? '' : 's'}.\n\n`;
                 }
                 
                 crewsOnPage.forEach((crew, index) => {
                   crewListText += `${index + 1}. ${crew.name}\n`;
                 });
                 
                const hasMore = totalCrews > (newPage + 1) * pageSize;
                const hasPrevious = newPage > 0;
                crewListText += '\n';
                
                // Build prompt with conditional pagination
                if (crewsOnPage.length < pageSize) {
                  crewListText += `Reply with a number (1-${crewsOnPage.length})`;
                } else {
                  crewListText += 'Reply with a number (1-5)';
                }
                
                // Only show pagination actions if available
                if (hasMore && hasPrevious) {
                  crewListText += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
                } else if (hasMore) {
                  crewListText += ', \'Next\' or \'N\' for the next 5';
                } else if (hasPrevious) {
                  crewListText += ', \'Prev\' or \'P\' for the previous 5';
                }
                crewListText += ', \'Done\' or \'D\' to return to menu, \'Create Crew\' to make a new one, or \'exit\'.';
                
                responseContent = crewListText;
                shouldSendSMS = true;
                
                // Update conversation state with new page
                await supabase
                  .from('conversation_state')
                  .update({
                    extracted_data: [{
                      action: 'CHECK_CREW_MEMBERS',
                      current_page: newPage,
                      crew_list: crewList,
                      search_query: searchQuery,
                      timestamp: new Date().toISOString()
                    }]
                  })
                  .eq('user_id', userId);
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_MORE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION_MORE:', error);
                 responseContent = 'Failed to show more crews. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_MORE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_SELECTION_BACK') {
               console.log('CREW_SELECTION_BACK detected via pattern matching');
               try {
                 const currentPage = conversationState?.extracted_data?.[0]?.current_page || 0;
                 const crewList = conversationState?.extracted_data?.[0]?.crew_list || [];
                 const searchQuery = conversationState?.extracted_data?.[0]?.search_query;
                 const pageSize = 5;
                 const newPage = Math.max(0, currentPage - 1);
                 const totalCrews = crewList.length;
                 const crewsOnPage = crewList.slice(newPage * pageSize, (newPage + 1) * pageSize);
                 
                 // Use search query message if available, otherwise use generic message
                 let crewListText = '';
                 if (searchQuery) {
                   crewListText = `Found ${totalCrews} crew${totalCrews === 1 ? '' : 's'} matching '${searchQuery}'.\n\n`;
                 } else {
                   crewListText = `You have ${totalCrews} crew${totalCrews === 1 ? '' : 's'}.\n\n`;
                 }
                 
                 crewsOnPage.forEach((crew, index) => {
                   crewListText += `${index + 1}. ${crew.name}\n`;
                 });
                 
                const hasMore = totalCrews > (newPage + 1) * pageSize;
                const hasPrevious = newPage > 0;
                crewListText += '\n';
                
                // Build prompt with conditional pagination
                if (crewsOnPage.length < pageSize) {
                  crewListText += `Reply with a number (1-${crewsOnPage.length})`;
                } else {
                  crewListText += 'Reply with a number (1-5)';
                }
                
                // Only show pagination actions if available
                if (hasMore && hasPrevious) {
                  crewListText += ', \'Next\' or \'N\' for the next 5, \'Prev\' or \'P\' for the previous 5';
                } else if (hasMore) {
                  crewListText += ', \'Next\' or \'N\' for the next 5';
                } else if (hasPrevious) {
                  crewListText += ', \'Prev\' or \'P\' for the previous 5';
                }
                crewListText += ', \'Done\' or \'D\' to return to menu, \'Create Crew\' to make a new one, or \'exit\'.';
                
                responseContent = crewListText;
                shouldSendSMS = true;
                
                // Update conversation state with new page
                await supabase
                  .from('conversation_state')
                  .update({
                    extracted_data: [{
                      action: 'CHECK_CREW_MEMBERS',
                      current_page: newPage,
                      crew_list: crewList,
                      search_query: searchQuery,
                      timestamp: new Date().toISOString()
                    }]
                  })
                  .eq('user_id', userId);
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_BACK',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_SELECTION_BACK:', error);
                 responseContent = 'Failed to show previous crews. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_BACK',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_MANAGEMENT_MENU_SELECTION') {
                 console.log('CREW_MANAGEMENT_MENU_SELECTION detected via pattern matching');
                 try {
                   const menuOption = extractedData?.menu_option;
                   const crewData = conversationState?.extracted_data?.[0];
                   const crewId = crewData?.crew_id;
                   const crewName = crewData?.crew_name;
                 
                 if (!crewId || !crewName) {
                   responseContent = 'I didn\'t understand that. Reply with a number (1-9), or type \'exit\'.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Validate ownership
                 const ownership = await validateCrewOwnership(supabase, crewId, userId);
                 if (!ownership.isValid) {
                   responseContent = 'You don\'t have permission to manage this crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Validate menu option range (1-9)
                 if (menuOption < 1 || menuOption > 9) {
                   // Show error message only (don't re-display menu)
                   responseContent = `I didn't understand that. Reply with a number (1-9), or type 'exit'.`;
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Route to appropriate handler based on menu option
                 if (menuOption === 1) {
                   // Add Members - jump to ADD_CREW_MEMBERS
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       phone_number: phone_number,
                       waiting_for: 'crew_member_addition',
                       extracted_data: [{
                         action: 'CREW_SELECTED',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }]
                     }, {
                       onConflict: 'user_id'
                     });
                   
                  const joinLink = await getCrewJoinLink(supabase, crewId);
                  responseContent = `To add members to ${crewName}:\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'ADD_CREW_MEMBERS',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 2) {
                   // Remove Members - start sub-flow
                   const memberList = crewData?.member_list || [];
                   
                   if (memberList.length === 0) {
                     responseContent = `${crewName} has no members to remove.`;
                     shouldSendSMS = true;
                     await sendSMS(phone_number, responseContent, send_sms, phone_number);
                     // Re-show menu
                     responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                     return new Response(JSON.stringify({
                       success: true,
                       action: 'CREW_MANAGEMENT_MENU_SELECTION',
                       response: responseContent,
                       optimization: 'pattern_matching'
                     }), {
                       headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                     });
                   }
                   
                   if (memberList.length <= 5) {
                     // Show all members
                     let memberListText = `Who would you like to remove?\n\n`;
                     memberList.forEach((member, index) => {
                       memberListText += `${index + 1}. ${member.name}\n`;
                     });
                     memberListText += '\nReply with numbers (e.g. \'2\' or \'1 3\'), or type \'Done\' or \'D\' to return to menu.';
                     responseContent = memberListText;
                  } else {
                    // Show first 5 with pagination
                    const pageSize = 5;
                    const page = 0;
                    const membersOnPage = memberList.slice(page * pageSize, (page + 1) * pageSize);
                    const hasMore = memberList.length > (page + 1) * pageSize;
                    const hasPrevious = page > 0;
                    
                    let memberListText = `Who would you like to remove?\n\n`;
                    membersOnPage.forEach((member, index) => {
                      memberListText += `${index + 1}. ${member.name}\n`;
                    });
                    
                    memberListText += '\nReply with numbers';
                    // Only show pagination actions if available
                    if (hasMore && hasPrevious) {
                      memberListText += ', \'Next\' or \'N\' for next 5, \'Prev\' or \'P\' for previous 5';
                    } else if (hasMore) {
                      memberListText += ', \'Next\' or \'N\' for next 5';
                    } else if (hasPrevious) {
                      memberListText += ', \'Prev\' or \'P\' for previous 5';
                    }
                    memberListText += ', or type \'Done\' or \'D\' to return to menu.';
                    responseContent = memberListText;
                  }
                   
                   shouldSendSMS = true;
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'remove_members_selection',
                       extracted_data: [{
                         action: 'CHECK_CREW_MEMBERS',
                         crew_id: crewId,
                         crew_name: crewName,
                         member_list: memberList,
                         member_page: 0,
                         timestamp: new Date().toISOString()
                       }]
                     })
                     .eq('user_id', userId);
                   
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 3) {
                   // Rename Crew - start sub-flow
                   responseContent = `What's the new name for ${crewName}? (Type 'Done' to cancel.)`;
                   shouldSendSMS = true;
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       phone_number: phone_number,
                       waiting_for: 'rename_crew_input',
                       extracted_data: [{
                         action: 'CHECK_CREW_MEMBERS',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }]
                     }, {
                       onConflict: 'user_id'
                     });
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 4) {
                   // Create Event - jump to SEND_INVITATIONS (exit)
                   // Update state and then execute the create event flow directly
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: null,
                       extracted_data: [{
                         action: 'CREW_SELECTED',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }]
                     })
                     .eq('user_id', userId);
                   
                   // Execute the create event flow directly
                   responseContent = "What's the Event name?";
                   shouldSendSMS = true;
                   
                   // Update conversation state to wait for event name
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_name_input',
                       current_state: 'send_invitations_step_2',
                       extracted_data: [{
                         action: 'CREW_SELECTED',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }, {
                         action: 'CREW_SELECTED_FOR_SEND_INVITATIONS',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }, {
                         action: 'PARTIAL_EVENT_DETAILS',
                         crew_id: crewId,
                         crew_name: crewName,
                         event_name: null,
                         date: null,
                         location: null,
                         start_time: null,
                         end_time: null,
                         notes: null,
                         timestamp: new Date().toISOString()
                       }]
                     })
                     .eq('user_id', userId);
                   
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 5) {
                   // Sync Up - jump to SYNC_UP (exit)
                   // Execute the sync up flow directly with crew pre-selected
                   responseContent = "Sync Up helps find times that work for everyone. I'll ask for event details and time options, then your crew votes on what works best.\n\nWhat's the event name?";
                   shouldSendSMS = true;
                   
                   // Update conversation state for progressive workflow
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'sync_up_event_name_input',
                       current_state: 'sync_up_step_2',
                       extracted_data: [{
                         action: 'SYNC_UP',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }, {
                         action: 'CREW_SELECTED_FOR_SYNC_UP',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }]
                     })
                     .eq('user_id', userId);
                   
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'SYNC_UP',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 6) {
                   // Get Crew Link - show link, return to menu
                   const joinLink = await getCrewJoinLink(supabase, crewId);
                   const linkMessage = `Join link for ${crewName}: ${joinLink}\n\nShare this link for people to join your crew.`;
                   shouldSendSMS = true;
                   await sendSMS(phone_number, linkMessage, send_sms, phone_number);
                   // Re-show menu
                   const menuDisplay = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                   // Combine link message and menu
                   responseContent = `${linkMessage}\n\n${menuDisplay}`;
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 7) {
                   // Get QR Code - show QR, return to menu
                   const joinLink = await getCrewJoinLink(supabase, crewId);
                   const qrUrl = `${joinLink}/qr`;
                   const qrMessage = `QR code for ${crewName}: ${qrUrl}\n\nShare this QR code for people to join your crew.`;
                   shouldSendSMS = true;
                   await sendSMS(phone_number, qrMessage, send_sms, phone_number);
                   // Re-show menu
                   const menuDisplay = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                   // Combine QR message and menu
                   responseContent = `${qrMessage}\n\n${menuDisplay}`;
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 8) {
                   // Delete Crew - start confirmation sub-flow
                   responseContent = `Delete ${crewName}? This will remove the crew and all its members. Type 'delete' to confirm or 'Done' to cancel.`;
                   shouldSendSMS = true;
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'delete_crew_confirmation',
                       extracted_data: [{
                         action: 'CHECK_CREW_MEMBERS',
                         crew_id: crewId,
                         crew_name: crewName,
                         timestamp: new Date().toISOString()
                       }]
                     })
                     .eq('user_id', userId);
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else if (menuOption === 9) {
                   // Exit - clear state and end
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: null,
                       current_state: 'normal',
                       extracted_data: []
                     })
                     .eq('user_id', userId);
                   responseContent = 'Exited crew management.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 } else {
                   responseContent = 'I didn\'t understand that. Reply with a number (1-9), or type \'exit\'.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_MANAGEMENT_MENU_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
              } catch (error) {
                console.error('Error in CREW_MANAGEMENT_MENU_SELECTION:', error);
                responseContent = 'Failed to process menu selection. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'CREW_MANAGEMENT_MENU_SELECTION',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT') {
              console.log('EDIT_CONTACT detected via pattern matching');
              try {
                const searchQuery = extractedData?.search_query;
                
                // Count user's contacts
                const { count: contactCount, error: countError } = await supabase
                  .from('contacts')
                  .select('id', { count: 'exact', head: true })
                  .eq('user_id', userId);
                
                if (countError) throw countError;
                
                // If no contacts
                if (!contactCount || contactCount === 0) {
                  responseContent = 'No contacts found. Add people by creating a crew or adding members to an existing crew.';
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  
                  // Clear conversation state
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: null,
                      current_state: 'normal',
                      extracted_data: [],
                      last_action: 'EDIT_CONTACT',
                      last_action_timestamp: new Date().toISOString()
                    })
                    .eq('user_id', userId);
                  
                  return new Response(JSON.stringify({
                    success: true,
                    action: 'EDIT_CONTACT',
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // If search query provided
                if (searchQuery) {
                  const contacts = await searchUserContacts(supabase, userId, searchQuery);
                  
                  if (contacts.length === 0) {
                    responseContent = `No contacts found for '${searchQuery}'. Try another name or type 'exit'.`;
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    // Keep in search mode
                    await supabase
                      .from('conversation_state')
                      .upsert({
                        user_id: userId,
                        phone_number: phone_number,
                        waiting_for: 'edit_contact_search_input',
                        current_state: 'edit_contact_search',
                        extracted_data: [],
                        last_action: 'EDIT_CONTACT',
                        last_action_timestamp: new Date().toISOString()
                      }, { onConflict: 'user_id' });
                    
                    return new Response(JSON.stringify({
                      success: true,
                      action: 'EDIT_CONTACT',
                      response: responseContent
                    }), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                  
                  // Exactly 1 match - go directly to actions menu
                  if (contacts.length === 1) {
                    responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contacts[0].id, phone_number);
                    return new Response(JSON.stringify({
                      success: true,
                      action: 'EDIT_CONTACT',
                      response: responseContent
                    }), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                  
                  // Multiple matches - show list (up to 5)
                  const displayContacts = contacts.slice(0, 5);
                  let contactList = `Found these contacts:\n\n`;
                  for (let i = 0; i < displayContacts.length; i++) {
                    const displayText = await formatContactDisplay(displayContacts[i]);
                    contactList += `${i + 1}. ${displayText}\n`;
                  }
                  contactList += `\nReply with a number or type 'exit'.`;
                  
                  responseContent = contactList;
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  
                  // Save search results in state
                  await supabase
                    .from('conversation_state')
                    .upsert({
                      user_id: userId,
                      phone_number: phone_number,
                      waiting_for: 'edit_contact_selection',
                      current_state: 'edit_contact_list',
                      extracted_data: [{
                        action: 'EDIT_CONTACT',
                        contact_list: displayContacts.map(c => ({
                          id: c.id,
                          name: `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}`,
                          phone: c.phone_number
                        })),
                        timestamp: new Date().toISOString()
                      }]
                    }, { onConflict: 'user_id' });
                  
                  return new Response(JSON.stringify({
                    success: true,
                    action: 'EDIT_CONTACT',
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // No search query - prompt for name
                responseContent = 'Type part or all of the name of the person to edit, or type \'exit\'.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                await supabase
                  .from('conversation_state')
                  .upsert({
                    user_id: userId,
                    phone_number: phone_number,
                    waiting_for: 'edit_contact_search_input',
                    current_state: 'edit_contact_search',
                    extracted_data: [],
                    last_action: 'EDIT_CONTACT',
                    last_action_timestamp: new Date().toISOString()
                  }, { onConflict: 'user_id' });
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'EDIT_CONTACT',
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error('Error in EDIT_CONTACT:', error);
                responseContent = 'Failed to search contacts. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'EDIT_CONTACT',
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT_SEARCH' || action === 'EDIT_CONTACT_SELECTION') {
              console.log(`${action} detected`);
              try {
                let contactId = null;
                
                if (action === 'EDIT_CONTACT_SEARCH') {
                  const searchQuery = extractedData?.search_query;
                  const contacts = await searchUserContacts(supabase, userId, searchQuery);
                  
                  if (contacts.length === 0) {
                    responseContent = `No contacts found for '${searchQuery}'. Try another name or type 'exit'.`;
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    return new Response(JSON.stringify({
                      success: true,
                      action: action,
                      response: responseContent
                    }), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                  
                  if (contacts.length === 1) {
                    contactId = contacts[0].id;
                  } else {
                    // Show list
                    const displayContacts = contacts.slice(0, 5);
                    let contactList = `Found these contacts:\n\n`;
                    for (let i = 0; i < displayContacts.length; i++) {
                      const displayText = await formatContactDisplay(displayContacts[i]);
                      contactList += `${i + 1}. ${displayText}\n`;
                    }
                    contactList += `\nReply with a number or type 'exit'.`;
                    
                    responseContent = contactList;
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    await supabase
                      .from('conversation_state')
                      .upsert({
                        user_id: userId,
                        phone_number: phone_number,
                        waiting_for: 'edit_contact_selection',
                        current_state: 'edit_contact_list',
                        extracted_data: [{
                          action: 'EDIT_CONTACT',
                          contact_list: displayContacts.map(c => ({
                            id: c.id,
                            name: `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}`,
                            phone: c.phone_number
                          }))
                        }]
                      }, { onConflict: 'user_id' });
                    
                    return new Response(JSON.stringify({
                      success: true,
                      action: action,
                      response: responseContent
                    }), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                } else if (action === 'EDIT_CONTACT_SELECTION') {
                  const contactIndex = extractedData?.contact_index;
                  const contactList = conversationState?.extracted_data?.[0]?.contact_list || [];
                  
                  if (contactIndex < 0 || contactIndex >= contactList.length) {
                    responseContent = 'I didn\'t understand that. Reply with a number or type \'exit\'.';
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    return new Response(JSON.stringify({
                      success: true,
                      action: action,
                      response: responseContent
                    }), {
                      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                  }
                  
                  contactId = contactList[contactIndex].id;
                }
                
                // Show contact actions menu
                responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contactId, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error(`Error in ${action}:`, error);
                responseContent = 'Failed to select contact. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT_MENU_SELECTION') {
              console.log('EDIT_CONTACT_MENU_SELECTION detected');
              try {
                const menuOption = extractedData?.menu_option;
                const contactData = conversationState?.extracted_data?.[0];
                const contactId = contactData?.contact_id;
                const contactName = contactData?.contact_name;
                const contactPhone = contactData?.contact_phone;
                
                if (!contactId) {
                  responseContent = 'Session expired. Please try \'Edit Contact\' again.';
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: action,
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                switch (menuOption) {
                  case 1: // Edit Name
                    responseContent = 'Enter the new name for this contact, or type \'exit\'.';
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: 'edit_contact_name_input',
                        current_state: 'edit_contact_name'
                      })
                      .eq('user_id', userId);
                    break;
                    
                  case 2: // Edit Phone Number
                    // Check if editing own phone number
                    const { data: profile } = await supabase
                      .from('profiles')
                      .select('phone_number')
                      .eq('id', userId)
                      .single();
                    
                    if (profile && profile.phone_number === contactPhone) {
                      responseContent = 'You cannot edit your own phone number through this feature.';
                      shouldSendSMS = true;
                      await sendSMS(phone_number, responseContent, send_sms, phone_number);
                      
                      // Re-show menu
                      responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contactId, phone_number);
                      break;
                    }
                    
                    responseContent = 'Enter the new phone number (digits only), or type \'back\' or \'exit\'.';
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: 'edit_contact_phone_input',
                        current_state: 'edit_contact_phone'
                      })
                      .eq('user_id', userId);
                    break;
                    
                  case 3: // Delete Contact
                    responseContent = `Delete ${contactName} — (${formatPhoneNumberForDisplay(contactPhone)}) from all crews and events? Type 'delete' to confirm or 'back' to cancel.`;
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: 'edit_contact_delete_confirmation',
                        current_state: 'edit_contact_delete'
                      })
                      .eq('user_id', userId);
                    break;
                    
                  case 4: // Exit
                    responseContent = 'Exited contact editing.';
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                    
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: null,
                        current_state: 'normal',
                        extracted_data: [],
                        last_action: 'EDIT_CONTACT',
                        last_action_timestamp: new Date().toISOString()
                      })
                      .eq('user_id', userId);
                    break;
                    
                  default:
                    responseContent = 'I didn\'t understand that. Reply with a number (1-4), or type \'exit\'.';
                    shouldSendSMS = true;
                    await sendSMS(phone_number, responseContent, send_sms, phone_number);
                }
                
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error('Error in EDIT_CONTACT_MENU_SELECTION:', error);
                responseContent = 'Failed to process selection. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT_MENU_INVALID_SELECTION') {
              console.log('EDIT_CONTACT_MENU_INVALID_SELECTION detected via pattern matching');
              
              responseContent = `I didn't understand that. Reply with a number (1-4), or type 'exit'.`;
              shouldSendSMS = true;
              
              // Keep state in edit_contact_actions_menu
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'edit_contact_actions_menu',
                  current_state: 'edit_contact_menu'
                })
                .eq('user_id', userId);
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EDIT_CONTACT_MENU_INVALID_SELECTION',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'EDIT_CONTACT_NAME_INPUT_INVALID') {
              console.log('EDIT_CONTACT_NAME_INPUT_INVALID detected via pattern matching');
              
              responseContent = `I didn't understand that. Enter a new name or type 'exit'.`;
              shouldSendSMS = true;
              
              // Keep state in edit_contact_name_input
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'edit_contact_name_input',
                  current_state: 'edit_contact_name'
                })
                .eq('user_id', userId);
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'EDIT_CONTACT_NAME_INPUT_INVALID',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'EDIT_CONTACT_NAME_INPUT') {
              console.log('EDIT_CONTACT_NAME_INPUT detected');
              try {
                const newName = extractedData?.new_name;
                const contactData = conversationState?.extracted_data?.[0];
                const contactId = contactData?.contact_id;
                
                if (!newName || newName.length === 0) {
                  responseContent = 'I didn\'t understand that. Enter a new name or type \'exit\'.';
                  shouldSendSMS = true;
                  
                  // Preserve state
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'edit_contact_name_input',
                      current_state: 'edit_contact_name'
                    })
                    .eq('user_id', userId);
                  
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: action,
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // Parse name into first and last
                const nameParts = newName.split(' ');
                const firstName = nameParts[0];
                const lastName = nameParts.slice(1).join(' ') || '';
                
                // Update contact name
                const { error: updateError } = await supabase
                  .from('contacts')
                  .update({
                    first_name: firstName,
                    last_name: lastName
                  })
                  .eq('id', contactId)
                  .eq('user_id', userId);
                
                if (updateError) throw updateError;
                
                responseContent = `Updated contact name to ${firstName}${lastName ? ' ' + lastName : ''}.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                // Re-show contact and menu
                responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contactId, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error('Error in EDIT_CONTACT_NAME_INPUT:', error);
                responseContent = 'Failed to update name. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT_PHONE_INPUT') {
              console.log('EDIT_CONTACT_PHONE_INPUT detected');
              try {
                const newPhone = extractedData?.new_phone;
                const contactData = conversationState?.extracted_data?.[0];
                const contactId = contactData?.contact_id;
                
                // Validate phone format (must be 10 digits)
                if (!newPhone || newPhone.length !== 10) {
                  responseContent = 'I didn\'t understand that. Enter a 10-digit phone number, or type \'back\' or \'exit\'.';
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: action,
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // Format as +1XXXXXXXXXX
                const formattedPhone = `+1${newPhone}`;
                
                // Check if phone belongs to another contact
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('user_id', userId)
                  .eq('phone_number', formattedPhone)
                  .neq('id', contactId)
                  .maybeSingle();
                
                if (existingContact) {
                  responseContent = 'That number is already used by another contact. Enter a different number, or type \'Done\' or \'exit\'.';
                  shouldSendSMS = true;
                  
                  // Explicitly preserve state in edit_contact_phone_input
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'edit_contact_phone_input',
                      current_state: 'edit_contact_phone'
                    })
                    .eq('user_id', userId);
                  
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: action,
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // Update phone number
                const { error: updateError } = await supabase
                  .from('contacts')
                  .update({
                    phone_number: formattedPhone
                  })
                  .eq('id', contactId)
                  .eq('user_id', userId);
                
                if (updateError) throw updateError;
                
                responseContent = `Updated phone number to (${formatPhoneNumberForDisplay(formattedPhone)}).`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                // Re-show contact and menu
                responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contactId, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error('Error in EDIT_CONTACT_PHONE_INPUT:', error);
                responseContent = 'Failed to update phone number. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EDIT_CONTACT_BACK_TO_MENU') {
              console.log('EDIT_CONTACT_BACK_TO_MENU detected');
              const contactData = conversationState?.extracted_data?.[0];
              const contactId = contactData?.contact_id;
              
              responseContent = await showContactActionsMenu(supabase, userId, phone_number, send_sms, contactId, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: action,
                response: responseContent
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'EDIT_CONTACT_DELETE_INVALID') {
              console.log('EDIT_CONTACT_DELETE_INVALID detected');
              responseContent = `I didn't understand that. Type 'delete' to confirm or 'Done'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              // Preserve the delete confirmation state
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'edit_contact_delete_confirmation',
                  current_state: 'edit_contact_delete'
                })
                .eq('user_id', userId);
              
              return new Response(JSON.stringify({
                success: true,
                action: action,
                response: responseContent
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'EDIT_CONTACT_DELETE_CONFIRMED') {
              console.log('EDIT_CONTACT_DELETE_CONFIRMED detected');
              try {
                const contactData = conversationState?.extracted_data?.[0];
                const contactId = contactData?.contact_id;
                const contactName = contactData?.contact_name;
                const contactPhone = contactData?.contact_phone;
                
                // Verify contact belongs to current user before deletion
                const { data: contactOwnershipData, error: contactCheckError } = await supabase
                  .from('contacts')
                  .select('id, user_id')
                  .eq('id', contactId)
                  .eq('user_id', userId)
                  .single();

                if (contactCheckError || !contactOwnershipData) {
                  responseContent = 'Contact not found or you don\'t have permission to delete it.';
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  // Clear conversation state
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: null,
                      current_state: 'normal',
                      extracted_data: [],
                      last_action: 'EDIT_CONTACT',
                      last_action_timestamp: new Date().toISOString()
                    })
                    .eq('user_id', userId);
                  
                  return new Response(JSON.stringify({
                    success: false,
                    action: action,
                    response: responseContent
                  }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                  });
                }
                
                // Delete from crew_members (cascade)
                await supabase
                  .from('crew_members')
                  .delete()
                  .eq('contact_id', contactId);
                
                // Delete from invitations (cascade)
                await supabase
                  .from('invitations')
                  .delete()
                  .eq('contact_id', contactId);
                
                // Delete contact
                const { error: deleteError } = await supabase
                  .from('contacts')
                  .delete()
                  .eq('id', contactId)
                  .eq('user_id', userId);
                
                if (deleteError) throw deleteError;
                
                responseContent = `Deleted ${contactName} — (${formatPhoneNumberForDisplay(contactPhone)}) from all crews and events.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                // Clear conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: null,
                    current_state: 'normal',
                    extracted_data: [],
                    last_action: 'EDIT_CONTACT',
                    last_action_timestamp: new Date().toISOString()
                  })
                  .eq('user_id', userId);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
                
              } catch (error) {
                console.error('Error in EDIT_CONTACT_DELETE_CONFIRMED:', error);
                responseContent = 'Failed to delete contact. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: action,
                  response: responseContent
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'REMOVE_MEMBERS_SELECTION') {
                 console.log('REMOVE_MEMBERS_SELECTION detected via pattern matching');
                 try {
                   const memberIndices = extractedData?.member_indices || [];
                   const crewData = conversationState?.extracted_data?.[0];
                   const crewId = crewData?.crew_id;
                   const crewName = crewData?.crew_name;
                   const memberList = crewData?.member_list || [];
                 
                 if (!crewId || !crewName || memberIndices.length === 0) {
                   responseContent = 'I didn\'t understand that. Reply with numbers, \'Next\' or \'N\', \'Prev\' or \'P\', or \'Done\' or \'D\'.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'REMOVE_MEMBERS_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Validate ownership
                 const ownership = await validateCrewOwnership(supabase, crewId, userId);
                 if (!ownership.isValid) {
                   responseContent = 'You don\'t have permission to manage this crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'REMOVE_MEMBERS_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Get members to remove (filter valid indices)
                 const validIndices = memberIndices.filter(idx => idx >= 0 && idx < memberList.length);
                 const membersToRemove = validIndices.map(idx => memberList[idx]).filter(m => m);
                 
                 if (membersToRemove.length === 0) {
                   responseContent = 'I didn\'t understand that. Reply with numbers, \'Next\' or \'N\', \'Prev\' or \'P\', or \'Done\' or \'D\'.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'REMOVE_MEMBERS_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Remove members from crew
                 const memberIdsToRemove = membersToRemove.map(m => m.id);
                 const { error: removeError } = await supabase
                   .from('crew_members')
                   .delete()
                   .in('id', memberIdsToRemove)
                   .eq('crew_id', crewId);
                 
                 if (removeError) {
                   console.error('Error removing members:', removeError);
                   responseContent = 'Failed to remove members. Please try again.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'REMOVE_MEMBERS_SELECTION',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                const removedNames = membersToRemove.map(m => m.name).join(', ');
                const removalMessage = `Removed ${removedNames} from ${crewName}.\n\n`;
                
                // Re-show updated member list and menu
                const updatedDisplay = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                responseContent = removalMessage + updatedDisplay;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'REMOVE_MEMBERS_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in REMOVE_MEMBERS_SELECTION:', error);
                 responseContent = 'Failed to remove members. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'REMOVE_MEMBERS_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'REMOVE_MEMBERS_MORE' || action === 'REMOVE_MEMBERS_BACK') {
               const currentAction = action; // Store action to avoid conflicts
               console.log(`${currentAction} detected via pattern matching`);
               try {
                 const crewData = conversationState?.extracted_data?.[0];
                 const crewId = crewData?.crew_id;
                 const crewName = crewData?.crew_name;
                 const memberList = crewData?.member_list || [];
                 let memberPage = crewData?.member_page || 0;
                 const pageSize = 5;
                 
                 // Handle pagination (both "prev" and "next" are now for navigation)
                 if (currentAction === 'REMOVE_MEMBERS_BACK') {
                   // If on first page, return to menu; otherwise paginate back
                   if (memberPage === 0) {
                     // Return to menu
                     responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                     shouldSendSMS = true;
                     await sendSMS(phone_number, responseContent, send_sms, phone_number);
                     return new Response(JSON.stringify({
                       success: true,
                       action: 'CREW_CHECK_DONE',
                       response: responseContent,
                       optimization: 'pattern_matching'
                     }), {
                       headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                     });
                   }
                   // Paginate back (go to previous page)
                   memberPage = Math.max(0, memberPage - 1);
                 } else if (currentAction === 'REMOVE_MEMBERS_MORE') {
                   // Paginate forward (go to next page)
                   memberPage += 1;
                 }
                 
                const membersOnPage = memberList.slice(memberPage * pageSize, (memberPage + 1) * pageSize);
                const hasMore = memberList.length > (memberPage + 1) * pageSize;
                const hasPrevious = memberPage > 0;
                
                if (membersOnPage.length === 0) {
                  responseContent = 'I didn\'t understand that. Reply with numbers';
                  // Only show pagination actions if available
                  if (hasMore && hasPrevious) {
                    responseContent += ', \'Next\' or \'N\', \'Prev\' or \'P\'';
                  } else if (hasMore) {
                    responseContent += ', \'Next\' or \'N\'';
                  } else if (hasPrevious) {
                    responseContent += ', \'Prev\' or \'P\'';
                  }
                  responseContent += ', or \'Done\' or \'D\'.';
                  shouldSendSMS = true;
                  await sendSMS(phone_number, responseContent, send_sms, phone_number);
                  return new Response(JSON.stringify({
                    success: true,
                    action: currentAction,
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                let memberListText = `Who would you like to remove?\n\n`;
                
                membersOnPage.forEach((member, index) => {
                  memberListText += `${index + 1}. ${member.name}\n`;
                });
                
                memberListText += '\nReply with numbers';
                // Only show pagination actions if available
                if (hasMore && hasPrevious) {
                  memberListText += ', \'Next\' or \'N\' for next 5, \'Prev\' or \'P\' for previous 5';
                } else if (hasMore) {
                  memberListText += ', \'Next\' or \'N\' for next 5';
                } else if (hasPrevious) {
                  memberListText += ', \'Prev\' or \'P\' for previous 5';
                }
                memberListText += ', or type \'Done\' or \'D\' to return to menu.';
                 
                 membersOnPage.forEach((member, index) => {
                   memberListText += `${index + 1}. ${member.name}\n`;
                 });
                 
                 responseContent = memberListText;
                 shouldSendSMS = true;
                 
                 await supabase
                   .from('conversation_state')
                   .update({
                     waiting_for: 'remove_members_pagination',
                     extracted_data: [{
                       action: 'CHECK_CREW_MEMBERS',
                       crew_id: crewId,
                       crew_name: crewName,
                       member_list: memberList,
                       member_page: memberPage,
                       timestamp: new Date().toISOString()
                     }]
                   })
                   .eq('user_id', userId);
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: currentAction,
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error(`Error in ${currentAction}:`, error);
                 responseContent = 'Failed to show members. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: currentAction,
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'RENAME_CREW_INPUT_INVALID') {
               console.log('RENAME_CREW_INPUT_INVALID detected via pattern matching');
               responseContent = 'I didn\'t understand that. Type a new name or \'Done\'.';
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RENAME_CREW_INPUT_INVALID',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
             } else if (action === 'RENAME_CREW_INPUT') {
               console.log('RENAME_CREW_INPUT detected via pattern matching');
               try {
                 const newCrewName = extractedData?.new_crew_name?.trim();
                 const crewData = conversationState?.extracted_data?.[0];
                 const crewId = crewData?.crew_id;
                 const oldCrewName = crewData?.crew_name;
                 
                 if (!crewId || !oldCrewName || !newCrewName || newCrewName.length < 2 || newCrewName.length > 50) {
                   responseContent = 'I didn\'t understand that. Type a new name or \'Done\'.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'RENAME_CREW_INPUT',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Validate ownership
                 const ownership = await validateCrewOwnership(supabase, crewId, userId);
                 if (!ownership.isValid) {
                   responseContent = 'You don\'t have permission to manage this crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'RENAME_CREW_INPUT',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Check if name is the same
                 if (newCrewName.toLowerCase() === oldCrewName.toLowerCase()) {
                   // Re-show menu with "Name unchanged." message
                   const menuDisplay = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, oldCrewName, phone_number);
                   responseContent = 'Name unchanged.\n\n' + menuDisplay;
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'RENAME_CREW_INPUT',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Update crew name
                 const { error: updateError } = await supabase
                   .from('crews')
                   .update({ name: newCrewName })
                   .eq('id', crewId)
                   .eq('creator_id', userId);
                 
                 if (updateError) {
                   console.error('Error renaming crew:', updateError);
                   responseContent = 'Failed to rename crew. Please try again.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'RENAME_CREW_INPUT',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                const renameMessage = `Renamed '${oldCrewName}' to '${newCrewName}'.\n\n`;
                
                // Re-show updated member list and menu
                const updatedDisplay = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, newCrewName, phone_number);
                responseContent = renameMessage + updatedDisplay;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RENAME_CREW_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in RENAME_CREW_INPUT:', error);
                 responseContent = 'Failed to rename crew. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RENAME_CREW_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'CREW_CHECK_DONE') {
               console.log('CREW_CHECK_DONE detected via pattern matching');
               try {
                 const crewData = conversationState?.extracted_data?.[0];
                 const crewId = crewData?.crew_id;
                 const crewName = crewData?.crew_name;
                 
                 // Check if we're in crew selection (no crew_id) or in crew management menu (has crew_id)
                 if (!crewId || !crewName) {
                   // Called from crew selection list - exit to normal state
                   responseContent = 'What would you like to do next?';
                   shouldSendSMS = true;
                   
                   // Clear conversation state to return to normal
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: null,
                       current_state: 'normal',
                       extracted_data: [],
                       last_action: 'CREW_CHECK_DONE',
                       last_action_timestamp: new Date().toISOString()
                     })
                     .eq('user_id', userId);
                   
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CREW_CHECK_DONE',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Return to crew management menu
                 responseContent = await showCrewMembersAndMenu(supabase, userId, phone_number, send_sms, crewId, crewName, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_CHECK_DONE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in CREW_CHECK_DONE:', error);
                 responseContent = 'Failed to return to menu. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_CHECK_DONE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'DELETE_CREW_CONFIRM') {
               console.log('DELETE_CREW_CONFIRM detected via pattern matching');
               try {
                 const crewData = conversationState?.extracted_data?.[0];
                 const crewId = crewData?.crew_id;
                 const crewName = crewData?.crew_name;
                 
                 if (!crewId || !crewName) {
                   responseContent = 'I didn\'t understand that. Type \'delete\' to confirm or \'Done\' to cancel.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'DELETE_CREW_CONFIRM',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Validate ownership
                 const ownership = await validateCrewOwnership(supabase, crewId, userId);
                 if (!ownership.isValid) {
                   responseContent = 'You don\'t have permission to manage this crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'DELETE_CREW_CONFIRM',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Delete crew (cascade will delete crew_members)
                 const { error: deleteError } = await supabase
                   .from('crews')
                   .delete()
                   .eq('id', crewId)
                   .eq('creator_id', userId);
                 
                 if (deleteError) {
                   console.error('Error deleting crew:', deleteError);
                   responseContent = 'Failed to delete crew. Please try again.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'DELETE_CREW_CONFIRM',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), {
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                   });
                 }
                 
                 // Clear conversation state and exit
                 await supabase
                   .from('conversation_state')
                   .update({
                     waiting_for: null,
                     current_state: 'normal',
                     extracted_data: []
                   })
                   .eq('user_id', userId);
                 
                 responseContent = `${crewName} deleted.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'DELETE_CREW_CONFIRM',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in DELETE_CREW_CONFIRM:', error);
                 responseContent = 'Failed to delete crew. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'DELETE_CREW_CONFIRM',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'DELETE_CREW_INVALID_INPUT') {
               console.log('DELETE_CREW_INVALID_INPUT detected via pattern matching');
               try {
                 responseContent = 'I didn\'t understand that. Type \'delete\' to confirm or \'done\'.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'DELETE_CREW_INVALID_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in DELETE_CREW_INVALID_INPUT:', error);
                 responseContent = 'Failed to process input. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'DELETE_CREW_INVALID_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'EVENT_SELECTION') {
               console.log('EVENT_SELECTION detected via pattern matching, bypassing AI');
               
               try {
                 const eventIndex = extractedData.event_index;
                 
                // Get the event list from the most recent action that showed events
                let eventList = null;
                let cameFromCheckRsvps = false;
                if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                  for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationState.extracted_data[i];
                    if (item.available_events || item.event_list) {
                      eventList = item.available_events || item.event_list;
                    }
                    if (!cameFromCheckRsvps && item.action === 'CHECK_RSVPS') {
                      cameFromCheckRsvps = true;
                    }
                    if (eventList) break;
                  }
                }
                 
                 if (!eventList || eventIndex < 0 || eventIndex >= eventList.length) {
                   // Provide contextual error message based on waiting_for state and current_state
                   if (conversationState?.waiting_for === 'event_selection' && conversationState?.current_state === 'check_rsvps_step_1') {
                     responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                   } else if (conversationState?.waiting_for === 'event_selection') {
                     responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                   } else {
                   responseContent = 'Invalid event selection. Please try again.';
                   }
                   shouldSendSMS = true;
                 } else {
                   const selectedEvent = eventList[eventIndex];
                   
                  // If we are selecting for CHECK_RSVPS, return RSVP details immediately
                  if (cameFromCheckRsvps) {
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: null,
                        current_state: 'normal',
                        extracted_data: [
                          ...(conversationState?.extracted_data || []),
                          {
                            action: 'EVENT_SELECTED',
                            event_id: selectedEvent.id,
                            event_title: selectedEvent.title,
                            timestamp: new Date().toISOString()
                          }
                        ]
                      })
                      .eq('user_id', userId);

                    responseContent = await checkRSVPsForEvent(supabase, selectedEvent.id, userId, phone_number, send_sms);
                    shouldSendSMS = true;
                  } else {
                    // Default behavior
                    await supabase
                      .from('conversation_state')
                      .update({
                        waiting_for: null,
                        current_state: 'normal',
                        extracted_data: [
                          ...(conversationState?.extracted_data || []),
                          {
                            action: 'EVENT_SELECTED',
                            event_id: selectedEvent.id,
                            event_title: selectedEvent.title,
                            timestamp: new Date().toISOString()
                          }
                        ]
                      })
                      .eq('user_id', userId);
                    responseContent = `Selected event: ${selectedEvent.title}. What would you like to do with this event?`;
                    shouldSendSMS = true;
                  }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                return new Response(JSON.stringify({
                  success: true,
                  action: cameFromCheckRsvps ? 'CHECK_RSVPS' : 'EVENT_SELECTION',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in EVENT_SELECTION pattern matching:', error);
                 responseContent = 'Failed to select event. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EVENT_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVALID_EVENT_SELECTION') {
               console.log('INVALID_EVENT_SELECTION detected via pattern matching, bypassing AI');
               
               try {
                 // Provide contextual error message based on current_state
                 if (conversationState?.current_state === 'check_rsvps_step_1') {
                   responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                 } else {
                   responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                 }
                 shouldSendSMS = true;
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVALID_EVENT_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVALID_EVENT_SELECTION pattern matching:', error);
                 responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVALID_EVENT_SELECTION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             // EVENT_DETAILS_INPUT handler removed - using progressive workflow only
             } else if (action === 'PARTIAL_EVENT_NAME') {
               console.log('PARTIAL_EVENT_NAME detected via pattern matching, bypassing AI');
               
               try {
                 const eventName = extractedData.event_name;
                 
                 // Get current conversation state to find partial event details
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Find the most recent PARTIAL_EVENT_DETAILS entry
                 let partialEventData = null;
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'PARTIAL_EVENT_DETAILS') {
                       partialEventData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!partialEventData) {
                   responseContent = 'No event details found. Please start over by saying "create event".';
                   shouldSendSMS = true;
                 } else {
                   // Update the partial event data with the new field
                   const updatedEventData = {
                     ...partialEventData,
                     event_name: eventName
                   };
                   
                   // Progressive order: event_name → date → location → time → notes
                   // After event name, ask for date
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_date_input',
                       extracted_data: [
                         ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_EVENT_DETAILS'),
                         updatedEventData
                       ]
                     })
                     .eq('user_id', userId);
                   
                   responseContent = "Date?";
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_NAME',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in PARTIAL_EVENT_NAME pattern matching:', error);
                 responseContent = 'Failed to process event name. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_NAME',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'PARTIAL_EVENT_DATE') {
               console.log('PARTIAL_EVENT_DATE detected via pattern matching, bypassing AI');
               
               try {
                 const date = extractedData.date;
                 
                 // Get current conversation state to find partial event details
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Find the most recent PARTIAL_EVENT_DETAILS entry
                 let partialEventData = null;
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'PARTIAL_EVENT_DETAILS') {
                       partialEventData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!partialEventData) {
                   responseContent = 'No event details found. Please start over by saying "create event".';
                   shouldSendSMS = true;
                 } else {
                   // Update the partial event data with the new field
                   const updatedEventData = {
                     ...partialEventData,
                     date: date
                   };
                   
                   // Progressive order: event_name → date → location → time → notes
                   // After date, ask for location
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_location_input',
                       extracted_data: [
                         ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_EVENT_DETAILS'),
                         updatedEventData
                       ]
                     })
                     .eq('user_id', userId);
                   
                   responseContent = "Location?";
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_DATE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in PARTIAL_EVENT_DATE pattern matching:', error);
                 responseContent = 'Failed to process event date. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_DATE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'PARTIAL_EVENT_TIME') {
               console.log('PARTIAL_EVENT_TIME detected via pattern matching, bypassing AI');
               
               try {
                 const startTime = extractedData.start_time;
                 const endTime = extractedData.end_time;
                 
                 // Get current conversation state to find partial event details
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Find the most recent PARTIAL_EVENT_DETAILS entry
                 let partialEventData = null;
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'PARTIAL_EVENT_DETAILS') {
                       partialEventData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!partialEventData) {
                   responseContent = 'No event details found. Please start over by saying "create event".';
                   shouldSendSMS = true;
                 } else {
                   // Update the partial event data with the new field
                   const updatedEventData = {
                     ...partialEventData,
                     start_time: startTime,
                     end_time: endTime ?? partialEventData.end_time
                   };
                   
                   // Progressive order: event_name → date → location → time → notes
                   // After time, ask for notes
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_notes_input',
                       extracted_data: [
                         ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_EVENT_DETAILS'),
                         updatedEventData
                       ]
                     })
                     .eq('user_id', userId);
                   
                   responseContent = "Any notes? Type 'n' to skip.";
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_TIME',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in PARTIAL_EVENT_TIME pattern matching:', error);
                 responseContent = 'Failed to process event time. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_TIME',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'PARTIAL_EVENT_LOCATION') {
               console.log('PARTIAL_EVENT_LOCATION detected via pattern matching, bypassing AI');
               
               try {
                 const location = extractedData.location;
                 
                 // Get current conversation state to find partial event details
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Find the most recent PARTIAL_EVENT_DETAILS entry
                 let partialEventData = null;
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'PARTIAL_EVENT_DETAILS') {
                       partialEventData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!partialEventData) {
                   responseContent = 'No event details found. Please start over by saying "create event".';
                   shouldSendSMS = true;
                 } else {
                   // Update the partial event data with the new field
                   const updatedEventData = {
                     ...partialEventData,
                     location: location
                   };
                   
                   // Progressive order: event_name → date → location → time → notes
                   // After location, ask for time
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_time_input',
                       extracted_data: [
                         ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_EVENT_DETAILS'),
                         updatedEventData
                       ]
                     })
                     .eq('user_id', userId);
                   
                   responseContent = "What time? (e.g. 5pm or 5-7pm, end time optional)";
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_LOCATION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in PARTIAL_EVENT_LOCATION pattern matching:', error);
                 responseContent = 'Failed to process event location. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'PARTIAL_EVENT_LOCATION',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVALID_EVENT_NAME_INPUT') {
              console.log('INVALID_EVENT_NAME_INPUT detected via pattern matching, bypassing AI');
              responseContent = "I didn't understand that. What should we call this event? Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_EVENT_NAME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_DATE_INPUT') {
              console.log('INVALID_DATE_INPUT detected via pattern matching, bypassing AI');
              responseContent = "I didn't understand that. What's the date? (e.g. Oct 20, 10/20, tomorrow). Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_DATE_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_TIME_INPUT') {
              console.log('INVALID_TIME_INPUT detected via pattern matching, bypassing AI');
              responseContent = "I didn't understand that. What time? (e.g. 5pm or 5-7pm). Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_TIME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_LOCATION_INPUT') {
              console.log('INVALID_LOCATION_INPUT detected via pattern matching, bypassing AI');
              responseContent = "I didn't understand that. Where is this event? Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_LOCATION_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_NOTES_INPUT') {
              console.log('INVALID_NOTES_INPUT detected via pattern matching, bypassing AI');
              responseContent = "I didn't understand that. Add a note or type 'n' to skip. Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_NOTES_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'PARTIAL_EVENT_NOTES') {
              console.log('PARTIAL_EVENT_NOTES detected via pattern matching, bypassing AI');
              
              try {
                const notes = extractedData.notes;
                
                // Get current conversation state to find partial event details
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Find the most recent PARTIAL_EVENT_DETAILS entry
                let partialEventData = null;
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'PARTIAL_EVENT_DETAILS') {
                      partialEventData = item;
                      break;
                    }
                  }
                }
                
                if (!partialEventData) {
                  responseContent = 'No event details found. Please start over by saying "create event".';
                  shouldSendSMS = true;
                } else {
                  // Update the partial event data with notes
                  const updatedEventData = {
                    ...partialEventData,
                    notes: notes || null
                  };
                  
                  // All fields collected - show confirmation with new format
                  const finalDate = updatedEventData.date ? convertDayNameToDate(updatedEventData.date) : updatedEventData.date;
                  
                  // Format: Confirm: [Event Name] at [Location] on [Date], [Start Time]-[End Time (optional)] for [Crew Name]. [Note: X (optional)]. Send invites?
                  let confirmation = `Confirm: ${updatedEventData.event_name}`;
                  if (updatedEventData.location) confirmation += ` at ${updatedEventData.location}`;
                  if (finalDate) confirmation += ` on ${formatDateForDisplay(finalDate)}`;
                  if (updatedEventData.start_time) {
                    confirmation += `, ${updatedEventData.start_time}`;
                    if (updatedEventData.end_time && updatedEventData.end_time !== updatedEventData.start_time) {
                      confirmation += `-${updatedEventData.end_time}`;
                    }
                  }
                  confirmation += ` for ${updatedEventData.crew_name}`;
                  if (notes && notes.trim()) confirmation += `. Note: ${notes}`;
                  confirmation += '. Send invites?';
                  
                  responseContent = confirmation;
                  shouldSendSMS = true;
                  
                  // Update conversation state to wait for confirmation
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'event_confirmation',
                      current_state: 'send_invitations_step_3',
                      extracted_data: [
                        ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_EVENT_DETAILS'),
                        {
                          action: 'EVENT_DETAILS_INPUT',
                          crew_id: updatedEventData.crew_id,
                          crew_name: updatedEventData.crew_name,
                          event_name: updatedEventData.event_name,
                          date: finalDate,
                          start_time: updatedEventData.start_time,
                          end_time: updatedEventData.end_time,
                          location: updatedEventData.location,
                          notes: notes || null,
                          timestamp: new Date().toISOString()
                        }
                      ]
                    })
                    .eq('user_id', userId);
                }
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_EVENT_NOTES',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in PARTIAL_EVENT_NOTES pattern matching:', error);
                responseContent = 'Failed to process event notes. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_EVENT_NOTES',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'EVENT_CONFIRMATION_YES') {
               console.log('EVENT_CONFIRMATION_YES detected via pattern matching, bypassing AI');
               
               try {
                 // Get the current conversation state to find the event details
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 let crewId = null;
                 let crewName = '';
                 let eventName = '';
                 let eventDate = '';
                 let startTime = '';
                 let endTime = '';
                 let location = '';
                 let notes = '';
                 
                 // Find event details from extracted_data
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'EVENT_DETAILS_INPUT' && item.crew_id) {
                       crewId = item.crew_id;
                       crewName = item.crew_name;
                       eventName = item.event_name;
                       eventDate = item.date;
                       startTime = item.start_time;
                       endTime = item.end_time;
                       location = item.location;
                       notes = item.notes;
                       break;
                     }
                   }
                 }
                 
                 if (!crewId) {
                   responseContent = 'No event details found. Please start over by saying "create event".';
                   shouldSendSMS = true;
                 } else {
                   // Convert date format for database (YYYY-MM-DD)
                   const dbEventDate = eventDate ? convertDayNameToDate(eventDate) : eventDate;
                   
                   // Convert time format for database (HH:MM:SS)
                   let dbStartTime = '19:00:00'; // default
                   let dbEndTime = null;
                   
                   if (startTime) {
                     // Parse various time formats and convert to HH:MM:SS
                     const timeMatch = startTime.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
                     if (timeMatch) {
                       let hours = parseInt(timeMatch[1]);
                       const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                       const ampm = timeMatch[3]?.toLowerCase();
                       
                       if (ampm === 'pm' && hours !== 12) hours += 12;
                       if (ampm === 'am' && hours === 12) hours = 0;
                       
                       dbStartTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
                     }
                   }
                   
                   if (endTime) {
                     const endTimeMatch = endTime.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
                     if (endTimeMatch) {
                       let hours = parseInt(endTimeMatch[1]);
                       const minutes = endTimeMatch[2] ? parseInt(endTimeMatch[2]) : 0;
                       const ampm = endTimeMatch[3]?.toLowerCase();
                       
                       if (ampm === 'pm' && hours !== 12) hours += 12;
                       if (ampm === 'am' && hours === 12) hours = 0;
                       
                       dbEndTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
                     }
                   }
                   
                   try {
                     // Create the event
                     const { data: eventData, error: eventError } = await supabase
                      .from('events')
                       .insert({
                         creator_id: userId,
                         crew_id: crewId,
                         title: eventName,
                         location: location,
                         event_date: dbEventDate,
                         start_time: dbStartTime,
                         end_time: dbEndTime,
                         notes: notes,
                         status: 'active'
                       })
                       .select()
                       .single();
                     
                     if (eventError) {
                       console.error('Error creating event:', eventError);
                       responseContent = 'Failed to create event. Please try again.';
                       shouldSendSMS = true;
                     } else {
                       console.log('Event created successfully:', eventData.id);
                       
                       // Trigger send invitations for the newly created event
                       try {
                         const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                           method: 'POST',
                           headers: {
                             'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                             'Content-Type': 'application/json'
                           },
                           body: JSON.stringify({
                             event_id: eventData.id,
                             inviting_user_id: userId,
                             crew_id: crewId
                           })
                         });
                         
                         if (sendInvitationsResponse.ok) {
                           const invitationsResult = await sendInvitationsResponse.json();
                           console.log('Invitations sent successfully:', invitationsResult);
                         } else {
                           console.error('Failed to send invitations:', await sendInvitationsResponse.text());
                         }
                       } catch (invitationError) {
                         console.error('Error sending invitations:', invitationError);
                         // Don't fail the event creation if invitations fail
                       }
                       
                      // Get intended recipient count (crew members) for completion message
                      const { data: crewMembers } = await supabase
                        .from('crew_members')
                        .select('id')
                        .eq('crew_id', crewId);
                      const intendedCount = crewMembers ? crewMembers.length : 0;
                      
                      // Update conversation state to completed - clear extracted_data and save only event_id
                       await supabase
                         .from('conversation_state')
                         .update({
                           current_state: 'normal',
                           waiting_for: null, // Clear waiting_for state
                           last_action: 'SEND_INVITATIONS_COMPLETED',
                           last_action_timestamp: new Date().toISOString(),
                           extracted_data: [{
                             action: 'EVENT_CREATED',
                             event_id: eventData.id,
                             timestamp: new Date().toISOString()
                           }] // Store only event_id for the newly created event
                         })
                         .eq('user_id', userId);
                       
                      // Fetch event with shorten_event_url (with retry logic)
                      const { shorten_event_url, event: eventWithUrl } = await fetchEventWithShortUrl(supabase, eventData.id);
                      const eventLink = formatEventLink(eventData.id, shorten_event_url);
                       
                      // Build final confirmation message
                      const displayDate = eventDate ? formatDateForDisplay(eventDate) : '';
                      const timePart = startTime ? `${startTime}${endTime && endTime !== startTime ? `-${endTime}` : ''}` : '';
                      if (intendedCount > 0) {
                        responseContent = `${intendedCount} invites sent for ${eventName}${displayDate ? ` on ${displayDate}` : ''}${timePart ? ` at ${timePart}` : ''}. Check RSVPs: ${eventLink}`;
                      } else {
                        responseContent = `No invites were sent for ${eventName}${displayDate ? ` on ${displayDate}` : ''}${timePart ? ` at ${timePart}` : ''}. Check RSVPs: ${eventLink}`;
                      }
                       shouldSendSMS = true;
                     }
                   } catch (error) {
                     console.error('Error in event creation:', error);
                     responseContent = 'Failed to create event. Please try again.';
                     shouldSendSMS = true;
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EVENT_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in EVENT_CONFIRMATION_YES pattern matching:', error);
                 responseContent = 'Failed to confirm event. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EVENT_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'EVENT_CONFIRMATION_NO') {
               console.log('EVENT_CONFIRMATION_NO detected via pattern matching, bypassing AI');
               
               try {
                 responseContent = 'Event creation cancelled. You can start over anytime by saying "create event".';
                 shouldSendSMS = true;
                 
                 // Update conversation state to normal
                 await supabase
                   .from('conversation_state')
                   .update({
                     waiting_for: null,
                     current_state: 'normal',
                     extracted_data: []
                   })
                   .eq('user_id', userId);
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EVENT_CONFIRMATION_NO',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in EVENT_CONFIRMATION_NO pattern matching:', error);
                 responseContent = 'Failed to cancel event. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EVENT_CONFIRMATION_NO',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE') {
               console.log('INVITE_MORE_PEOPLE detected via pattern matching, bypassing AI');
               
               try {
                 const eventName = extractedData.event_name;
                 
                 // Get user's active events
                 const { data: userEvents } = await supabase
                   .from('events')
                   .select(`
                     id,
                     title,
                     event_date,
                     start_time,
                     location,
                     crews (name)
                   `)
                   .eq('creator_id', userId)
                   .eq('status', 'active')
                   .gte('event_date', new Date().toISOString().split('T')[0])
                   .order('event_date', { ascending: true });
                 
                 if (!userEvents || userEvents.length === 0) {
                   responseContent = 'No events found. Type \'Create Event\' to create your first event.';
                   shouldSendSMS = true;
                 } else {
                   // If event name was provided, try to find a matching event
                   if (eventName) {
                     const matchingEvent = userEvents.find(event => 
                       event.title.toLowerCase().includes(eventName.toLowerCase()) ||
                       eventName.toLowerCase().includes(event.title.toLowerCase())
                     );
                     
                     if (matchingEvent) {
                       // Auto-select the matching event and show uninvited crew members
                       responseContent = await showUninvitedCrewMembers(supabase, matchingEvent, userId, phone_number, send_sms);
                       shouldSendSMS = true;
                       
                       // Set appropriate waiting state based on the response
                       let waitingFor = null;
                       if (responseContent.includes("haven't been invited yet")) {
                         waitingFor = 'send_invites_or_add_members';
                       } else if (responseContent.includes("already invited") || responseContent.includes("No members found")) {
                         waitingFor = 'add_members_or_exit';
                       }
                       
                       if (waitingFor) {
                         await supabase
                           .from('conversation_state')
                           .update({
                             waiting_for: waitingFor,
                             current_state: 'invite_more_people_step_2',
                             extracted_data: [
                               {
                                 action: 'INVITE_MORE_PEOPLE',
                                 event_id: matchingEvent.id,
                                 event_title: matchingEvent.title,
                                 crew_id: matchingEvent.crews?.id,
                                 crew_name: matchingEvent.crews?.name,
                                 timestamp: new Date().toISOString()
                               }
                             ]
                           })
                           .eq('user_id', userId);
                       } else {
                         // Clear conversation state if no specific waiting state
                         await supabase
                           .from('conversation_state')
                           .update({
                             waiting_for: null,
                             current_state: 'normal',
                             extracted_data: [],
                             last_action: null,
                             last_action_timestamp: null
                           })
                           .eq('user_id', userId);
                       }
                     } else {
                       // Event name not found, show available events
                       responseContent = `I couldn't find an event matching "${eventName}". Here are your events:\n\n`;
                       let eventsList = '';
                       userEvents.forEach((event, index) => {
                         const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
                         const formattedDate = eventDate.toLocaleDateString('en-US', {
                           month: 'short',
                           day: 'numeric',
                           hour: 'numeric',
                           minute: '2-digit'
                         });
                         eventsList += `${index + 1}. ${event.title} - ${formattedDate}\n`;
                       });
                       eventsList += '\nReply with the number of your chosen event.';
                       responseContent += eventsList;
                       shouldSendSMS = true;

                       // Update conversation state to wait for event selection
                       await supabase
                         .from('conversation_state')
                         .update({
                           waiting_for: 'invite_more_people_event_selection',
                           current_state: 'invite_more_people_step_1',
                           extracted_data: [
                             {
                               action: 'INVITE_MORE_PEOPLE',
                               substep: 1,
                               available_events: userEvents.map(e => ({ id: e.id, title: e.title }))
                             }
                           ]
                         })
                         .eq('user_id', userId);
                     }
                 } else if (userEvents.length === 1) {
                     // Only one event - use it automatically and show uninvited crew members
                   const event = userEvents[0];
                     responseContent = await showUninvitedCrewMembers(supabase, event, userId, phone_number, send_sms);
                     shouldSendSMS = true;
                     
                     // Set appropriate waiting state based on the response
                     let waitingFor = null;
                     if (responseContent.includes("haven't been invited yet")) {
                       waitingFor = 'send_invites_or_add_members';
                     } else if (responseContent.includes("already invited") || responseContent.includes("No members found")) {
                       waitingFor = 'add_members_or_exit';
                     }
                     
                     if (waitingFor) {
                       await supabase
                         .from('conversation_state')
                         .update({
                           waiting_for: waitingFor,
                           current_state: 'invite_more_people_step_2',
                           extracted_data: [
                             {
                               action: 'INVITE_MORE_PEOPLE',
                     event_id: event.id,
                     event_title: event.title,
                               crew_id: event.crews?.id,
                     crew_name: event.crews?.name,
                     timestamp: new Date().toISOString()
                             }
                           ]
                         })
                         .eq('user_id', userId);
                     } else {
                       // Clear conversation state if no specific waiting state
                       await supabase
                     .from('conversation_state')
                     .update({
                           waiting_for: null,
                           current_state: 'normal',
                           extracted_data: [],
                           last_action: null,
                           last_action_timestamp: null
                     })
                     .eq('user_id', userId);
                   }
                 } else {
                   // Multiple events - ask user to choose
                    let eventsList = 'Invite more people to which event?\n';
                    userEvents.forEach((event, index) => {
                      eventsList += `${index + 1}. ${event.title}\n`;
                    });
                    eventsList += 'Reply with the event number.';
                     
                     responseContent = eventsList;
                   shouldSendSMS = true;
                   
                     // Update conversation state to wait for event selection
                     await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'invite_more_people_event_selection',
                         current_state: 'invite_more_people_step_1',
                         extracted_data: [
                           {
                             action: 'INVITE_MORE_PEOPLE',
                             substep: 1,
                             available_events: userEvents.map(e => ({ id: e.id, title: e.title }))
                           }
                         ]
                     })
                     .eq('user_id', userId);
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE pattern matching:', error);
                 responseContent = 'Failed to process invite more people. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_STEP_2') {
               console.log('INVITE_MORE_PEOPLE_STEP_2 detected via pattern matching, bypassing AI');
               
               try {
                 if (extractedData.event_index !== undefined) {
                   // User selected an event from the list
                   const { data: conversationStateDataData } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                   const eventList = conversationStateDataData?.extracted_data?.find(item => 
                     item.action === 'INVITE_MORE_PEOPLE'
                   )?.available_events;
                   
                   if (eventList && eventList[extractedData.event_index]) {
                     const selectedEvent = eventList[extractedData.event_index];
                     
                     // Get full event details
                     const { data: eventData } = await supabase
                       .from('events')
                       .select(`
                         id,
                         title,
                         event_date,
                         start_time,
                         location,
                         crews (name)
                       `)
                       .eq('id', selectedEvent.id)
                       .single();
                     
                     if (eventData) {
                       // Show uninvited crew members for the selected event
                       responseContent = await showUninvitedCrewMembers(supabase, eventData, userId, phone_number, send_sms);
                       shouldSendSMS = true;
                       
                       // Set appropriate waiting state based on the response
                       let waitingFor = null;
                       if (responseContent.includes("haven't been invited yet")) {
                         waitingFor = 'send_invites_or_add_members';
                       } else if (responseContent.includes("already invited") || responseContent.includes("No members found")) {
                         waitingFor = 'add_members_or_exit';
                       }
                       
                       if (waitingFor) {
                         await supabase
                       .from('conversation_state')
                       .update({
                             waiting_for: waitingFor,
                         current_state: 'invite_more_people_step_2',
                             extracted_data: [
                               {
                                 action: 'INVITE_MORE_PEOPLE_STEP_2',
                                 event_id: eventData.id,
                                 event_title: eventData.title,
                                 crew_id: eventData.crews?.id,
                                 crew_name: eventData.crews?.name,
                                 timestamp: new Date().toISOString()
                               }
                             ]
                       })
                       .eq('user_id', userId);
                     } else {
                         // Clear conversation state if no specific waiting state
                         await supabase
                           .from('conversation_state')
                           .update({
                             waiting_for: null,
                             current_state: 'normal',
                             extracted_data: [],
                             last_action: null,
                             last_action_timestamp: null
                           })
                           .eq('user_id', userId);
                       }
                     } else {
                      responseContent = "I didn't understand that. Reply with an event number or 'exit' to do something else.";
                       shouldSendSMS = true;
                     }
                   } else {
                    responseContent = "I didn't understand that. Reply with an event number or 'exit' to do something else.";
                     shouldSendSMS = true;
                   }
                 } else {
                  responseContent = "I didn't understand that. Reply with an event number or 'exit' to do something else.";
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_2',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_2 pattern matching:', error);
                 responseContent = 'Failed to process event selection. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_2',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_SELECTION_ERROR') {
               console.log('INVITE_MORE_PEOPLE_SELECTION_ERROR detected via pattern matching');
               responseContent = `I didn't understand that. Reply with an event number or 'exit' to do something else.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'INVITE_MORE_PEOPLE_SELECTION_ERROR',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'INVITE_MORE_PEOPLE_STEP_3') {
               console.log('INVITE_MORE_PEOPLE_STEP_3 detected via pattern matching, bypassing AI');
               
               try {
                 // Get existing extracted_data to preserve it
                 const { data: conversationStateDataData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Append to existing extracted_data
                 const existingData = Array.isArray(conversationStateDataData?.extracted_data) ? conversationStateDataData.extracted_data : [];
                 const updatedExtractedData = [...existingData, {
                   action: 'INVITE_MORE_PEOPLE_STEP_3',
                   invite_method: extractedData.invite_method,
                   timestamp: new Date().toISOString()
                 }];
                 
                 if (extractedData.invite_method === 'existing_crew') {
                   // Get current event's crew to exclude it from the list
                   let currentEventCrewId = null;
                   if (existingData.length > 0) {
                     for (let i = existingData.length - 1; i >= 0; i--) {
                       const item = existingData[i];
                       if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                         // Get the crew_id for this event
                         const { data: eventData } = await supabase
                           .from('events')
                           .select('crew_id')
                           .eq('id', item.event_id)
                           .single();
                         currentEventCrewId = eventData?.crew_id;
                         break;
                       }
                     }
                   }
                   
                   // Show crew selection (excluding current event's crew)
                   let crewQuery = supabase
                     .from('crews')
                     .select('id, name')
                     .eq('creator_id', userId)
                     .order('name');
                   
                   if (currentEventCrewId) {
                     crewQuery = crewQuery.neq('id', currentEventCrewId);
                   }
                   
                   const { data: userCrews } = await crewQuery;
                   
                   if (userCrews && userCrews.length > 0) {
                     let crewList = 'Which crew do you want to invite from?\n';
                     userCrews.forEach((crew, index) => {
                       crewList += `${index + 1}. ${crew.name}\n`;
                     });
                     
                     responseContent = crewList;
                     shouldSendSMS = true;
                     
                     // Append crew list to extracted_data for AI context
                     const updatedExtractedDataWithCrewList = [...updatedExtractedData, {
                       action: 'INVITE_MORE_PEOPLE_CREW_LIST_SHOWN',
                       crew_list: userCrews,
                       crew_list_message: crewList,
                       crew_mapping: userCrews.map((crew, index) => ({
                         number: index + 1,
                         crew_id: crew.id,
                         crew_name: crew.name
                       })),
                       timestamp: new Date().toISOString()
                     }];
                     
                     // Update conversation state
                     const { error: updateError } = await supabase
                       .from('conversation_state')
                       .update({
                         current_state: 'invite_more_people_step_3',
                         last_action: 'INVITE_MORE_PEOPLE_STEP_3',
                         last_action_timestamp: new Date().toISOString(),
                         extracted_data: updatedExtractedDataWithCrewList
                       })
                       .eq('user_id', userId);
                     
                     if (updateError) {
                       console.error('Error updating conversation state for crew selection:', updateError);
                       responseContent = 'Sorry, there was an error processing your selection. Please try again.';
                       shouldSendSMS = true;
                     }
                   } else {
                     responseContent = 'No crews found. Please create a crew first or choose "New contacts" option.';
                     shouldSendSMS = true;
                   }
                 } else if (extractedData.invite_method === 'new_contacts') {
                   // Ask for new contacts
                   responseContent = 'Send me the names and phone numbers of people to invite (e.g., "John Smith 555-1234, Jane Doe 555-5678")';
                   shouldSendSMS = true;
                   
                   // Update conversation state to step 3 (waiting for contact details)
                   const { error: updateError } = await supabase
                     .from('conversation_state')
                     .update({
                       current_state: 'invite_more_people_step_3',
                       last_action: 'INVITE_MORE_PEOPLE_STEP_3',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: updatedExtractedData
                     })
                     .eq('user_id', userId);
                   
                   if (updateError) {
                     console.error('Error updating conversation state for new contacts:', updateError);
                     responseContent = 'Sorry, there was an error processing your selection. Please try again.';
                     shouldSendSMS = true;
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_3',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_3 pattern matching:', error);
                 responseContent = 'Failed to process method selection. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_3',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_STEP_4A') {
               console.log('INVITE_MORE_PEOPLE_STEP_4A detected via pattern matching, bypassing AI');
               
               try {
                 // Get crew list from conversation state
                 const { data: conversationStateDataData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 const crewList = conversationStateDataData?.extracted_data?.find(item => 
                   item.action === 'INVITE_MORE_PEOPLE_CREW_LIST_SHOWN'
                 )?.crew_list;
                 
                 if (crewList && crewList[extractedData.crew_index]) {
                   const selectedCrew = crewList[extractedData.crew_index];
                   
                   // Get crew members for the selected crew
                   const { data: crewMembers } = await supabase
                     .from('crew_members')
                     .select(`
                       id,
                       contact_id,
                       role,
                       contacts (first_name, last_name, phone_number)
                     `)
                     .eq('crew_id', selectedCrew.id);
                   
                   if (crewMembers && crewMembers.length > 0) {
                     // Get existing extracted_data to preserve it
                     const existingData = Array.isArray(conversationStateDataData?.extracted_data) ? conversationStateDataData.extracted_data : [];
                     const updatedExtractedData = [...existingData, {
                       action: 'INVITE_MORE_PEOPLE_STEP_4A',
                       crew_id: selectedCrew.id,
                       crew_name: selectedCrew.name,
                       crew_members: crewMembers,
                       timestamp: new Date().toISOString()
                     }];
                     
                     // Update conversation state
                     await supabase
                       .from('conversation_state')
                       .update({
                         current_state: 'invite_more_people_step_4a',
                         last_action: 'INVITE_MORE_PEOPLE_STEP_4A',
                         last_action_timestamp: new Date().toISOString(),
                         extracted_data: updatedExtractedData
                       })
                       .eq('user_id', userId);
                     
                     responseContent = `Found ${crewMembers.length} members in ${selectedCrew.name}. Send invitations to all members? (yes/no)`;
                     shouldSendSMS = true;
                   } else {
                     responseContent = 'No members found in this crew.';
                     shouldSendSMS = true;
                   }
                 } else {
                   responseContent = 'Please select a crew.';
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_4A',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_4A pattern matching:', error);
                 responseContent = 'Failed to process crew selection. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_4A',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
            } else if (action === 'MEMBER_INPUT_FOR_EVENT') {
               console.log('MEMBER_INPUT_FOR_EVENT detected via pattern matching, bypassing AI');
               
               try {
                 // Parse member info from message
                 console.log('Parsing member info from message:', message);
                 const extractedMembers = parseMemberInfo(message);
                 console.log('Extracted members:', extractedMembers);
                 
                 if (extractedMembers.length > 0) {
                   // Get conversation state to find crew info
                   const { data: conversationStateData } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                  let crewId = null;
                  let crewName = '';
                  let eventId = null;
                  
                  // Look for event_id in conversation state
                  if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                    for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                      const item = conversationStateData.extracted_data[i];
                      if (item.action === 'ADD_MEMBERS_TO_EVENT' || item.action === 'INVITE_MORE_PEOPLE' || item.action === 'INVITE_MORE_PEOPLE_STEP_2') {
                        eventId = item.event_id;
                        crewName = item.crew_name || '';
                        break;
                      }
                    }
                  }
                  
                  // If we found an event_id, get crew_id from the event record
                  if (eventId) {
                    const { data: eventData } = await supabase
                      .from('events')
                      .select('crew_id, crews (name)')
                      .eq('id', eventId)
                      .single();
                    
                    if (eventData) {
                      crewId = eventData.crew_id;
                      if (!crewName) crewName = eventData.crews?.name || 'this crew';
                    }
                  }
                  
                  // Database fallback if still no crew found
                  if (!crewId && !eventId) {
                    console.log('MEMBER_INPUT_FOR_EVENT: No crew found in conversation state, trying database fallback');
                    const { data: recentEvent } = await supabase
                      .from('events')
                      .select('id, title, crew_id, crews (name)')
                      .eq('creator_id', userId)
                      .eq('status', 'active')
                      .order('created_at', { ascending: false })
                      .limit(1)
                      .single();
                    
                    if (recentEvent) {
                      eventId = recentEvent.id;
                      crewId = recentEvent.crew_id;
                      crewName = recentEvent.crews?.name || 'this crew';
                      console.log('MEMBER_INPUT_FOR_EVENT: Found crew via database fallback', { crewId, crewName, eventId });
                    }
                  }
                   
                   if (!crewId) {
                     responseContent = 'No crew found. Please try again.';
                     shouldSendSMS = true;
                   } else {
                     // Process each member - check if contact exists, create if not
                     const processedContacts = [];
                     
                     for (const member of extractedMembers) {
                       const firstName = member.name.split(' ')[0];
                       const lastName = member.name.split(' ').slice(1).join(' ') || null;
                       
                       // Check if contact already exists
                       const { data: existingContact } = await supabase
                         .from('contacts')
                         .select('id, first_name, last_name')
                         .eq('user_id', userId)
                         .eq('phone_number', member.phone)
                         .single();
                       
                       if (existingContact) {
                         // Contact exists, use it
                         processedContacts.push(existingContact);
                         console.log(`Using existing contact: ${existingContact.first_name} ${existingContact.last_name || ''}`);
                       } else {
                         // Contact doesn't exist, create it
                         const { data: newContact, error: contactError } = await supabase
                           .from('contacts')
                           .insert({
                             user_id: userId,
                             first_name: firstName,
                             last_name: lastName,
                             phone_number: member.phone
                           })
                           .select('id, first_name, last_name')
                           .single();
                         
                         if (contactError) {
                           console.error('Error creating contact:', contactError);
                           responseContent = `Failed to add ${firstName}. Please try again.`;
                           shouldSendSMS = true;
                           break;
                         } else {
                           processedContacts.push(newContact);
                           console.log(`Created new contact: ${newContact.first_name} ${newContact.last_name || ''}`);
                         }
                       }
                     }
                     
                     if (processedContacts.length === extractedMembers.length) {
                       // All contacts processed successfully, now add them to crew
                       const crewMemberInserts = processedContacts.map(contact => ({
                         crew_id: crewId,
                         contact_id: contact.id
                       }));
                       
                       const { error: crewMemberError } = await supabase
                         .from('crew_members')
                         .insert(crewMemberInserts);
                       
                      if (crewMemberError) {
                        console.error('Error adding contacts to crew:', crewMemberError);
                        responseContent = 'Failed to add contacts to crew. Please try again.';
                        shouldSendSMS = true;
                      } else {
                        const contactNames = processedContacts.map(c => c.last_name ? `${c.first_name} ${c.last_name}` : c.first_name).join(', ');
                        const joinLink = await getCrewJoinLink(supabase, crewId);
                        responseContent = `Added ${contactNames} to ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                        shouldSendSMS = true;
                        
                        // Keep user in the same state (don't exit)
                        // No conversation state update needed
                      }
                     }
                   }
                } else {
                  // Defer invalid handling to INVALID_MEMBER_INPUT_FOR_EVENT
                  responseContent = `I didn't understand that. Add members to your crew by texting member info (eg. Tom 4155551234).`;
                  shouldSendSMS = true;
                }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'MEMBER_INPUT_FOR_EVENT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in MEMBER_INPUT_FOR_EVENT pattern matching:', error);
                 responseContent = 'Failed to process member input. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'MEMBER_INPUT_FOR_EVENT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVALID_ADD_MEMBERS_OR_EXIT_INPUT') {
              console.log('INVALID_ADD_MEMBERS_OR_EXIT_INPUT detected via pattern matching');
              responseContent = `I didn't understand that. Type 'Send Invites' to invite, 'Add Members' to add more people, or 'exit'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_ADD_MEMBERS_OR_EXIT_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
            } else if (action === 'INVITE_MORE_PEOPLE_STEP_4') {
               console.log('INVITE_MORE_PEOPLE_STEP_4 detected via pattern matching, bypassing AI');
               
               try {
                 if (extractedData.contacts && extractedData.contacts.length > 0) {
                   // Get existing extracted_data to preserve it
                   const { data: conversationStateDataData } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                   // Append to existing extracted_data
                   const existingData = Array.isArray(conversationStateDataData?.extracted_data) ? conversationStateDataData.extracted_data : [];
                   const updatedExtractedData = [...existingData, {
                     action: 'INVITE_MORE_PEOPLE_STEP_4',
                     contacts: extractedData.contacts,
                     timestamp: new Date().toISOString()
                   }];
                   
                   // Update conversation state
                   await supabase
                     .from('conversation_state')
                     .update({
                       current_state: 'invite_more_people_step_4',
                       last_action: 'INVITE_MORE_PEOPLE_STEP_4',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: updatedExtractedData
                     })
                     .eq('user_id', userId);
                   
                   // Get event title from conversation state for confirmation message
                   let eventTitle = 'this event';
                   if (conversationStateDataData?.extracted_data && Array.isArray(conversationStateDataData.extracted_data)) {
                     for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
                       const item = conversationStateDataData.extracted_data[i];
                       if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_title) {
                         eventTitle = item.event_title;
                         break;
                       }
                     }
                   }
                   
                   responseContent = `Found ${extractedData.contacts.length} contacts: ${extractedData.contacts.map(c => `${c.name} (${c.phone})`).join(', ')}. Send invitations to "${eventTitle}"? (yes/no)`;
                   shouldSendSMS = true;
                 } else {
                   responseContent = 'No valid contacts found. Please provide names and phone numbers in format "Name Phone".';
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_4',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_4 pattern matching:', error);
                 responseContent = 'Failed to process contacts. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_4',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_STEP_5A') {
               console.log('INVITE_MORE_PEOPLE_STEP_5A detected via pattern matching, bypassing AI');
               
               try {
                 // Get data from conversation state
                 const { data: conversationStateDataData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 let eventId = null;
                 let eventTitle = '';
                 let crewId = null;
                 let crewName = '';
                 let crewMembers = [];
                 
                 if (conversationStateDataData?.extracted_data && Array.isArray(conversationStateDataData.extracted_data)) {
                   // Get event data from step 2
                   for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateDataData.extracted_data[i];
                     if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                       eventId = item.event_id;
                       eventTitle = item.event_title;
                       break;
                     }
                   }
                   
                   // Get crew data from step 4A
                   for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateDataData.extracted_data[i];
                     if (item.action === 'INVITE_MORE_PEOPLE_STEP_4A' && item.crew_id) {
                       crewId = item.crew_id;
                       crewName = item.crew_name;
                       crewMembers = item.crew_members || [];
                       break;
                     }
                   }
                 }
                 
                 if (eventId && crewId && crewMembers.length > 0) {
                   try {
                     // Get the event's crew to add the selected crew members to it
                     const { data: eventData } = await supabase
                       .from('events')
                       .select('crew_id')
                       .eq('id', eventId)
                       .single();
                     
                     if (eventData?.crew_id) {
                       const eventCrewId = eventData.crew_id;
                       
                       // Add crew members to the event's crew
                       const memberIds = crewMembers.map(member => member.id);
                       
                       if (memberIds.length > 0) {
                         // Use send-invitations function to send invitations to specific crew members
                         try {
                           const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                             method: 'POST',
                             headers: {
                               'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                               'Content-Type': 'application/json'
                             },
                             body: JSON.stringify({
                               event_id: eventId,
                               inviting_user_id: userId,
                               selected_member_ids: memberIds
                             })
                           });
                           
                           if (sendInvitationsResponse.ok) {
                             const invitationsResult = await sendInvitationsResponse.json();
                             console.log('Crew invitations sent successfully:', invitationsResult);
                             
                             // Clear conversation state after successful completion
                             await supabase
                               .from('conversation_state')
                               .update({
                                 current_state: 'normal',
                                 waiting_for: null,
                                 last_action: null,
                                 last_action_timestamp: null,
                                 extracted_data: null
                               })
                               .eq('user_id', userId);
                             
                             const invitationsSent = invitationsResult.invitations_sent || memberIds.length;
                             responseContent = `${invitationsSent} more invites sent to ${eventTitle}! Text "RSVPs" to see responses.`;
                             shouldSendSMS = true;
                           } else {
                             console.error('Failed to send crew invitations:', await sendInvitationsResponse.text());
                             responseContent = 'Sorry, there was an error sending invitations. Please try again.';
                             shouldSendSMS = true;
                           }
                         } catch (invitationError) {
                           console.error('Error sending crew invitations:', invitationError);
                           responseContent = 'Sorry, there was an error sending invitations. Please try again.';
                           shouldSendSMS = true;
                         }
                       } else {
                         responseContent = 'No crew members found to invite.';
                         shouldSendSMS = true;
                       }
                     } else {
                      responseContent = "I didn't understand that. Reply with an event number or 'exit' to do something else.";
                       shouldSendSMS = true;
                     }
                   } catch (error) {
                     console.error('Error processing crew invitations:', error);
                     responseContent = 'Sorry, there was an error processing your request. Please try again.';
                     shouldSendSMS = true;
                   }
                 } else {
                   responseContent = 'Missing event or crew information. Please start over.';
                   shouldSendSMS = true;
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_5A',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_5A pattern matching:', error);
                 responseContent = 'Failed to send crew invitations. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_5A',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_STEP_5') {
               console.log('INVITE_MORE_PEOPLE_STEP_5 detected via pattern matching, bypassing AI');
               
               try {
                 // Get data from conversation state
                 const { data: conversationStateDataData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 let eventId = null;
                 let eventTitle = '';
                 let contacts = [];
                 
                 if (conversationStateDataData?.extracted_data && Array.isArray(conversationStateDataData.extracted_data)) {
                   // Get event data from step 2
                   for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateDataData.extracted_data[i];
                     if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                       eventId = item.event_id;
                       eventTitle = item.event_title;
                       break;
                     }
                   }
                   
                   // Get contacts from step 4
                   for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateDataData.extracted_data[i];
                     if (item.action === 'INVITE_MORE_PEOPLE_STEP_4' && item.contacts) {
                       contacts = item.contacts || [];
                       break;
                     }
                   }
                 }
                 
                 if (!eventId || contacts.length === 0) {
                   responseContent = 'No event or contacts found. Please start over by saying "invite more people".';
                   shouldSendSMS = true;
                 } else {
                   try {
                     let invitationsSent = 0;
                     let newContactsCreated = 0;
                     let contactsProcessed = 0;
                     
                     // Get the event's crew information
                     let eventCrewId = null;
                     let eventCrewName = '';
                     
                     // Get crew_id from conversation state if available
                     const { data: eventCrews } = await supabase
                       .from('crews')
                       .select('id, name')
                       .eq('creator_id', userId)
                       .limit(1);
                     
                     if (eventCrews && eventCrews.length > 0) {
                       eventCrewId = eventCrews[0].id;
                       eventCrewName = eventCrews[0].name;
                     }
                     
                     if (!eventCrewId) {
                       responseContent = 'No crew found for this event. Please start over.';
                       shouldSendSMS = true;
                     } else {
                       // Process new contacts and collect their IDs for invitation sending
                       const contactIds = [];
                       
                       for (const contact of contacts) {
                         console.log(`INVITE_MORE_PEOPLE_STEP_4: Processing contact: ${contact.name} (${contact.phone})`);
                         console.log(`INVITE_MORE_PEOPLE_STEP_4: Looking for existing contact with phone: ${contact.phone}`);
                         
                         // Check if contact already exists
                         const { data: existingContact } = await supabase
                           .from('contacts')
                           .select('id')
                           .eq('phone_number', contact.phone)
                           .eq('user_id', userId)
                           .single();
                         
                         let contactId;
                         if (existingContact) {
                           contactId = existingContact.id;
                           contactsProcessed++;
                           console.log(`Using existing contact: ${contact.name} (${contact.phone})`);
                         } else {
                           // Create new contact
                           const { data: newContact, error: contactError } = await supabase
                             .from('contacts')
                             .insert({
                               user_id: userId,
                               first_name: contact.name.split(' ')[0],
                               last_name: contact.name.split(' ').slice(1).join(' ') || '',
                               phone_number: contact.phone
                             })
                             .select()
                             .single();
                           
                           if (contactError) {
                             console.error('Error creating contact:', contactError);
                             continue;
                           }
                           
                           contactId = newContact.id;
                           newContactsCreated++;
                           contactsProcessed++;
                           console.log(`Created new contact: ${contact.name} (${contact.phone})`);
                         }
                         
                         // Add contact as crew member to the event's crew
                         if (contactId && eventCrewId) {
                           const { error: crewMemberError } = await supabase
                             .from('crew_members')
                             .insert({
                               crew_id: eventCrewId,
                               contact_id: contactId
                             });
                           
                           if (crewMemberError) {
                             console.error('Error adding crew member:', crewMemberError);
                           } else {
                             console.log(`Added ${contact.name} as crew member to ${eventCrewName}`);
                           }
                         }
                         
                         // Collect contact ID for invitation sending
                         if (contactId) {
                           contactIds.push(contactId);
                         }
                       }
                       
                       // Get crew member IDs for the contacts we just processed
                       if (contactIds.length > 0) {
                         const { data: crewMembers } = await supabase
                           .from('crew_members')
                           .select('id')
                           .eq('crew_id', eventCrewId)
                           .in('contact_id', contactIds);
                         
                         const memberIds = crewMembers?.map(cm => cm.id) || [];
                         
                         if (memberIds.length > 0) {
                           // Use send-invitations function to send invitations to specific crew members
                           try {
                             const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                               method: 'POST',
                               headers: {
                                 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                                 'Content-Type': 'application/json'
                               },
                               body: JSON.stringify({
                                 event_id: eventId,
                                 inviting_user_id: userId,
                                 selected_member_ids: memberIds
                               })
                             });
                             
                             if (sendInvitationsResponse.ok) {
                               const invitationsResult = await sendInvitationsResponse.json();
                               console.log('Invitations sent successfully:', invitationsResult);
                               invitationsSent = invitationsResult.invitations_sent || memberIds.length;
                             } else {
                               console.error('Failed to send invitations:', await sendInvitationsResponse.text());
                               // If send-invitations fails, fall back to the number of contacts processed
                               invitationsSent = contactsProcessed;
                             }
                           } catch (invitationError) {
                             console.error('Error sending invitations:', invitationError);
                           }
                         }
                       }
                       
                       // Clear conversation state after successful completion
                       await supabase
                         .from('conversation_state')
                         .update({
                           current_state: 'normal',
                           waiting_for: null,
                           last_action: null,
                           last_action_timestamp: null,
                           extracted_data: null
                         })
                         .eq('user_id', userId);
                       
                       let responseMessage = `${invitationsSent} more invites sent to ${eventTitle}!`;
                       if (newContactsCreated > 0) {
                         responseMessage += ` ${newContactsCreated} new contacts added as crew members.`;
                       }
                       responseMessage += ' Text "RSVPs" to see responses.';
                       
                       responseContent = responseMessage;
                       shouldSendSMS = true;
                     }
                   } catch (error) {
                     console.error('Error in INVITE_MORE_PEOPLE:', error);
                     responseContent = 'Failed to send invitations. Please try again.';
                     shouldSendSMS = true;
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_5',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_STEP_5 pattern matching:', error);
                 responseContent = 'Failed to send invitations. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_STEP_5',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'INVITE_MORE_PEOPLE_DECLINED') {
               console.log('INVITE_MORE_PEOPLE_DECLINED detected via pattern matching, bypassing AI');
               
               try {
                 // Clear conversation state
                 await supabase
                   .from('conversation_state')
                   .update({
                     current_state: 'normal',
                     waiting_for: null,
                     last_action: 'INVITE_MORE_PEOPLE_DECLINED',
                     last_action_timestamp: new Date().toISOString(),
                     extracted_data: []
                   })
                   .eq('user_id', userId);
                 
                 responseContent = 'No problem! No additional invitations sent.';
                 shouldSendSMS = true;
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_DECLINED',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in INVITE_MORE_PEOPLE_DECLINED pattern matching:', error);
                 responseContent = 'Failed to process decline. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'INVITE_MORE_PEOPLE_DECLINED',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'SEND_INVITATIONS_WITH_CURRENT_CREW') {
               console.log('SEND_INVITATIONS_WITH_CURRENT_CREW detected via pattern matching, bypassing AI');
               
               try {
                 // Re-fetch conversation state to get the latest data (may have been updated by menu selection)
                 const { data: freshConversationState } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Get the current crew from conversation state
                 let currentCrewId = null;
                 let currentCrewName = null;
                 
                 const stateToCheck = freshConversationState || conversationState;
                 if (stateToCheck?.extracted_data && Array.isArray(stateToCheck.extracted_data)) {
                   for (let i = stateToCheck.extracted_data.length - 1; i >= 0; i--) {
                     const item = stateToCheck.extracted_data[i];
                     // Check for CREW_CREATED in executed_data (from onboarding/crew creation)
                     if (item.executed_data?.action === 'CREW_CREATED' && item.executed_data?.crew_id) {
                       currentCrewId = item.executed_data.crew_id;
                       currentCrewName = item.executed_data.crew_name;
                       break;
                     }
                     // Check for CREW_SELECTED in extracted_data (from menu selection)
                     if (item.action === 'CREW_SELECTED' && item.crew_id) {
                       currentCrewId = item.crew_id;
                       currentCrewName = item.crew_name;
                       break;
                     }
                     // Check for CHECK_CREW_MEMBERS in extracted_data (from crew management menu)
                     if (item.action === 'CHECK_CREW_MEMBERS' && item.crew_id) {
                       currentCrewId = item.crew_id;
                       currentCrewName = item.crew_name;
                       break;
                     }
                   }
                 }
                 
                 if (!currentCrewId) {
                   responseContent = 'No current crew found. Please create a crew first or select a crew.';
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
                 
                // Auto-select the current crew and start progressive event details collection
                responseContent = "What's the Event name?";
                shouldSendSMS = true;
                 
                 // Update conversation state to wait for event name
                 await supabase
                   .from('conversation_state')
                   .update({
                     waiting_for: 'event_name_input',
                     current_state: 'send_invitations_step_2',
                     extracted_data: [
                       ...(stateToCheck?.extracted_data || []),
                       {
                         action: 'CREW_SELECTED_FOR_SEND_INVITATIONS',
                         crew_id: currentCrewId,
                         crew_name: currentCrewName,
                         timestamp: new Date().toISOString()
                       },
                       {
                         action: 'PARTIAL_EVENT_DETAILS',
                         crew_id: currentCrewId,
                         crew_name: currentCrewName,
                         event_name: null,
                         date: null,
                         location: null,
                         start_time: null,
                         end_time: null,
                         notes: null,
                         timestamp: new Date().toISOString()
                       }
                     ]
                   })
                   .eq('user_id', userId);
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               } catch (error) {
                 console.error('Error in SEND_INVITATIONS_WITH_CURRENT_CREW pattern matching:', error);
                 responseContent = 'Failed to create event with current crew. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_INVITATIONS_WITH_CURRENT_CREW',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
             } else if (action === 'SEND_INVITATIONS') {
               console.log('SEND_INVITATIONS detected via pattern matching, bypassing AI');
               
               try {
                 // Check if crew_name was provided in the pattern
                 const requestedCrewName = extractedData.crew_name;
                 
                 // Get user's crews
                 const { data: userCrews, error: crewsError } = await supabase
                   .from('crews')
                   .select('id, name')
                   .eq('creator_id', userId)
                   .order('name');
                 
                 if (crewsError) {
                   console.error('Error fetching crews:', crewsError);
                   responseContent = 'Sorry, I couldn\'t fetch your crews. Please try again.';
                   shouldSendSMS = true;
                 } else if (userCrews && userCrews.length === 0) {
                   responseContent = 'No crews found. Type "Create Crew" to create your first crew.';
                   shouldSendSMS = true;
                 } else if (requestedCrewName) {
                   // User specified a crew name - try to find it
                   const requestedCrew = userCrews.find(crew => 
                     crew.name.toLowerCase() === requestedCrewName.toLowerCase()
                   );
                   
                  if (requestedCrew) {
                    // Found the requested crew - start progressive event details collection
                    responseContent = "What's the Event name?";
                    shouldSendSMS = true;
                     
                     // Update conversation state to wait for event name
                     await supabase
                       .from('conversation_state')
                       .update({
                         waiting_for: 'event_name_input',
                         current_state: 'send_invitations_step_2',
                         extracted_data: [
                           {
                             action: 'SEND_INVITATIONS',
                             substep: 1,
                             crew_id: requestedCrew.id,
                             crew_name: requestedCrew.name,
                           },
                           {
                             action: 'CREW_SELECTED_FOR_SEND_INVITATIONS',
                             crew_id: requestedCrew.id,
                             crew_name: requestedCrew.name,
                             timestamp: new Date().toISOString()
                           },
                           {
                             action: 'PARTIAL_EVENT_DETAILS',
                             crew_id: requestedCrew.id,
                             crew_name: requestedCrew.name,
                             event_name: null,
                             date: null,
                             location: null,
                             start_time: null,
                             end_time: null,
                             notes: null,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       })
                       .eq('user_id', userId);
                   } else {
                     // Crew not found - show available crews
                     let crewList = `Crew "${requestedCrewName}" not found. Create event for which crew?\n`;
                     userCrews.forEach((crew, index) => {
                       crewList += `${index + 1}. ${crew.name}\n`;
                     });
                     crewList += 'Reply with the crew number or "Create Crew" to make a new one.';
                     responseContent = crewList;
                     shouldSendSMS = true;
                     
                     // Update conversation state to wait for crew selection
                     await supabase
                       .from('conversation_state')
                       .update({
                         waiting_for: 'crew_selection_for_send_invitations',
                         current_state: 'send_invitations_step_0',
                         extracted_data: [
                           {
                             action: 'SEND_INVITATIONS',
                             available_crews: userCrews,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       })
                       .eq('user_id', userId);
                   }
                 } else if (userCrews && userCrews.length === 1) {
                   // User has exactly one crew - start progressive event details collection
                   const crew = userCrews[0];
                   
                  // Start progressive workflow - ask for event name first
                  responseContent = "What's the Event name?";
                  shouldSendSMS = true;
                   
                   // Update conversation state to wait for event name
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'event_name_input',
                       current_state: 'send_invitations_step_2',
                       extracted_data: [
                         {
                           action: 'SEND_INVITATIONS',
                           substep: 1,
                           crew_id: crew.id,
                           crew_name: crew.name,
                           timestamp: new Date().toISOString()
                         },
                         {
                           action: 'CREW_SELECTED_FOR_SEND_INVITATIONS',
                           crew_id: crew.id,
                           crew_name: crew.name,
                           timestamp: new Date().toISOString()
                         },
                         {
                           action: 'PARTIAL_EVENT_DETAILS',
                           crew_id: crew.id,
                           crew_name: crew.name,
                           event_name: null,
                           date: null,
                           location: null,
                           start_time: null,
                           end_time: null,
                           notes: null,
                           timestamp: new Date().toISOString()
                         }
                       ]
                     })
                     .eq('user_id', userId);
                 } else {
                   // User has multiple crews - show numbered list for selection
                   let crewList = 'Create event for which crew?\n';
                   userCrews.forEach((crew, index) => {
                     crewList += `${index + 1}. ${crew.name}\n`;
                   });
                   crewList += 'Reply with the crew number.';
                   
                   responseContent = crewList;
                   shouldSendSMS = true;
                   
                   // Update conversation state to wait for crew selection
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'crew_selection_for_send_invitations',
                       current_state: 'send_invitations_step_1',
                       extracted_data: [
                         {
                           action: 'SEND_INVITATIONS',
                           substep: 1,
                           available_crews: userCrews.map(c => ({ id: c.id, name: c.name })),
                           initial_event_details: extractedData.event_details
                         }
                       ]
                     })
                     .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_INVITATIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in SEND_INVITATIONS pattern matching:', error);
                 responseContent = 'Failed to create event. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_INVITATIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'SYNC_UP') {
               console.log('SYNC_UP detected via pattern matching, bypassing AI');
               
               try {
                 // Check if a specific crew name was provided
                 let targetCrew = null;
                 if (extractedData.crewName) {
                   console.log('Crew name extracted from pattern:', extractedData.crewName);
                   
                   // Get user's crews to find the specific crew
                   const { data: userCrews, error: crewsError } = await supabase
                     .from('crews')
                     .select('id, name')
                     .eq('creator_id', userId)
                     .order('name');
                   
                   if (!crewsError && userCrews) {
                     // Find crew by name (case-insensitive)
                     targetCrew = userCrews.find(crew => 
                       crew.name.toLowerCase() === extractedData.crewName.toLowerCase()
                     );
                     
                     if (targetCrew) {
                       console.log('Found target crew:', targetCrew);
                     } else {
                       console.log('Crew not found:', extractedData.crewName);
                     }
                   }
                 }
                 
                 // If specific crew found, proceed with progressive workflow
                 if (targetCrew) {
                   responseContent = "Sync Up helps find times that work for everyone. I'll ask for event details and time options, then your crew votes on what works best.\n\nWhat's the event name?";
                   shouldSendSMS = true;
                   
                   // Update conversation state for progressive workflow
                   const { error: upsertError } = await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       phone_number: phone_number.replace(/\D/g, ''),
                       waiting_for: 'sync_up_event_name_input',
                       current_state: 'sync_up_step_2',
                       extracted_data: [
                         {
                           action: 'SYNC_UP',
                           crew_id: targetCrew.id,
                           crew_name: targetCrew.name,
                           timestamp: new Date().toISOString()
                         },
                         {
                           action: 'PARTIAL_SYNC_UP_DETAILS',
                           crew_id: targetCrew.id,
                           crew_name: targetCrew.name,
                           event_name: null,
                           location: null,
                           time_options_parsed: null,
                           notes: null,
                           timestamp: new Date().toISOString()
                         }
                       ]
                     }, { onConflict: 'user_id' });
                   
                   if (upsertError) {
                     console.error('Error upserting conversation state:', upsertError);
                   } else {
                     console.log('Successfully upserted conversation state for SYNC_UP with specific crew');
                   }
                 } else {
                   // No specific crew or crew not found - show crew selection
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
                     // Single crew - start progressive workflow
                     const crew = userCrews[0];
                     
                     responseContent = "Sync Up helps find times that work for everyone. I'll ask for event details and time options, then your crew votes on what works best.\n\nWhat's the event name?";
                     shouldSendSMS = true;
                     
                     // Update conversation state for progressive workflow
                     const { error: upsertError } = await supabase
                       .from('conversation_state')
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number.replace(/\D/g, ''),
                         waiting_for: 'sync_up_event_name_input',
                         current_state: 'sync_up_step_2',
                         extracted_data: [
                           {
                             action: 'SYNC_UP',
                             crew_id: crew.id,
                             crew_name: crew.name,
                             timestamp: new Date().toISOString()
                           },
                           {
                             action: 'PARTIAL_SYNC_UP_DETAILS',
                             crew_id: crew.id,
                             crew_name: crew.name,
                             event_name: null,
                             location: null,
                             time_options_parsed: null,
                             notes: null,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       }, { onConflict: 'user_id' });
                     
                     if (upsertError) {
                       console.error('Error upserting conversation state:', upsertError);
                     } else {
                       console.log('Successfully upserted conversation state for SYNC_UP');
                     }
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
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number.replace(/\D/g, ''),
                         waiting_for: 'crew_selection_for_sync_up',
                         current_state: 'sync_up_crew_selection',
                         extracted_data: [
                           {
                             action: 'SYNC_UP',
                             crew_list: userCrews,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       }, {
                         onConflict: 'user_id'
                       });
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
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
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
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
                   responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
                   shouldSendSMS = true;
                 } else {
                   const selectedCrew = crewList[crewIndex];
                   
                   responseContent = "Sync Up helps find times that work for everyone. I'll ask for event details and time options, then your crew votes on what works best.\n\nWhat's the event name?";
                   shouldSendSMS = true;
                   
                   // Update conversation state for progressive workflow
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'sync_up_event_name_input',
                       current_state: 'sync_up_step_2',
                       extracted_data: [
                         ...(conversationState?.extracted_data || []).filter(item => item.action !== 'SYNC_UP' && item.action !== 'CREW_SELECTED_FOR_SYNC_UP'),
                         {
                           action: 'SYNC_UP',
                           crew_id: selectedCrew.id,
                           crew_name: selectedCrew.name,
                           timestamp: new Date().toISOString()
                         },
                         {
                           action: 'CREW_SELECTED_FOR_SYNC_UP',
                           crew_id: selectedCrew.id,
                           crew_name: selectedCrew.name,
                           timestamp: new Date().toISOString()
                         },
                         {
                           action: 'PARTIAL_SYNC_UP_DETAILS',
                           crew_id: selectedCrew.id,
                           crew_name: selectedCrew.name,
                           event_name: null,
                           location: null,
                           time_options_parsed: null,
                           notes: null,
                           timestamp: new Date().toISOString()
                         }
                       ]
                     })
                     .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
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
                 responseContent = 'Failed to select crew for sync up. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CREW_SELECTION_SYNC_UP',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            // INVALID_EVENT_DETAILS_INPUT handler removed - using progressive workflow only
            } else if (action === 'SYNC_UP_EVENT_SELECTION') {
              console.log('SYNC_UP_EVENT_SELECTION detected via pattern matching');
              
              try {
                const selectionNumber = extractedData.selection_number;
                
                // Get event list from conversation state
                const eventListData = conversationState?.extracted_data?.find(item => 
                  item.action === 'SYNC_UP_EVENT_LIST_SHOWN'
                );
                
                if (!eventListData || !eventListData.event_list) {
                  responseContent = 'Sorry, I couldn\'t find the event list. Please try "sync up" again.';
                  shouldSendSMS = true;
                } else {
                  const selectedEvent = eventListData.event_list[selectionNumber - 1];
                  
                  if (!selectedEvent) {
                    responseContent = `Invalid selection. Please choose a number between 1 and ${eventListData.event_list.length}.`;
                    shouldSendSMS = true;
                  } else {
                    // Get full event details
                    const { data: eventData } = await supabase
                      .from('events')
                      .select('*')
                      .eq('id', selectedEvent.id)
                      .single();
                    
                    if (eventData) {
                      const eventDate = new Date(`${eventData.event_date}T${eventData.start_time || '00:00:00'}`);
                      const formattedDate = eventDate.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric'
                      });
                      
                      responseContent = `Got it! We'll coordinate "${eventData.title}" on ${formattedDate}.\n\nNow, provide 2-3 time options (e.g., "Thu 6-8pm, Sat 10am-12pm, Sun 2-4pm"):`;
                      
                      // Update conversation state
                      await supabase
                        .from('conversation_state')
                        .update({
                          current_state: 'sync_up_step_2',
                          waiting_for: 'sync_up_details_input',
                          extracted_data: [{
                            action: 'SYNC_UP_EVENT_SELECTED',
                            event_id: eventData.id,
                            event_title: eventData.title,
                            event_date: eventDate,
                            crew_id: conversationState?.extracted_data?.find(item => item.crew_id)?.crew_id,
                            timestamp: new Date().toISOString()
                          }]
                        })
                        .eq('user_id', userId);
                      
                      shouldSendSMS = true;
                    } else {
                      responseContent = 'Sorry, I couldn\'t find that event. Please try again.';
                      shouldSendSMS = true;
                    }
                  }
                }
              } catch (error) {
                console.error('Error in SYNC_UP_EVENT_SELECTION:', error);
                responseContent = 'Failed to select event for sync up. Please try again.';
                shouldSendSMS = true;
              }
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_EVENT_SELECTION',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_DETAILS_INPUT') {
               console.log('SYNC_UP_DETAILS_INPUT detected via pattern matching');
               
               const syncUpDetails = extractedData.sync_up_details;
               
               // Find crew info from extracted_data
               let crewId = null;
               let crewName = null;
               
               if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                 for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                   const item = conversationState.extracted_data[i];
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
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_DETAILS_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // _DEPRECATED: Parse sync up details using custom parser (old single-message flow)
               const parsed = parseSyncUpDetails_DEPRECATED(syncUpDetails);
               
              if (!parsed.isValid) {
                if (parsed.error === 'AMBIGUOUS_EVENT_OR_LOCATION') {
                  responseContent = `I didn't get all of that. Please repeat the event name followed by the location`;
                  
                  // Update conversation state to wait for event name and location
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_event_name_location',
                      current_state: 'sync_up_event_name_location',
                      extracted_data: [
                        ...(conversationState?.extracted_data || []),
                        {
                          action: 'SYNC_UP_AMBIGUOUS_INPUT',
                          crew_id: crewId,
                          crew_name: crewName,
                          saved_time_options: parsed.savedTimeOptions || [],
                          timestamp: new Date().toISOString()
                        }
                      ]
                    })
                    .eq('user_id', userId);
                } else {
                  responseContent = `I didn't understand that. Provide sync up details (event name, location, 2-3 time options) or type 'exit' to cancel.`;
                }
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'SYNC_UP_DETAILS_INPUT',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
               
              // Build confirmation message (new format)
              responseContent = await formatSyncUpConfirmation({
                event_name: parsed.eventName,
                location: parsed.location,
                crew_name: crewName,
                crew_id: crewId,
                time_options_parsed: parsed.timeOptions
              }, supabase);
               shouldSendSMS = true;
               
               // Update conversation state with parsed data
               await supabase
                 .from('conversation_state')
                 .update({
                   waiting_for: 'sync_up_confirmation',
                   current_state: 'sync_up_confirmation',
                   extracted_data: [
                     ...(conversationState?.extracted_data || []),
                     {
                       action: 'SYNC_UP_DETAILS_PARSED',
                       crew_id: crewId,
                       crew_name: crewName,
                       event_name: parsed.eventName,
                       location: parsed.location,
                       time_options_parsed: parsed.timeOptions,
                       timestamp: new Date().toISOString()
                     }
                   ]
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_UP_DETAILS_INPUT',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'SYNC_UP_EVENT_NAME_LOCATION_INPUT') {
               console.log('SYNC_UP_EVENT_NAME_LOCATION_INPUT detected via pattern matching');
               
               const eventName = extractedData.event_name;
               const location = extractedData.location;
               
               // Find saved time options from conversation state
               let savedTimeOptions = [];
               let crewId = null;
               let crewName = null;
               
               if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                 for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                   const item = conversationState.extracted_data[i];
                   if (item.action === 'SYNC_UP_AMBIGUOUS_INPUT') {
                     savedTimeOptions = item.saved_time_options || [];
                     crewId = item.crew_id;
                     crewName = item.crew_name;
                     break;
                   }
                 }
               }
               
               if (!crewId || savedTimeOptions.length === 0) {
                 responseContent = 'No saved time options found. Please start over by saying "sync up".';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_EVENT_NAME_LOCATION_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // Parse the saved time options
               const timeOptions = [];
               for (let i = 0; i < savedTimeOptions.length; i++) {
                 const parsed = parseTimeOption(savedTimeOptions[i], i + 1);
                 if (parsed.isValid) {
                   timeOptions.push(parsed);
                 }
               }
               
               if (timeOptions.length === 0) {
                 responseContent = 'Invalid time options. Please start over by saying "sync up".';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_EVENT_NAME_LOCATION_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // Ask for time options instead of going to confirmation
               responseContent = `Give me 2-3 time options (date, start time, end time optional). Example: 12/19 6-8pm, 12/21 10am`;
               shouldSendSMS = true;
               
               // Update conversation state to wait for time options
               await supabase
                 .from('conversation_state')
                 .update({
                   waiting_for: 'sync_up_time_options_input',
                   current_state: 'sync_up_time_options_input',
                   extracted_data: [
                     ...(conversationState?.extracted_data || []),
                     {
                       action: 'SYNC_UP_EVENT_NAME_LOCATION_PROVIDED',
                       crew_id: crewId,
                       crew_name: crewName,
                       event_name: eventName,
                       location: location,
                       timestamp: new Date().toISOString()
                     }
                   ]
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_UP_EVENT_NAME_LOCATION_INPUT',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'SYNC_UP_EVENT_NAME_LOCATION_ERROR') {
               console.log('SYNC_UP_EVENT_NAME_LOCATION_ERROR detected via pattern matching');
               responseContent = `I didn't get all of that. Please repeat the event name followed by the location`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_UP_EVENT_NAME_LOCATION_ERROR',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               
             } else if (action === 'SYNC_UP_TIME_OPTIONS_INPUT') {
               console.log('SYNC_UP_TIME_OPTIONS_INPUT detected via pattern matching');
               
               const timeOptions = extractedData.time_options;
               
               // Find event name and location from conversation state
               let eventName = null;
               let location = null;
               let crewId = null;
               let crewName = null;
               
               if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                 for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                   const item = conversationState.extracted_data[i];
                   if (item.action === 'SYNC_UP_EVENT_NAME_LOCATION_PROVIDED') {
                     eventName = item.event_name;
                     location = item.location;
                     crewId = item.crew_id;
                     crewName = item.crew_name;
                     break;
                   }
                 }
               }
               
               if (!eventName || !location || !crewId) {
                 responseContent = 'No event details found. Please start over by saying "sync up".';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_TIME_OPTIONS_INPUT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // Build confirmation message
               let confirmMsg = `Sync up details for ${crewName}:\n\n`;
               confirmMsg += `📅 ${eventName}\n`;
               confirmMsg += `📍 ${location}\n\n`;
               confirmMsg += `Time options:\n`;
               timeOptions.forEach((opt, idx) => {
                 const start = new Date(opt.start_time);
                 const end = opt.end_time ? new Date(opt.end_time) : null;
                 const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
                 const startTimeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
                 const endTimeStr = end ? ` - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}` : '';
                 confirmMsg += `${idx + 1}. ${dateStr} ${startTimeStr}${endTimeStr}\n`;
               });
               confirmMsg += `\nSend this sync up? (yes/no)`;
               
               responseContent = confirmMsg;
               shouldSendSMS = true;
               
               // Update conversation state with parsed data
               await supabase
                 .from('conversation_state')
                 .update({
                   waiting_for: 'sync_up_confirmation',
                   current_state: 'sync_up_confirmation',
                   extracted_data: [
                     ...(conversationState?.extracted_data || []),
                     {
                       action: 'SYNC_UP_DETAILS_PARSED',
                       crew_id: crewId,
                       crew_name: crewName,
                       event_name: eventName,
                       location: location,
                       time_options_parsed: timeOptions,
                       timestamp: new Date().toISOString()
                     }
                   ]
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_UP_TIME_OPTIONS_INPUT',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'SYNC_UP_TIME_OPTIONS_ERROR') {
               console.log('SYNC_UP_TIME_OPTIONS_ERROR detected via pattern matching');
               responseContent = `I didn't understand that. Give me 2-3 time options (date, start time, end time optional). Type 'exit' to cancel.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_UP_TIME_OPTIONS_ERROR',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               
             } else if (action === 'INVALID_EVENT_NAME_INPUT') {
               console.log('INVALID_EVENT_NAME_INPUT detected via pattern matching');
               responseContent = `I didn't understand that. What's the event name? Type 'exit' to cancel.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'INVALID_EVENT_NAME_INPUT',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               
             } else if (action === 'INVALID_LOCATION_INPUT') {
               console.log('INVALID_LOCATION_INPUT detected via pattern matching');
               responseContent = `I didn't understand that. What's the location? Type 'exit' to cancel.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'INVALID_LOCATION_INPUT',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               
            } else if (action === 'SYNC_UP_DETAILS_ERROR') {
              console.log('SYNC_UP_DETAILS_ERROR detected via pattern matching');
              responseContent = `I didn't understand that. Provide sync up details (event name, location, 2-3 time options) or type 'exit' to cancel.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_DETAILS_ERROR',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'RE_SYNC_SELECTION') {
               console.log('RE_SYNC_SELECTION detected via pattern matching');
               
               try {
                 const selectionNumber = extractedData.selection_number;
                 
                 // Get sync up list from conversation state
                 const syncUpListData = conversationState?.extracted_data?.find(item => 
                   item.action === 'RE_SYNC_SYNC_UP_LIST_SHOWN'
                 );
                 
                 if (!syncUpListData || !syncUpListData.sync_up_list) {
                   responseContent = 'Sorry, I couldn\'t find the sync up list. Please try "re sync" again.';
                   shouldSendSMS = true;
                 } else {
                   const selectedSyncUp = syncUpListData.sync_up_list[selectionNumber - 1];
                   
                  if (!selectedSyncUp) {
                    responseContent = 'I didn\'t understand that. Reply with a sync up number or \'exit\' to do something else.';
                    shouldSendSMS = true;
                   } else {
                     responseContent = `Add up to 3 new time options for ${selectedSyncUp.name} at ${selectedSyncUp.location}: Date, start time, end time optional. Example: 12/26 6-8pm, 12/28 10am-12pm`;
                     shouldSendSMS = true;
                     
                     // Update conversation state
                     await supabase
                       .from('conversation_state')
                       .update({
                         current_state: 're_sync_time_options',
                         waiting_for: 're_sync_time_options',
                         extracted_data: [
                           ...(conversationState?.extracted_data || []),
                           {
                             action: 'RE_SYNC_SYNC_UP_SELECTED',
                             sync_up_id: selectedSyncUp.id,
                             sync_up_name: selectedSyncUp.name,
                             location: selectedSyncUp.location,
                             crew_id: selectedSyncUp.crews.id,
                             crew_name: selectedSyncUp.crews.name,
                             timestamp: new Date().toISOString()
                           }
                         ]
                       })
                       .eq('user_id', userId);
                   }
                 }
               } catch (error) {
                 console.error('Error in RE_SYNC_SELECTION:', error);
                 responseContent = 'Failed to select sync up. Please try again.';
                 shouldSendSMS = true;
               }
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_SELECTION',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'RE_SYNC_INVALID_SELECTION') {
               console.log('RE_SYNC_INVALID_SELECTION detected via pattern matching');
               
               responseContent = 'I didn\'t understand that. Reply with a sync up number or \'exit\' to do something else.';
               shouldSendSMS = true;
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_INVALID_SELECTION',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'RE_SYNC_INVALID_TIME_OPTIONS') {
               console.log('RE_SYNC_INVALID_TIME_OPTIONS detected via pattern matching');
               
               responseContent = 'I didn\'t understand that. Provide up to 3 date and time options or type \'exit\' to cancel.';
               shouldSendSMS = true;
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_INVALID_TIME_OPTIONS',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'RE_SYNC_TIME_OPTIONS') {
               console.log('RE_SYNC_TIME_OPTIONS detected via pattern matching');
               
               // Use already-parsed time options from extractedData, or parse from message
               let parsed = null;
               if (extractedData.time_options && Array.isArray(extractedData.time_options) && extractedData.time_options.length > 0) {
                 // Time options already parsed by pattern matching
                 parsed = {
                   isValid: true,
                   timeOptions: extractedData.time_options
                 };
               } else {
                 // Parse from message directly
                 parsed = parseReSyncTimeOptions(message);
               }
               
               // Find sync up info from extracted_data
               let syncUpId = null;
               let syncUpName = null;
               let location = null;
               let crewId = null;
               let crewName = null;
               
               if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                 for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                   const item = conversationState.extracted_data[i];
                   if (item.action === 'RE_SYNC_SYNC_UP_SELECTED') {
                     syncUpId = item.sync_up_id;
                     syncUpName = item.sync_up_name;
                     location = item.location;
                     crewId = item.crew_id;
                     crewName = item.crew_name;
                     break;
                   }
                 }
               }
               
               if (!syncUpId) {
                 responseContent = 'No sync up found. Please start over by saying "re sync".';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RE_SYNC_TIME_OPTIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // parsed is already set above
               
               if (!parsed.isValid) {
                 responseContent = `I didn't understand that. Give me up to 3 date and time options. Type 'exit' to cancel.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RE_SYNC_TIME_OPTIONS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               // Build confirmation message
               let confirmMsg = `Confirm: New time options for ${syncUpName} at ${location} for ${crewName}:\n`;
               parsed.timeOptions.forEach((opt, idx) => {
                 const start = new Date(opt.start_time);
                 const end = opt.end_time ? new Date(opt.end_time) : null;
                 const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
                 const startTimeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
                 const endTimeStr = end ? ` - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}` : '';
                 confirmMsg += `${idx + 1}. ${dateStr} ${startTimeStr}${endTimeStr}\n`;
               });
               confirmMsg += `Send to crew members? (yes/no)`;
               
               responseContent = confirmMsg;
               shouldSendSMS = true;
               
               // Update conversation state with parsed data
               await supabase
                 .from('conversation_state')
                 .update({
                   waiting_for: 're_sync_confirmation',
                   current_state: 're_sync_confirmation',
                   extracted_data: [
                     ...(conversationState?.extracted_data || []),
                     {
                       action: 'RE_SYNC_TIME_OPTIONS_PARSED',
                       sync_up_id: syncUpId,
                       sync_up_name: syncUpName,
                       location: location,
                       crew_id: crewId,
                       crew_name: crewName,
                       time_options_parsed: parsed.timeOptions,
                       timestamp: new Date().toISOString()
                     }
                   ]
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_TIME_OPTIONS',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'RE_SYNC_CONFIRMATION_YES') {
               console.log('RE_SYNC_CONFIRMATION_YES detected via pattern matching');
               
               try {
                 // Get sync up data from conversation state
                 let reSyncData = null;
                 if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                   for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationState.extracted_data[i];
                     if (item.action === 'RE_SYNC_TIME_OPTIONS_PARSED') {
                       reSyncData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!reSyncData) {
                   responseContent = 'Re-sync data not found. Please start over.';
                   shouldSendSMS = true;
                 } else {
                   // Delete existing sync_up_options for this sync_up_id
                   const { error: deleteOptionsError } = await supabase
                     .from('sync_up_options')
                     .delete()
                     .eq('sync_up_id', reSyncData.sync_up_id);
                   
                   if (deleteOptionsError) {
                     console.error('Error deleting old sync up options:', deleteOptionsError);
                     responseContent = 'Failed to update sync up options. Please try again.';
                     shouldSendSMS = true;
                   } else {
                     // Insert new sync_up_options
                     const syncUpOptions = reSyncData.time_options_parsed.map(option => ({
                       sync_up_id: reSyncData.sync_up_id,
                       idx: option.idx,
                       start_time: option.start_time,
                       end_time: option.end_time,
                       option_text: option.text
                     }));

                     const { error: optionsError } = await supabase
                       .from('sync_up_options')
                       .insert(syncUpOptions);

                     if (optionsError) {
                       console.error('Error creating new sync up options:', optionsError);
                       responseContent = 'Failed to create new sync up options. Please try again.';
                       shouldSendSMS = true;
                     } else {
                       // Delete all existing sync_up_responses for this sync_up_id
                       const { error: deleteResponsesError } = await supabase
                         .from('sync_up_responses')
                         .delete()
                         .eq('sync_up_id', reSyncData.sync_up_id);

                       if (deleteResponsesError) {
                         console.error('Error deleting old sync up responses:', deleteResponsesError);
                       }

                       // Get crew members for the sync up's crew
                       const { data: crewMembers } = await supabase
                         .from('crew_members')
                         .select('contact_id, contacts(phone_number, first_name)')
                         .eq('crew_id', reSyncData.crew_id);
                       
                       if (crewMembers && crewMembers.length > 0) {
                         // Send new sync up SMS to each member
                         let successCount = 0;
                         for (const member of crewMembers) {
                           if (member.contacts?.phone_number) {
                             let smsMsg = `${reSyncData.crew_name} has new time options for ${reSyncData.sync_up_name} at ${reSyncData.location}.\n\n`;
                             smsMsg += `Which work for you?\n`;
                             reSyncData.time_options_parsed.forEach((opt, idx) => {
                               const start = new Date(opt.start_time);
                               const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
                               const startTimeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                               const end = opt.end_time ? new Date(opt.end_time) : null;
                               const endTimeStr = end ? ` - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
                               smsMsg += `${idx + 1}. ${dateStr} ${startTimeStr}${endTimeStr}\n`;
                             });
                             smsMsg += `\nReply with numbers (e.g. '1 2')`;
                               
                              const result = await sendSMS(member.contacts.phone_number, smsMsg, true, phone_number);
                             if (result.success) {
                               successCount++;
                               
                               // Get the actual contact_id by looking up the contact by phone number
                               let actualContactId = member.contact_id;
                               
                               if (!actualContactId) {
                                 console.log(`⚠️ contact_id is null, looking up by phone: ${member.contacts.phone_number}`);
                                 
                                 // Normalize phone and create variations
                                 const normalizedPhone = member.contacts.phone_number.replace(/\D/g, '');
                                 const phoneVariations = [normalizedPhone];
                                 if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
                                   phoneVariations.push(normalizedPhone.substring(1));
                                 }
                                 if (normalizedPhone.length === 10) {
                                   phoneVariations.push('1' + normalizedPhone);
                                 }
                                 const plusVariations = phoneVariations.map(phone => '+' + phone);
                                 phoneVariations.push(...plusVariations);
                                 
                                 const { data: contactRows } = await supabase
                                   .from('contacts')
                                   .select('id')
                                   .in('phone_number', phoneVariations);
                                 
                                 if (contactRows && contactRows.length > 0) {
                                   actualContactId = contactRows[0].id;
                                   console.log(`✅ Found contact by phone lookup: ${actualContactId}`);
                                 } else {
                                   console.error(`❌ No contact found for phone: ${member.contacts.phone_number}`);
                                 }
                               }
                               
                               // Create conversation_state for crew member
                               console.log(`📝 Creating conversation_state for crew member: phone=${member.contacts.phone_number}`);
                               
                               // First, delete any existing conversation_state for this phone
                               await supabase
                                 .from('conversation_state')
                                 .delete()
                                 .eq('phone_number', member.contacts.phone_number);
                               
                               const { data: convStateData, error: convStateError } = await supabase
                                 .from('conversation_state')
                                 .insert({
                                   phone_number: member.contacts.phone_number,
                                   waiting_for: 'sync_up_response',
                                   current_state: 'sync_up_response',
                                   extracted_data: [{
                                     action: 'SYNC_UP_RECEIVED',
                                     sync_up_id: reSyncData.sync_up_id,
                                     sync_up_name: reSyncData.sync_up_name,
                                     crew_name: reSyncData.crew_name,
                                     location: reSyncData.location,
                                     time_options: reSyncData.time_options_parsed,
                                     contact_id: actualContactId,
                                     timestamp: new Date().toISOString()
                                   }]
                                 });
                               
                               if (convStateError) {
                                 console.error(`❌ Error creating conversation_state:`, convStateError);
                               } else {
                                 console.log(`✅ Conversation_state created successfully`);
                               }
                               
                               if (actualContactId) {
                                 // Create response record for sync up
                                 console.log(`📝 Creating sync_up_responses: contact_id=${actualContactId}, sync_up_id=${reSyncData.sync_up_id}`);
                                 const { data: responseData, error: responseError } = await supabase
                                   .from('sync_up_responses')
                                   .upsert({
                                     contact_id: actualContactId,
                                     sync_up_id: reSyncData.sync_up_id,
                                     option_ids: [],
                                     response_type: 'selected'
                                   }, {
                                     onConflict: 'contact_id,sync_up_id'
                                   });
                                 
                                 if (responseError) {
                                   console.error(`❌ Error creating sync_up_responses:`, responseError);
                                 } else {
                                   console.log(`✅ sync_up_responses created successfully`);
                                 }
                               } else {
                                 console.error(`❌ Skipping sync_up_responses creation - no valid contact_id`);
                               }
                             }
                           }
                         }
                         
                         // Build confirmation message with dates
                         const dateOptions = reSyncData.time_options_parsed.map(opt => {
                           const start = new Date(opt.start_time);
                           return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                         }).join(' or ');
                         
                         responseContent = `New time options sent to ${successCount} members for ${reSyncData.sync_up_name} on ${dateOptions}. Text 'Sync Check' to see responses or to send invitations.`;
                         shouldSendSMS = true;
                         
                         // Clear conversation state for host
                         await supabase
                           .from('conversation_state')
                           .update({
                             current_state: 'normal',
                             waiting_for: null,
                             extracted_data: [],
                             last_action: 'RE_SYNC_CONFIRMATION_YES',
                             last_action_timestamp: new Date().toISOString()
                           })
                           .eq('user_id', userId);
                       } else {
                         responseContent = 'No crew members found for this sync up.';
                         shouldSendSMS = true;
                       }
                     }
                   }
                 }
               } catch (error) {
                 console.error('Error in RE_SYNC_CONFIRMATION_YES:', error);
                 responseContent = 'Failed to send new time options. Please try again.';
                 shouldSendSMS = true;
               }
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_CONFIRMATION_YES',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else  if (action === 'RE_SYNC_CONFIRMATION_NO') {
               console.log('RE_SYNC_CONFIRMATION_NO detected via pattern matching');
               
               responseContent = 'What would you like to change? Type \'exit\' to cancel.';
               shouldSendSMS = true;
               
               // Update conversation state to go back to time options
               await supabase
                 .from('conversation_state')
                 .update({
                   current_state: 're_sync_time_options',
                   waiting_for: 're_sync_time_options',
                   extracted_data: conversationState?.extracted_data || []
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_CONFIRMATION_NO',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'RE_SYNC_CONFIRMATION_INVALID') {
               console.log('RE_SYNC_CONFIRMATION_INVALID detected via pattern matching');
               
               responseContent = 'I didn\'t understand that. Reply \'yes\' to send new options, \'no\' to make changes, or \'exit\' to cancel.';
               shouldSendSMS = true;
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC_CONFIRMATION_INVALID',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
               
             } else if (action === 'SYNC_UP_CONFIRMATION_YES') {
               console.log('SYNC_UP_CONFIRMATION_YES detected via pattern matching');
               
               try {
                 // Get sync up data from conversation state
                 let syncUpData = null;
                 if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                   for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationState.extracted_data[i];
                     if (item.action === 'SYNC_UP_DETAILS_PARSED') {
                       syncUpData = item;
                       break;
                     }
                   }
                 }
                 
                 if (!syncUpData) {
                   responseContent = 'Sync up data not found. Please start over.';
                   shouldSendSMS = true;
                 } else {
                   // Create event with status 'pending' for sync up
                   console.log('Creating sync up event with data:', {
                     title: syncUpData.event_name,
                     event_date: syncUpData.time_options_parsed[0].start_time,
                     location: syncUpData.location,
                     creator_id: userId,
                     crew_id: syncUpData.crew_id,
                     status: 'pending'
                   });
                   
                   const { data: newEvent, error: eventError } = await supabase
                    .from('events')
                    .insert({
                       title: syncUpData.event_name,
                       event_date: syncUpData.time_options_parsed[0].start_time,
                       location: syncUpData.location,
                       creator_id: userId,
                       crew_id: syncUpData.crew_id,
                       status: 'pending'
                     })
                     .select()
                     .single();
                   
                   if (eventError || !newEvent) {
                     console.error('Error creating sync up event:', eventError);
                     console.error('Event creation failed with error details:', JSON.stringify(eventError, null, 2));
                     responseContent = `Failed to create sync up. Error: ${eventError?.message || 'Unknown error'}. Please try again.`;
                     shouldSendSMS = true;
                   } else {
                     console.log('Sync up event created successfully:', newEvent);
                     
                     // Create sync_up record
                     const { data: syncUpRecord, error: syncUpError } = await supabase
                       .from('sync_ups')
                       .insert({
                         creator_id: userId,
                         event_id: newEvent.id,
                         crew_id: syncUpData.crew_id,
                         name: syncUpData.event_name,
                         location: syncUpData.location,
                         status: 'sent'
                       })
                       .select()
                       .single();
                     
                     if (syncUpError) {
                       console.error('Error creating sync up record:', syncUpError);
                       responseContent = 'Failed to create sync up record. Please try again.';
                       shouldSendSMS = true;
                     } else {
                       // Create sync up options
                       const syncUpOptions = syncUpData.time_options_parsed.map(option => ({
                         sync_up_id: syncUpRecord.id,
                         idx: option.idx,
                         start_time: option.start_time,
                         end_time: option.end_time,
                         option_text: option.text
                       }));

                       const { error: optionsError } = await supabase
                         .from('sync_up_options')
                         .insert(syncUpOptions);

                       if (optionsError) {
                         console.error('Error creating sync up options:', optionsError);
                         responseContent = 'Failed to create sync up options. Please try again.';
                         shouldSendSMS = true;
                       } else {
                         // Get crew members for the event's crew
                         const { data: crewMembers } = await supabase
                           .from('crew_members')
                           .select('contact_id, contacts(phone_number, first_name)')
                           .eq('crew_id', syncUpData.crew_id);
                         
                         if (crewMembers && crewMembers.length > 0) {
                           // Get host name from profile
                           let hostName = syncUpData.crew_name; // Fallback to crew name
                           try {
                             const { data: profileData } = await supabase
                               .from('profiles')
                               .select('first_name, last_name')
                               .eq('id', userId)
                               .single();
                             
                             if (profileData) {
                               hostName = profileData.last_name 
                                 ? `${profileData.first_name} ${profileData.last_name}` 
                                 : profileData.first_name || syncUpData.crew_name;
                             }
                           } catch (err) {
                             console.log('Could not fetch host name, using crew name:', err);
                           }
                           
                           // Helper function to format time option in simple format (e.g., "Thu 12/19 6-8pm")
                           const formatTimeOptionSimple = (startTime: string, endTime: string | null): string => {
                             const start = new Date(startTime);
                             const weekday = start.toLocaleDateString('en-US', { weekday: 'short' });
                             const monthDay = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                             
                             // Format time as 6pm, 6-8pm, 10am-12pm
                             const formatTime = (date: Date): string => {
                               const hours = date.getHours();
                               const minutes = date.getMinutes();
                               const ampm = hours >= 12 ? 'pm' : 'am';
                               const hour12 = hours % 12 || 12;
                               return minutes === 0 ? `${hour12}${ampm}` : `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
                             };
                             
                             const startTimeStr = formatTime(start);
                             
                             if (endTime) {
                               const end = new Date(endTime);
                               const endTimeStr = formatTime(end);
                               // Check if same AM/PM period
                               const samePeriod = (start.getHours() >= 12) === (end.getHours() >= 12);
                               if (samePeriod && start.getHours() < 12 && end.getHours() < 12) {
                                 // Both AM: "6-8am"
                                 return `${weekday} ${monthDay} ${startTimeStr}-${endTimeStr}`;
                               } else if (samePeriod && start.getHours() >= 12 && end.getHours() >= 12) {
                                 // Both PM: "6-8pm" (start hour without ampm suffix)
                                 const startHour = start.getHours() % 12 || 12;
                                 const startMin = start.getMinutes();
                                 const startPart = startMin === 0 ? `${startHour}` : `${startHour}:${String(startMin).padStart(2, '0')}`;
                                 return `${weekday} ${monthDay} ${startPart}-${endTimeStr}`;
                               } else {
                                 // Different periods: "10am-12pm"
                                 return `${weekday} ${monthDay} ${startTimeStr}-${endTimeStr}`;
                               }
                             } else {
                               return `${weekday} ${monthDay} ${startTimeStr}`;
                             }
                           };
                           
                           // Send sync up SMS to each member and update their conversation state
                           let successCount = 0;
                           for (const member of crewMembers) {
                             if (member.contacts?.phone_number) {
                               // Format: "[Host Name] wants to find time for [Event Name] at [Location]. Which work for you?"
                               let smsMsg = `${hostName} wants to find time for ${syncUpData.event_name} at ${syncUpData.location}. Which work for you? `;
                               
                               // Add time options in format: "1. Thu 12/19 6-8pm 2. Sat 12/21 10am-12pm"
                               syncUpData.time_options_parsed.forEach((opt, idx) => {
                                 const timeStr = formatTimeOptionSimple(opt.start_time, opt.end_time || null);
                                 smsMsg += `${idx + 1}. ${timeStr} `;
                               });
                               
                               // Add reply instructions
                               smsMsg += `Reply with numbers (e.g. '1 2'). Reply 'none' if these don't work.`;
                               
                               const result = await sendSMS(member.contacts.phone_number, smsMsg, true, phone_number);
                              if (result.success) {
                                successCount++;
                                
                               // Get the actual contact_id by looking up the contact by phone number
                               let actualContactId = member.contact_id;
                               
                               if (!actualContactId) {
                                 console.log(`⚠️ contact_id is null, looking up by phone: ${member.contacts.phone_number}`);
                                 
                                 // Normalize phone and create variations
                                 const normalizedPhone = member.contacts.phone_number.replace(/\D/g, '');
                                 const phoneVariations = [normalizedPhone];
                                 if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
                                   phoneVariations.push(normalizedPhone.substring(1));
                                 }
                                 if (normalizedPhone.length === 10) {
                                   phoneVariations.push('1' + normalizedPhone);
                                 }
                                 const plusVariations = phoneVariations.map(phone => '+' + phone);
                                 phoneVariations.push(...plusVariations);
                                 
                                 const { data: contactRows } = await supabase
                                   .from('contacts')
                                   .select('id')
                                   .in('phone_number', phoneVariations);
                                 
                                 if (contactRows && contactRows.length > 0) {
                                   actualContactId = contactRows[0].id;
                                   console.log(`✅ Found contact by phone lookup: ${actualContactId}`);
                                 } else {
                                   console.error(`❌ No contact found for phone: ${member.contacts.phone_number}`);
                                 }
                               }
                               
                               // Always create conversation_state by phone_number (crew members don't have user_id/profile)
                               console.log(`📝 Creating conversation_state for crew member: phone=${member.contacts.phone_number}`);
                               
                               // First, delete any existing conversation_state for this phone to ensure only 1 record
                               await supabase
                                 .from('conversation_state')
                                 .delete()
                                 .eq('phone_number', member.contacts.phone_number);
                               
                               const { data: convStateData, error: convStateError } = await supabase
                                 .from('conversation_state')
                                 .insert({
                                   phone_number: member.contacts.phone_number,
                                   waiting_for: 'sync_up_response',
                                   current_state: 'sync_up_response',
                                   extracted_data: [{
                                     action: 'SYNC_UP_RECEIVED',
                                     sync_up_id: syncUpRecord.id,
                                     sync_up_name: syncUpData.event_name,
                                     crew_name: syncUpData.crew_name,
                                     location: syncUpData.location,
                                     time_options: syncUpData.time_options_parsed,
                                     contact_id: actualContactId, // Store contact_id in extracted_data for reference
                                     timestamp: new Date().toISOString()
                                   }]
                                 });
                               
                               if (convStateError) {
                                 console.error(`❌ Error creating conversation_state:`, convStateError);
                               } else {
                                 console.log(`✅ Conversation_state created successfully`);
                               }
                               
                               if (actualContactId) {
                                 // Create response record for sync up (initially empty)
                                 console.log(`📝 Creating sync_up_responses: contact_id=${actualContactId}, sync_up_id=${syncUpRecord.id}`);
                                 const { data: responseData, error: responseError } = await supabase
                                   .from('sync_up_responses')
                                   .upsert({
                                     contact_id: actualContactId,
                                     sync_up_id: syncUpRecord.id,
                                     option_ids: [], // Empty until crew member responds
                                     response_type: 'selected' // Will be updated when they respond
                                   }, {
                                     onConflict: 'contact_id,sync_up_id'
                                   });
                                 
                                 if (responseError) {
                                   console.error(`❌ Error creating sync_up_responses:`, responseError);
                                 } else {
                                   console.log(`✅ sync_up_responses created successfully`);
                                 }
                               } else {
                                 console.error(`❌ Skipping sync_up_responses creation - no valid contact_id`);
                               }
                              }
                             }
                           }
                           
                           responseContent = `Sync up sent to ${successCount} crew member${successCount !== 1 ? 's' : ''} for ${syncUpData.event_name}. Text 'Sync Check' to see responses or to send invitations.`;
                           shouldSendSMS = true;
                         } else {
                           responseContent = 'No crew members found to send sync up to.';
                           shouldSendSMS = true;
                         }
                       }
                     }
                   }
                   
                   // Clear conversation state
                   await supabase
                     .from('conversation_state')
                     .delete()
                     .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in SYNC_UP_CONFIRMATION_YES:', error);
                 responseContent = 'Failed to send sync up. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_UP_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
            } else if (action === 'SYNC_UP_CHANGE_LOCATION') {
              console.log('SYNC_UP_CHANGE_LOCATION detected via pattern matching');
              
              const newLocation = extractedData.location;
              
              // Find the sync up data in conversation state and update location
              let syncUpData = null;
              if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                  const item = conversationState.extracted_data[i];
                  if (item.action === 'SYNC_UP_DETAILS_PARSED') {
                    syncUpData = item;
                    break;
                  }
                }
              }
              
              if (!syncUpData) {
                responseContent = 'Sync up data not found. Please start over.';
                shouldSendSMS = true;
              } else {
                // Update the location in the sync up data
                syncUpData.location = newLocation;
                
                // Update conversation state with modified data
                const updatedExtractedData = [...(conversationState?.extracted_data || [])];
                const syncUpIndex = updatedExtractedData.findIndex(item => item.action === 'SYNC_UP_DETAILS_PARSED');
                if (syncUpIndex !== -1) {
                  updatedExtractedData[syncUpIndex] = syncUpData;
                }
                
                await supabase
                  .from('conversation_state')
                  .update({
                    extracted_data: updatedExtractedData,
                    last_action: 'SYNC_UP_CHANGE_LOCATION',
                    last_action_timestamp: new Date().toISOString()
                  })
                  .eq('user_id', userId);
                
                // Rebuild confirmation message with new format
                responseContent = await formatSyncUpConfirmation({
                  ...syncUpData,
                  location: newLocation
                }, supabase);
                shouldSendSMS = true;
                
                // Update state back to confirmation
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'sync_up_confirmation',
                    current_state: 'sync_up_confirmation'
                  })
                  .eq('user_id', userId);
              }
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CHANGE_LOCATION',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_CHANGE_EVENT_NAME') {
              console.log('SYNC_UP_CHANGE_EVENT_NAME detected via pattern matching');
              
              const newEventName = extractedData.eventName;
              
              // Find the sync up data in conversation state and update event name
              let syncUpData = null;
              if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                  const item = conversationState.extracted_data[i];
                  if (item.action === 'SYNC_UP_DETAILS_PARSED') {
                    syncUpData = item;
                    break;
                  }
                }
              }
              
              if (!syncUpData) {
                responseContent = 'Sync up data not found. Please start over.';
                shouldSendSMS = true;
              } else {
                // Update the event name in the sync up data
                syncUpData.event_name = newEventName;
                
                // Update conversation state with modified data
                const updatedExtractedData = [...(conversationState?.extracted_data || [])];
                const syncUpIndex = updatedExtractedData.findIndex(item => item.action === 'SYNC_UP_DETAILS_PARSED');
                if (syncUpIndex !== -1) {
                  updatedExtractedData[syncUpIndex] = syncUpData;
                }
                
                await supabase
                  .from('conversation_state')
                  .update({
                    extracted_data: updatedExtractedData,
                    last_action: 'SYNC_UP_CHANGE_EVENT_NAME',
                    last_action_timestamp: new Date().toISOString()
                  })
                  .eq('user_id', userId);
                
                // Rebuild confirmation message with new format
                responseContent = await formatSyncUpConfirmation({
                  ...syncUpData,
                  event_name: newEventName
                }, supabase);
                shouldSendSMS = true;
                
                // Update state back to confirmation
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'sync_up_confirmation',
                    current_state: 'sync_up_confirmation'
                  })
                  .eq('user_id', userId);
              }
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CHANGE_EVENT_NAME',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_CHANGE_TIME_OPTIONS') {
              console.log('SYNC_UP_CHANGE_TIME_OPTIONS detected via pattern matching');
              
              const rawTimeOptions = extractedData.raw;
              
              // Parse the new time options using existing parser
              const timeOptionsResult = parseReSyncTimeOptions(rawTimeOptions);
              
              if (!timeOptionsResult.isValid || timeOptionsResult.timeOptions.length < 1) {
                responseContent = 'I didn\'t understand that. Give me up to 3 date and time options. Example: 12/26 6-8pm, 12/28 10am';
                shouldSendSMS = true;
                
                // Keep in change request state
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'sync_up_change_request',
                    current_state: 'sync_up_change'
                  })
                  .eq('user_id', userId);
              } else {
                // Find the sync up data in conversation state and update time options
                let syncUpData = null;
                if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                  for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationState.extracted_data[i];
                    if (item.action === 'SYNC_UP_DETAILS_PARSED') {
                      syncUpData = item;
                      break;
                    }
                  }
                }
                
                if (!syncUpData) {
                  responseContent = 'Sync up data not found. Please start over.';
                  shouldSendSMS = true;
                } else {
                  // Update the time options in the sync up data
                  syncUpData.time_options_parsed = timeOptionsResult.timeOptions;
                  
                  // Update conversation state with modified data
                  const updatedExtractedData = [...(conversationState?.extracted_data || [])];
                  const syncUpIndex = updatedExtractedData.findIndex(item => item.action === 'SYNC_UP_DETAILS_PARSED');
                  if (syncUpIndex !== -1) {
                    updatedExtractedData[syncUpIndex] = syncUpData;
                  }
                  
                  await supabase
                    .from('conversation_state')
                    .update({
                      extracted_data: updatedExtractedData,
                      last_action: 'SYNC_UP_CHANGE_TIME_OPTIONS',
                      last_action_timestamp: new Date().toISOString()
                    })
                    .eq('user_id', userId);
                  
                  // Rebuild confirmation message with new format
                  responseContent = await formatSyncUpConfirmation({
                    ...syncUpData,
                    time_options_parsed: timeOptionsResult.timeOptions
                  }, supabase);
                  shouldSendSMS = true;
                  
                  // Update state back to confirmation
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_confirmation',
                      current_state: 'sync_up_confirmation'
                    })
                    .eq('user_id', userId);
                }
              }
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CHANGE_TIME_OPTIONS',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_CHANGE_INVALID') {
              console.log('SYNC_UP_CHANGE_INVALID detected via pattern matching');
              
              responseContent = 'I didn\'t understand that. Tell me what to change (event name, location, time options, etc.) or type \'exit\' to cancel.';
              shouldSendSMS = true;
              
              // Keep in change request state
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'sync_up_change_request',
                  current_state: 'sync_up_change',
                  last_action: 'SYNC_UP_CHANGE_INVALID',
                  last_action_timestamp: new Date().toISOString()
                })
                .eq('user_id', userId);
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CHANGE_INVALID',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            // Progressive SYNC_UP workflow handlers
            } else if (action === 'PARTIAL_SYNC_UP_EVENT_NAME') {
              console.log('PARTIAL_SYNC_UP_EVENT_NAME detected via pattern matching, bypassing AI');
              
              try {
                const eventName = extractedData.event_name;
                
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                let partialSyncUpData = null;
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'PARTIAL_SYNC_UP_DETAILS') {
                      partialSyncUpData = item;
                      break;
                    }
                  }
                }
                
                if (!partialSyncUpData) {
                  responseContent = 'No sync up data found. Please start over by saying "sync up".';
                  shouldSendSMS = true;
                } else {
                  const updatedSyncUpData = {
                    ...partialSyncUpData,
                    event_name: eventName
                  };
                  
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_location_input',
                      extracted_data: [
                        ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_SYNC_UP_DETAILS'),
                        updatedSyncUpData
                      ]
                    })
                    .eq('user_id', userId);
                  
                  responseContent = "Location?";
                  shouldSendSMS = true;
                }
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_EVENT_NAME',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in PARTIAL_SYNC_UP_EVENT_NAME pattern matching:', error);
                responseContent = 'Failed to process event name. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_EVENT_NAME',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'PARTIAL_SYNC_UP_LOCATION') {
              console.log('PARTIAL_SYNC_UP_LOCATION detected via pattern matching, bypassing AI');
              
              try {
                const location = extractedData.location;
                
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                let partialSyncUpData = null;
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'PARTIAL_SYNC_UP_DETAILS') {
                      partialSyncUpData = item;
                      break;
                    }
                  }
                }
                
                if (!partialSyncUpData) {
                  responseContent = 'No sync up data found. Please start over by saying "sync up".';
                  shouldSendSMS = true;
                } else {
                  const updatedSyncUpData = {
                    ...partialSyncUpData,
                    location: location
                  };
                  
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_time_options_input',
                      extracted_data: [
                        ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_SYNC_UP_DETAILS'),
                        updatedSyncUpData
                      ]
                    })
                    .eq('user_id', userId);
                  
                  responseContent = "Give me 1-3 time options (date and time for each). Example: 12/19 6-8pm, 12/21 10am (end time optional).";
                  shouldSendSMS = true;
                }
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_LOCATION',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in PARTIAL_SYNC_UP_LOCATION pattern matching:', error);
                responseContent = 'Failed to process location. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_LOCATION',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'PARTIAL_SYNC_UP_TIME_OPTIONS') {
              console.log('PARTIAL_SYNC_UP_TIME_OPTIONS detected via pattern matching, bypassing AI');
              
              try {
                const timeOptions = extractedData.time_options;
                
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                let partialSyncUpData = null;
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'PARTIAL_SYNC_UP_DETAILS') {
                      partialSyncUpData = item;
                      break;
                    }
                  }
                }
                
                if (!partialSyncUpData) {
                  responseContent = 'No sync up data found. Please start over by saying "sync up".';
                  shouldSendSMS = true;
                } else {
                  const updatedSyncUpData = {
                    ...partialSyncUpData,
                    time_options_parsed: timeOptions
                  };
                  
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_notes_input',
                      extracted_data: [
                        ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_SYNC_UP_DETAILS'),
                        updatedSyncUpData
                      ]
                    })
                    .eq('user_id', userId);
                  
                  responseContent = "Any notes? Type 'n' to skip.";
                  shouldSendSMS = true;
                }
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_TIME_OPTIONS',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in PARTIAL_SYNC_UP_TIME_OPTIONS pattern matching:', error);
                responseContent = 'Failed to process time options. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_TIME_OPTIONS',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'PARTIAL_SYNC_UP_NOTES') {
              console.log('PARTIAL_SYNC_UP_NOTES detected via pattern matching, bypassing AI');
              
              try {
                const notes = extractedData.notes;
                
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                let partialSyncUpData = null;
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'PARTIAL_SYNC_UP_DETAILS') {
                      partialSyncUpData = item;
                      break;
                    }
                  }
                }
                
                if (!partialSyncUpData) {
                  responseContent = 'No sync up data found. Please start over by saying "sync up".';
                  shouldSendSMS = true;
                } else {
                  const finalSyncUpData = {
                    ...partialSyncUpData,
                    notes: notes || null
                  };
                  
                  // Build confirmation message
                  responseContent = await formatSyncUpConfirmation({
                    event_name: finalSyncUpData.event_name,
                    location: finalSyncUpData.location,
                    crew_name: finalSyncUpData.crew_name,
                    crew_id: finalSyncUpData.crew_id,
                    time_options_parsed: finalSyncUpData.time_options_parsed,
                    notes: finalSyncUpData.notes
                  }, supabase);
                  
                  shouldSendSMS = true;
                  
                  await supabase
                    .from('conversation_state')
                    .update({
                      waiting_for: 'sync_up_confirmation',
                      current_state: 'sync_up_confirmation',
                      extracted_data: [
                        ...(conversationStateData?.extracted_data || []).filter(item => item.action !== 'PARTIAL_SYNC_UP_DETAILS'),
                        {
                          action: 'SYNC_UP_DETAILS_PARSED',
                          crew_id: finalSyncUpData.crew_id,
                          crew_name: finalSyncUpData.crew_name,
                          event_name: finalSyncUpData.event_name,
                          location: finalSyncUpData.location,
                          time_options_parsed: finalSyncUpData.time_options_parsed,
                          notes: finalSyncUpData.notes,
                          timestamp: new Date().toISOString()
                        }
                      ]
                    })
                    .eq('user_id', userId);
                }
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_NOTES',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in PARTIAL_SYNC_UP_NOTES pattern matching:', error);
                responseContent = 'Failed to process notes. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'PARTIAL_SYNC_UP_NOTES',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'INVALID_SYNC_UP_EVENT_NAME_INPUT') {
              console.log('INVALID_SYNC_UP_EVENT_NAME_INPUT detected via pattern matching');
              responseContent = "I didn't understand that. What should we call the event? Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_SYNC_UP_EVENT_NAME_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_SYNC_UP_LOCATION_INPUT') {
              console.log('INVALID_SYNC_UP_LOCATION_INPUT detected via pattern matching');
              responseContent = "I didn't understand that. What's the event location? Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_SYNC_UP_LOCATION_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_SYNC_UP_TIME_OPTIONS_INPUT') {
              console.log('INVALID_SYNC_UP_TIME_OPTIONS_INPUT detected via pattern matching');
              responseContent = "I didn't understand that. Give me 1-3 time options (date and time for each). Example: 12/19 6-8pm, 12/21 10am (end time optional). Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_SYNC_UP_TIME_OPTIONS_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'INVALID_SYNC_UP_NOTES_INPUT') {
              console.log('INVALID_SYNC_UP_NOTES_INPUT detected via pattern matching');
              responseContent = "I didn't understand that. Add a note or type 'n' to skip. Type 'exit' to cancel.";
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_SYNC_UP_NOTES_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_CONFIRMATION_INVALID') {
              console.log('SYNC_UP_CONFIRMATION_INVALID detected via pattern matching');
              
              responseContent = `I didn't understand that. Reply 'yes' to send sync up, 'no' to make changes, or 'exit' to cancel.`;
              shouldSendSMS = true;
              
              // Keep waiting for confirmation
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'sync_up_confirmation',
                  current_state: 'sync_up_confirmation',
                  last_action: 'SYNC_UP_CONFIRMATION_INVALID',
                  last_action_timestamp: new Date().toISOString()
                })
                .eq('user_id', userId);
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CONFIRMATION_INVALID',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else if (action === 'SYNC_UP_CONFIRMATION_NO') {
              console.log('SYNC_UP_CONFIRMATION_NO detected via pattern matching');
              
              responseContent = 'What would you like to change? Type \'exit\' to cancel.';
              shouldSendSMS = true;
              
              // Enter change request state instead of cancelling
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'sync_up_change',
                  waiting_for: 'sync_up_change_request',
                  last_action: 'SYNC_UP_CONFIRMATION_NO',
                  last_action_timestamp: new Date().toISOString()
                })
                .eq('user_id', userId);
              
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_CONFIRMATION_NO',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
             } else if (action === 'RE_SYNC') {
               console.log('RE_SYNC detected via pattern matching');
               
               // This action is HOST ONLY - verify is_host=true
               if (!is_host) {
                 console.log('Non-host attempted to re-sync');
                 return new Response(JSON.stringify({
                   success: false,
                   error: 'This feature is only available for hosts'
                 }), { 
                   status: 403,
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               const eventName = extractedData.eventName;
               
               // Query user's active sync ups (created by this host)
               const { data: syncUps, error: syncUpsError } = await supabase
                 .from('sync_ups')
                 .select(`
                   id,
                   name,
                   location,
                   created_at,
                   events!inner (id, title, location, creator_id, event_date),
                   crews (id, name)
                 `)
                 .eq('events.creator_id', userId)
                 .eq('status', 'sent')
                 .order('created_at', { ascending: false });
               
               if (syncUpsError || !syncUps || syncUps.length === 0) {
                 responseContent = 'No active sync ups found. Type \'Sync Up\' to create one or \'exit\' to do something else.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RE_SYNC',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // If event name provided, try to find matching sync up
               if (eventName) {
                 const matchingSyncUp = syncUps.find(syncUp => 
                   syncUp.name.toLowerCase().includes(eventName.toLowerCase()) ||
                   syncUp.events.title.toLowerCase().includes(eventName.toLowerCase())
                 );
                 
                 if (matchingSyncUp) {
                   // Skip selection, go directly to time options
                   responseContent = `Add up to 3 new time options for ${matchingSyncUp.name} at ${matchingSyncUp.location}: Date, start time, end time optional. Example: 12/26 6-8pm, 12/28 10am-12pm`;
                   shouldSendSMS = true;
                   
                  await supabase
                    .from('conversation_state')
                    .upsert({
                      user_id: userId,
                      phone_number: phone_number.replace(/\D/g, ''),
                      current_state: 're_sync_time_options',
                      waiting_for: 're_sync_time_options',
                      extracted_data: [{
                        action: 'RE_SYNC_SYNC_UP_SELECTED',
                        sync_up_id: matchingSyncUp.id,
                        sync_up_name: matchingSyncUp.name,
                        location: matchingSyncUp.location,
                        crew_id: matchingSyncUp.crews.id,
                        crew_name: matchingSyncUp.crews.name,
                        timestamp: new Date().toISOString()
                      }]
                    }, {
                      onConflict: 'user_id'
                    });
                   
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'RE_SYNC',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
               }
               
               // If one sync up, skip selection
               if (syncUps.length === 1) {
                 const syncUp = syncUps[0];
                 responseContent = `Add up to 3 new time options for ${syncUp.name} at ${syncUp.location}: Date, start time, end time optional. Example: 12/26 6-8pm, 12/28 10am-12pm`;
                 shouldSendSMS = true;
                 
                await supabase
                  .from('conversation_state')
                  .upsert({
                    user_id: userId,
                    phone_number: phone_number.replace(/\D/g, ''),
                    current_state: 're_sync_time_options',
                    waiting_for: 're_sync_time_options',
                    extracted_data: [{
                      action: 'RE_SYNC_SYNC_UP_SELECTED',
                      sync_up_id: syncUp.id,
                      sync_up_name: syncUp.name,
                      location: syncUp.location,
                      crew_id: syncUp.crews.id,
                      crew_name: syncUp.crews.name,
                      timestamp: new Date().toISOString()
                    }]
                  }, {
                    onConflict: 'user_id'
                  });
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RE_SYNC',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // Multiple sync ups - show selection list with time options
               let syncUpList = 'Send new time options for which sync up?\n';
               
               // Fetch sync up options for each sync up and format the list
               for (let index = 0; index < syncUps.length; index++) {
                 const syncUp = syncUps[index];
                 
                 // Fetch sync up options for this sync up
                 const { data: syncUpOptions } = await supabase
                   .from('sync_up_options')
                   .select('*')
                   .eq('sync_up_id', syncUp.id)
                   .neq('idx', 0) // Exclude global None option
                   .order('idx', { ascending: true });
                 
                 // Format time options - show date and time for each option
                 let timeOptionsText = '';
                 if (syncUpOptions && syncUpOptions.length > 0) {
                   const formattedOptions = syncUpOptions
                     .map(opt => {
                       const { dayMonth, timeText } = formatTimeRangeForOptionGlobal(opt.start_time, opt.end_time);
                       // Format: "Thu 12/19, 6-8pm" or just date if no time
                       return timeText ? `${dayMonth}, ${timeText}` : dayMonth;
                     })
                     .filter(opt => opt.length > 0);
                   
                   if (formattedOptions.length > 0) {
                     // Join with " or " to match expected format: "Thu 12/19, 6-8pm or Sat 12/21, 10am-12pm"
                     timeOptionsText = formattedOptions.join(' or ');
                   }
                 }
                 
                 // Build the list item
                 if (timeOptionsText) {
                   syncUpList += `${index + 1}. ${syncUp.name} - ${timeOptionsText}\n`;
                 } else {
                   // Fallback if no options found
                   syncUpList += `${index + 1}. ${syncUp.name}\n`;
                 }
               }
               
               syncUpList += 'Reply with the sync up number or \'exit\'.';
               
               responseContent = syncUpList;
               shouldSendSMS = true;
               
               await supabase
                 .from('conversation_state')
                 .upsert({
                   user_id: userId,
                   phone_number: phone_number.replace(/\D/g, ''),
                   current_state: 're_sync_selection',
                   waiting_for: 're_sync_selection',
                   extracted_data: [{
                     action: 'RE_SYNC_SYNC_UP_LIST_SHOWN',
                     sync_up_list: syncUps,
                     timestamp: new Date().toISOString()
                   }]
                 }, {
                   onConflict: 'user_id'
                 });
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'RE_SYNC',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SEND_MESSAGE') {
               console.log('SEND_MESSAGE detected via pattern matching');
               
               // Handle different steps based on waiting_for state
               if (conversationState?.waiting_for === 'send_message_context') {
                 // Step 2: Handle context selection (user already initiated, now selecting context)
              if (extractedData.context === 'sync_up') {
                // Sync up messaging - show recent sync ups by creator_id
                const { data: syncUps, error: syncUpsError } = await supabase
                  .from('sync_ups')
                  .select(`
                    id,
                    name,
                    location,
                    created_at,
                    crew_id,
                    crews(name)
                  `)
                  .eq('creator_id', userId)
                  .order('created_at', { ascending: false })
                  .limit(10);
                 
                 if (syncUpsError || !syncUps || syncUps.length === 0) {
                   responseContent = 'You don\'t have any sync ups yet. Create a sync up first to send messages.';
                   shouldSendSMS = true;
                 } else {
                   let syncUpList = 'Send message about which?\n\n';
                  syncUps.forEach((syncUp, index) => {
                    syncUpList += `${index + 1}. ${syncUp.name}\n`;
                  });
                  syncUpList += '\nReply with the number.';
                   
                   responseContent = syncUpList;
                   shouldSendSMS = true;
                   
                   // Update conversation state
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       phone_number: phone_number,
                       current_state: 'send_message_syncup_step_2',
                       waiting_for: 'sync_up_selection_send_message',
                       last_action: 'SEND_MESSAGE',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: [
                         {
                           action: 'SEND_MESSAGE',
                           substep: 2,
                           context: 'sync_up',
                          available_sync_ups: syncUps.map((s: any) => ({ 
                            id: s.id,
                            name: s.name,
                            location: s.location,
                            crew_id: s.crew_id,
                            crew_name: s.crews?.name || 'Crew'
                          }))
                         }
                       ]
                     }, { onConflict: 'user_id' });
                 }
               } else if (extractedData.context === 'event') {
                   // Show event list
                 const { data: events, error: eventsError } = await supabase
                   .from('events')
                   .select('id, title, event_date, start_time, location')
                   .eq('creator_id', userId)
                   .gte('event_date', new Date().toISOString().split('T')[0])
                   .order('event_date', { ascending: true });
                 
                 if (eventsError || !events || events.length === 0) {
                   responseContent = 'You don\'t have any upcoming events. Create an event first to send messages.';
                   shouldSendSMS = true;
                 } else {
                   let eventList = 'Send message about which?\n\n';
                   events.forEach((event, index) => {
                     eventList += `${index + 1}. ${event.title}\n`;
                   });
                   eventList += '\nReply with the number.';
                   
                   responseContent = eventList;
                   shouldSendSMS = true;
                   
                   // Update conversation state
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                         phone_number: phone_number,
                       current_state: 'send_message_step_2',
                       waiting_for: 'event_selection_send_message',
                       last_action: 'SEND_MESSAGE',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: [
                         {
                           action: 'SEND_MESSAGE',
                           substep: 2,
                           available_events: events.map(e => ({ id: e.id, title: e.title }))
                         }
                       ]
                     }, { onConflict: 'user_id' });
                 }
                 } else if (extractedData.invalid_input) {
                   responseContent = 'I didn\'t understand that. Message about: 1) Sync up 2) Event or type \'exit\' to cancel.';
                   shouldSendSMS = true;
                 }
                 
               } else if (conversationState?.waiting_for === 'event_selection_send_message') {
                 // Step 3: Handle event selection
                 if (extractedData.event_index !== undefined) {
                 const { data: events } = await supabase
                   .from('events')
                   .select('id, title, event_date, start_time, location')
                   .eq('creator_id', userId)
                   .gte('event_date', new Date().toISOString().split('T')[0])
                   .order('event_date', { ascending: true });
                 
                 if (!events || extractedData.event_index < 0 || extractedData.event_index >= events.length) {
                     // Provide contextual error message based on waiting_for state
                     if (conversationState?.waiting_for === 'event_selection_send_message') {
                       responseContent = 'I didn\'t understand that. Reply with an event number or \'exit\' to do something else.';
                     } else {
                   responseContent = 'Invalid event selection. Please try again.';
                     }
                   shouldSendSMS = true;
                 } else {
                   const selectedEvent = events[extractedData.event_index];
                   
                   // Call helper function to get targeting options
                   const result = await sendMessageForEvent(supabase, selectedEvent.id, userId, phone_number, responseContent, shouldSendSMS);
                   responseContent = result.responseContent;
                   shouldSendSMS = result.shouldSendSMS;
                 }
                 } else if (extractedData.invalid_input) {
                   responseContent = 'Invalid input. Please try again or type "exit" to cancel.';
                   shouldSendSMS = true;
                 }
                 
               } else if (conversationState?.waiting_for === 'sync_up_selection_send_message') {
                 // Step 3: Handle sync up selection
                 if (extractedData.sync_up_index !== undefined) {
                   const { data: currentState } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                   let availableSyncUps = [];
                   if (currentState?.extracted_data?.[0]?.available_sync_ups) {
                     availableSyncUps = currentState.extracted_data[0].available_sync_ups;
                   }
                   
                   if (!availableSyncUps || extractedData.sync_up_index < 0 || extractedData.sync_up_index >= availableSyncUps.length) {
                     responseContent = 'I didn\'t understand that. Reply with a sync up number or \'exit\' to do something else.';
                     shouldSendSMS = true;
                   } else {
                     const selectedSyncUp = availableSyncUps[extractedData.sync_up_index];
                     
                    // Show targeting options for sync up
                    responseContent = `Who should we message for "${selectedSyncUp.name}"?\n\n1. Everyone\n2. Non-responders\n\nReply with the number.`;
                     shouldSendSMS = true;
                     
                     // Update conversation state
                     await supabase
                       .from('conversation_state')
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number,
                         current_state: 'send_message_syncup_step_3',
                         waiting_for: 'targeting_selection_sync_up',
                         last_action: 'SEND_MESSAGE',
                         last_action_timestamp: new Date().toISOString(),
                         extracted_data: [
                           {
                             action: 'SEND_MESSAGE',
                             substep: 3,
                             context: 'sync_up',
                             selected_sync_up: selectedSyncUp
                           }
                         ]
                       }, { onConflict: 'user_id' });
                   }
                 } else if (extractedData.invalid_input) {
                   responseContent = 'I didn\'t understand that. Reply with a number to select who to message or \'exit\' to cancel.';
                   shouldSendSMS = true;
                 }
                 
               } else if (conversationState?.waiting_for === 'targeting_selection') {
                 // Step 4: Handle targeting selection
                 if (extractedData.targeting_index !== undefined) {
                 const targetingMap = {
                   1: 'everyone',
                   2: 'non_responders', 
                   3: 'coming',
                   4: 'maybe',
                   5: 'out'
                 };
                 
                 const targetingGroup = targetingMap[extractedData.targeting_index];
                 if (!targetingGroup) {
                   responseContent = 'I didn\'t understand that. Reply with a number to select who to message or \'exit\' to cancel.';
                   shouldSendSMS = true;
                 } else {
                   // Get current conversation state to access valid invitations
                   const { data: currentState } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                   let validInvitations = [];
                   if (currentState?.extracted_data?.[0]?.available_invitations) {
                     validInvitations = currentState.extracted_data[0].available_invitations;
                   }
                   
                   // Filter invitations based on targeting selection
                   let filteredInvitations = [];
                   if (targetingGroup === 'everyone') {
                     filteredInvitations = validInvitations;
                   } else if (targetingGroup === 'non_responders') {
                     filteredInvitations = validInvitations.filter(inv => 
                       inv.status === 'sent' || (inv.status === 'failed' && inv.response_note === 'no_response')
                     );
                   } else if (targetingGroup === 'coming') {
                     filteredInvitations = validInvitations.filter(inv => 
                       inv.response_note === 'in' || inv.response_note === 'yes' || inv.response_note === '1'
                     );
                   } else if (targetingGroup === 'maybe') {
                     filteredInvitations = validInvitations.filter(inv => 
                       inv.response_note === 'maybe' || inv.response_note === '3'
                     );
                   } else if (targetingGroup === 'out') {
                     filteredInvitations = validInvitations.filter(inv => 
                       inv.response_note === 'out' || inv.response_note === 'no' || inv.response_note === '2'
                     );
                   }
                   
                  if (filteredInvitations.length === 0) {
                    // Friendly, group-specific empty-state messages
                    const emptyGroupMessageMap: Record<string, string> = {
                      everyone: "No one is invited yet! Type 'exit' or select a different group.",
                      non_responders: "Everyone has already responded! Type 'exit' or select a different group.",
                      coming: "No one has RSVPed yes yet! Type 'exit' or select a different group.",
                      maybe: "No one has RSVPed maybe! Type 'exit' or select a different group.",
                      out: "No one has declined yet! Type 'exit' or select a different group."
                    };
                    responseContent = emptyGroupMessageMap[targetingGroup] || "No one found. Type 'exit' or select a different group.";
                    shouldSendSMS = true;
                  } else {
                    responseContent = `What message should we send? (160 characters max)`;
                    shouldSendSMS = true;
                     
                     // Update conversation state
                     await supabase
                       .from('conversation_state')
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number,
                         current_state: 'send_message_step_4',
                         waiting_for: 'message_text',
                         last_action: 'SEND_MESSAGE',
                         last_action_timestamp: new Date().toISOString(),
                         extracted_data: [
                           {
                             action: 'SEND_MESSAGE',
                             substep: 4,
                             targeting_group: targetingGroup,
                             filtered_invitations: filteredInvitations
                           }
                         ]
                       }, { onConflict: 'user_id' });
                   }
                 }
                 } else if (extractedData.invalid_input) {
                   responseContent = 'Invalid input. Please try again or type "exit" to cancel.';
                   shouldSendSMS = true;
                 }
                 
               } else if (conversationState?.waiting_for === 'targeting_selection_sync_up') {
                 // Step 4: Handle sync up targeting selection
                 if (extractedData.targeting_index !== undefined) {
                   const targetingMap = {
                     1: 'everyone',
                     2: 'non_responders'
                   };
                   
                   const targetingGroup = targetingMap[extractedData.targeting_index];
                   if (!targetingGroup) {
                     responseContent = 'I didn\'t understand that. Reply with a number to select who to message or \'exit\' to cancel.';
                     shouldSendSMS = true;
                   } else {
                     // Get current conversation state to access selected sync up
                     const { data: currentState } = await supabase
                       .from('conversation_state')
                       .select('extracted_data')
                       .eq('user_id', userId)
                       .single();
                     
                     let selectedSyncUp = null;
                     if (currentState?.extracted_data?.[0]?.selected_sync_up) {
                       selectedSyncUp = currentState.extracted_data[0].selected_sync_up;
                     }
                     
                     if (!selectedSyncUp) {
                       responseContent = 'Sync up not found. Please try again.';
                       shouldSendSMS = true;
                     } else {
                       // Build recipient list for sync up
                       const recipientList = await buildSyncUpRecipientList(supabase, selectedSyncUp.id, targetingGroup);
                       
                if (recipientList.length === 0) {
                  if (targetingGroup === 'everyone') {
                    responseContent = `No contacts found for everyone. Please try a different targeting option.`;
                    shouldSendSMS = true;
                  } else if (targetingGroup === 'non_responders') {
                    responseContent = `Everyone has already responded! Type 'exit' or select a different group.`;
                    shouldSendSMS = true;
                  }
                } else {
                  responseContent = `What message should we send? (160 characters max)`;
                  shouldSendSMS = true;
                         
                         // Update conversation state
                         await supabase
                           .from('conversation_state')
                           .upsert({
                             user_id: userId,
                             phone_number: phone_number,
                             current_state: 'send_message_syncup_step_4',
                             waiting_for: 'message_text_sync_up',
                             last_action: 'SEND_MESSAGE',
                             last_action_timestamp: new Date().toISOString(),
                             extracted_data: [
                               {
                                 action: 'SEND_MESSAGE',
                                 substep: 4,
                                 context: 'sync_up',
                                 targeting_group: targetingGroup,
                                 selected_sync_up: selectedSyncUp,
                                 recipient_list: recipientList
                               }
                             ]
                           }, { onConflict: 'user_id' });
                       }
                     }
                   }
                 } else if (extractedData.invalid_input) {
                   responseContent = 'I didn\'t understand that. Reply with a number to select who to message or \'exit\' to cancel.';
                   shouldSendSMS = true;
                 }
                 
               } else if (conversationState?.waiting_for === 'message_text' || conversationState?.waiting_for === 'message_collection') {
                 // Step 5: Handle message input
                 if (extractedData.message_text) {
                 const messageText = extractedData.message_text.trim();
                 
                 if (messageText.length === 0) {
                   responseContent = 'Please enter a message.';
                   shouldSendSMS = true;
                 } else if (messageText.length > 160) {
                  responseContent = "Message too long. Please keep it under 160 characters or type 'exit' to cancel.";
                   shouldSendSMS = true;
                 } else {
                   // Get current conversation state to access filtered invitations
                   const { data: currentState } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                  let filteredInvitations = [];
                  if (currentState?.extracted_data?.[0]?.filtered_invitations) {
                    filteredInvitations = currentState.extracted_data[0].filtered_invitations;
                  }
                  // Derive a human-friendly targeting group label for events
                  let eventTargetingGroupLabel = 'your selected group';
                  const eventTargetingGroup = currentState?.extracted_data?.[0]?.targeting_group;
                  if (eventTargetingGroup) {
                    const labelMap: Record<string, string> = {
                      everyone: 'Everyone',
                      non_responders: 'Non-responders',
                      coming: 'Coming (In!)',
                      maybe: 'Maybe',
                      out: "Can't come (Out)"
                    };
                    eventTargetingGroupLabel = labelMap[eventTargetingGroup] || eventTargetingGroupLabel;
                  }
                  
                  responseContent = `'${messageText}' to ${eventTargetingGroupLabel} (${filteredInvitations.length} people)? Reply 'yes' to confirm.`;
                   shouldSendSMS = true;
                   
                   // Update conversation state
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                         phone_number: phone_number,
                       current_state: 'send_message_step_5',
                       waiting_for: 'message_confirmation',
                       last_action: 'SEND_MESSAGE',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: [
                         {
                           action: 'SEND_MESSAGE',
                           substep: 5,
                           message_text: messageText,
                           filtered_invitations: filteredInvitations
                         }
                       ]
                     }, { onConflict: 'user_id' });
                 }
                 }
                 
               } else if (conversationState?.waiting_for === 'message_text_sync_up') {
                 // Step 5: Handle sync up message input
                 if (extractedData.message_text) {
                   const messageText = extractedData.message_text.trim();
                   
                   if (messageText.length === 0) {
                     responseContent = 'Please enter a message.';
                     shouldSendSMS = true;
                   } else if (messageText.length > 160) {
                    responseContent = "Message too long. Please keep it under 160 characters or type 'exit' to cancel.";
                     shouldSendSMS = true;
                   } else {
                     // Get current conversation state to access recipient list
                     const { data: currentState } = await supabase
                       .from('conversation_state')
                       .select('extracted_data')
                       .eq('user_id', userId)
                       .single();
                     
                    let recipientList = [];
                    let targetingGroup = '';
                     let selectedSyncUp = null;
                     if (currentState?.extracted_data?.[0]) {
                       recipientList = currentState.extracted_data[0].recipient_list || [];
                       targetingGroup = currentState.extracted_data[0].targeting_group || '';
                       selectedSyncUp = currentState.extracted_data[0].selected_sync_up || null;
                     }
                    // Derive a human-friendly targeting group label for sync ups
                    const syncUpLabelMap: Record<string, string> = {
                      everyone: 'Everyone',
                      non_responders: 'Non-responders'
                    };
                    const targetingGroupLabel = syncUpLabelMap[targetingGroup] || 'your selected group';
                    
                    responseContent = `'${messageText}' to ${targetingGroupLabel} (${recipientList.length} people)? Reply 'yes' to confirm.`;
                     shouldSendSMS = true;
                     
                     // Update conversation state
                     await supabase
                       .from('conversation_state')
                       .upsert({
                         user_id: userId,
                         phone_number: phone_number,
                         current_state: 'send_message_syncup_step_5',
                         waiting_for: 'message_confirmation_sync_up',
                         last_action: 'SEND_MESSAGE',
                         last_action_timestamp: new Date().toISOString(),
                         extracted_data: [
                           {
                             action: 'SEND_MESSAGE',
                             substep: 5,
                             context: 'sync_up',
                             message_text: messageText,
                             targeting_group: targetingGroup,
                             selected_sync_up: selectedSyncUp,
                             recipient_list: recipientList
                           }
                         ]
                       }, { onConflict: 'user_id' });
                   }
                 }
                 
              } else if (conversationState?.waiting_for === 'message_confirmation' && extractedData.message_text) {
                 // Step 5: Handle message input
                 const messageText = extractedData.message_text.trim();
                 
                 if (messageText.length === 0) {
                   responseContent = 'Please enter a message.';
                   shouldSendSMS = true;
                 } else if (messageText.length > 160) {
                  responseContent = "Message too long. Please keep it under 160 characters or type 'exit' to cancel.";
                   shouldSendSMS = true;
                 } else {
                   // Get current conversation state to access filtered invitations
                   const { data: currentState } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                  let filteredInvitations = [];
                  if (currentState?.extracted_data?.[0]?.filtered_invitations) {
                    filteredInvitations = currentState.extracted_data[0].filtered_invitations;
                  }
                  // Derive a human-friendly targeting group label for events
                  let eventTargetingGroupLabel2 = 'your selected group';
                  const eventTargetingGroup2 = currentState?.extracted_data?.[0]?.targeting_group;
                  if (eventTargetingGroup2) {
                    const labelMap2: Record<string, string> = {
                      everyone: 'Everyone',
                      non_responders: 'Non-responders',
                      coming: 'Coming (In!)',
                      maybe: 'Maybe',
                      out: "Can't come (Out)"
                    };
                    eventTargetingGroupLabel2 = labelMap2[eventTargetingGroup2] || eventTargetingGroupLabel2;
                  }
                  
                  responseContent = `'${messageText}' to ${eventTargetingGroupLabel2} (${filteredInvitations.length} people)? Reply 'yes' to confirm.`;
                   shouldSendSMS = true;
                   
                   // Update conversation state
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       current_state: 'send_message_step_5',
                       waiting_for: 'message_confirmation',
                       last_action: 'SEND_MESSAGE',
                       last_action_timestamp: new Date().toISOString(),
                       extracted_data: [
                         {
                           action: 'SEND_MESSAGE',
                           substep: 5,
                           message_text: messageText,
                           filtered_invitations: filteredInvitations,
                           targeting_group: eventTargetingGroup2 || 'your selected group'
                         }
                       ]
                     }, { onConflict: 'user_id' });
                 }
              } else if (conversationState?.waiting_for === 'message_confirmation') {
                // Step 6: Handle event message confirmation
                if (extractedData.confirm === true) {
                  const { data: currentState } = await supabase
                    .from('conversation_state')
                    .select('extracted_data')
                    .eq('user_id', userId)
                    .single();

                  const messageText = currentState?.extracted_data?.[0]?.message_text || '';
                  const filteredInvitations = currentState?.extracted_data?.[0]?.filtered_invitations || [];
                  const targetingGroupKey = currentState?.extracted_data?.[0]?.targeting_group || 'your selected group';

                  if (messageText && filteredInvitations.length > 0) {
                    let successCount = 0;
                    let failureCount = 0;

                    for (const inv of filteredInvitations) {
                      const phone = inv?.contacts?.phone_number;
                      if (!phone) continue;
                      try {
                        await sendSMS(phone, messageText, send_sms, phone_number);
                        successCount++;
                      } catch (error) {
                        console.error('Failed to send SMS to', phone, error);
                        failureCount++;
                      }
                    }

                    const labelMap: Record<string, string> = {
                      everyone: 'Everyone',
                      non_responders: 'Non-responders',
                      coming: 'Coming (In!)',
                      maybe: 'Maybe',
                      out: "Can't come (Out)",
                      'your selected group': 'your selected group'
                    };
                    const targetLabel = labelMap[targetingGroupKey] || 'your selected group';
                    responseContent = `Message sent to ${successCount} ${targetLabel}!`;
                    if (failureCount > 0) {
                      responseContent += ` (${failureCount} failed)`;
                    }
                    shouldSendSMS = true;

                    await supabase
                      .from('conversation_state')
                      .delete()
                      .eq('user_id', userId);
                  } else {
                    responseContent = 'Message or recipients not found. Please try again.';
                    shouldSendSMS = true;
                  }
                } else if (extractedData.confirm === false) {
                  responseContent = 'What would you like to do next?';
                  shouldSendSMS = true;
                  await supabase
                    .from('conversation_state')
                    .update({
                      current_state: 'normal',
                      waiting_for: null,
                      extracted_data: []
                    })
                    .eq('user_id', userId);
                } else if (extractedData.invalid_input) {
                  responseContent = "I didn't understand that. Reply 'yes' to send message or 'exit' to cancel.";
                  shouldSendSMS = true;
                }
              } else if (conversationState?.waiting_for === 'message_confirmation_sync_up') {
                 // Step 6: Handle sync up message confirmation
                 if (extractedData.confirm === true) {
                   // Get current conversation state to access message and recipients
                   const { data: currentState } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();
                   
                   let messageText = '';
                   let recipientList = [];
                   let targetingGroup = '';
                   let selectedSyncUp = null;
                   
                   if (currentState?.extracted_data?.[0]) {
                     messageText = currentState.extracted_data[0].message_text || '';
                     recipientList = currentState.extracted_data[0].recipient_list || [];
                     targetingGroup = currentState.extracted_data[0].targeting_group || '';
                     selectedSyncUp = currentState.extracted_data[0].selected_sync_up || null;
                   }
                   
                   if (messageText && recipientList.length > 0) {
                     // Send messages to all recipients
                     let successCount = 0;
                     let failureCount = 0;
                     
                     for (const recipient of recipientList) {
                       try {
                         await sendSMS(recipient.phone_number, messageText, send_sms, phone_number);
                         successCount++;
                       } catch (error) {
                         console.error(`Failed to send SMS to ${recipient.phone_number}:`, error);
                         failureCount++;
                       }
                     }
                     
                    if (successCount > 0) {
                      const syncUpSuccessLabelMap: Record<string, string> = {
                        everyone: 'Everyone',
                        non_responders: 'Non-responders'
                      };
                      const successTargetLabel = syncUpSuccessLabelMap[targetingGroup] || 'your selected group';
                      responseContent = `Message sent to ${successCount} ${successTargetLabel}!`;
                       if (failureCount > 0) {
                         responseContent += ` (${failureCount} failed)`;
                       }
                     } else {
                       responseContent = 'Failed to send message. Please try again.';
                     }
                     shouldSendSMS = true;
                     
                     // Clear conversation state
                     await supabase
                       .from('conversation_state')
                       .delete()
                       .eq('user_id', userId);
                   } else {
                     responseContent = 'Message or recipients not found. Please try again.';
                     shouldSendSMS = true;
                   }
                 } else if (extractedData.confirm === false) {
                   responseContent = 'What would you like to do next?';
                   shouldSendSMS = true;
                   
                   // Clear conversation state and return to idle
                   await supabase
                     .from('conversation_state')
                     .update({
                       current_state: 'normal',
                       waiting_for: null,
                       extracted_data: []
                     })
                     .eq('user_id', userId);
                 } else if (extractedData.invalid_input) {
                  responseContent = "I didn't understand that. Reply 'yes' to send message or 'exit' to cancel.";
                   shouldSendSMS = true;
                 }
               } else {
                 // Step 1: Initial SEND_MESSAGE command (no waiting_for state yet)
                 responseContent = 'Message about:\n1. Sync up\n2. Event\n\nReply with the number.';
                 shouldSendSMS = true;
                 
                 // Update conversation state with available events
                 const { error: upsertError } = await supabase
                   .from('conversation_state')
                   .upsert({
                     user_id: userId,
                     phone_number: phone_number,
                     current_state: 'send_message_step_1',
                     waiting_for: 'send_message_context',
                     last_action: 'SEND_MESSAGE',
                     last_action_timestamp: new Date().toISOString(),
                     extracted_data: [
                       {
                         action: 'SEND_MESSAGE',
                         substep: 1,
                         available_events: []
                       }
                     ]
                   }, { onConflict: 'user_id' });

                 if (upsertError) {
                   console.error('❌ Failed to update conversation state:', upsertError);
                         } else {
                   console.log('✅ Conversation state updated successfully');
                 }

                 // Verify the state was saved
                 const { data: verifyState } = await supabase
                   .from('conversation_state')
                   .select('waiting_for, current_state')
                   .eq('user_id', userId)
                   .single();
                 console.log('🔍 Verified conversation state:', verifyState);
               }
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SEND_MESSAGE',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SEND_UNINVITED_INVITES') {
               console.log('SEND_UNINVITED_INVITES detected via pattern matching, bypassing AI');
               
               try {
                 // Get conversation state to find the event
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 // Find the event from the conversation state
                 let eventId = null;
                 let eventTitle = '';
                 let eventDate = '';
                 let eventTime = '';
                 let crewName = '';
                 
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                      eventId = item.event_id;
                      eventTitle = item.event_title || '';
                      crewName = item.crew_name || '';
                      break;
                    }
                  }
                }

                // Only fall back to most recent event if no event found in conversation state
                if (!eventId) {
                  const { data: recentEvent } = await supabase
                    .from('events')
                    .select(`
                      id,
                      title,
                      event_date,
                      start_time,
                      crews (name)
                    `)
                    .eq('creator_id', userId)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();
                    
                  if (recentEvent) {
                    eventId = recentEvent.id;
                    eventTitle = recentEvent.title;
                    crewName = recentEvent.crews?.name || '';
                  }
                }
                 
                if (!eventId) {
                  responseContent = 'No event found. Please try again.';
                  shouldSendSMS = true;
                } else {
                   
                  // Get uninvited crew members
                  const { data: eventData } = await supabase
                    .from('events')
                    .select('crew_id, event_date, start_time, title, shorten_event_url')
                    .eq('id', eventId)
                    .single();
                   
                  if (eventData) {
                    // Use the fetched data
                    if (!eventTitle) eventTitle = eventData.title;
                    eventDate = eventData.event_date;
                    eventTime = eventData.start_time;
                  }
                  
                  if (eventData?.crew_id) {
                     // Get all crew members
                     const { data: crewMembers } = await supabase
                       .from('crew_members')
                       .select(`
                         contacts (
                           id,
                           first_name,
                           last_name,
                           phone_number
                         )
                       `)
                       .eq('crew_id', eventData.crew_id);
                     
                     // Get already invited members
                     const { data: invitedMembers } = await supabase
                       .from('invitations')
                       .select('contact_id')
                       .eq('event_id', eventId);
                     
                     const invitedContactIds = new Set(invitedMembers?.map(inv => inv.contact_id) || []);
                     
                     // Filter uninvited members
                     const uninvitedMembers = crewMembers
                       .filter(member => member.contacts && !invitedContactIds.has(member.contacts.id))
                       .map(member => member.contacts);
                     
                     if (uninvitedMembers.length === 0) {
                       responseContent = 'No uninvited members found.';
                       shouldSendSMS = true;
                     } else {
                       // Create invitations for uninvited members
                       const invitations = uninvitedMembers.map(member => ({
                         event_id: eventId,
                         contact_id: member.id,
                         invited_by: userId,
                         status: 'pending',
                         sms_sent_at: new Date().toISOString()
                       }));
                       
                       const { error: insertError } = await supabase
                         .from('invitations')
                         .insert(invitations);
                       
                       if (insertError) {
                         console.error('Error creating invitations:', insertError);
                         responseContent = 'Failed to send invitations. Please try again.';
                         shouldSendSMS = true;
                       } else {
                         // Format date as "Oct 20" instead of full date
                        const eventDateFormatted = eventDate ? new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

                        // Format time as "5pm" instead of "5:00 PM"
                        const eventTimeFormatted = eventTime ? new Date(`2000-01-01T${eventTime}`).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: eventTime.includes(':') && !eventTime.endsWith(':00') ? '2-digit' : undefined,
                          hour12: true 
                        }).toLowerCase().replace(' ', '') : '';

                        // Fetch event with shorten_event_url (with retry logic)
                        const { shorten_event_url } = await fetchEventWithShortUrl(supabase, eventId);
                        const eventLink = formatEventLink(eventId, shorten_event_url);

                        responseContent = `${uninvitedMembers.length} invites sent for ${eventTitle}${eventDateFormatted ? ` on ${eventDateFormatted}` : ''}${eventTimeFormatted ? ` at ${eventTimeFormatted}` : ''}. Check RSVPs: ${eventLink}`;
                   shouldSendSMS = true;
                   
                   // Clear conversation state
                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: null,
                             current_state: 'normal',
                       extracted_data: [],
                       last_action: null,
                             last_action_timestamp: null
                     })
                     .eq('user_id', userId);
                       }
                     }
                 } else {
                     responseContent = 'No crew found for this event.';
                   shouldSendSMS = true;
                   }
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_UNINVITED_INVITES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in SEND_UNINVITED_INVITES pattern matching:', error);
                 responseContent = 'Failed to send invitations. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_UNINVITED_INVITES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'ADD_MEMBERS_TO_EVENT') {
               console.log('ADD_MEMBERS_TO_EVENT detected via pattern matching, bypassing AI');
               
               try {
                 // Get conversation state to find the correct event context
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 let eventId = null;
                 let crewId = null;
                 let crewName = '';
                 let eventTitle = '';
                 
                 // Look for event context in conversation state
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     if (item.action === 'INVITE_MORE_PEOPLE' || item.action === 'INVITE_MORE_PEOPLE_STEP_2') {
                       eventId = item.event_id;
                       crewId = item.crew_id;
                       crewName = item.crew_name;
                       eventTitle = item.event_title;
                       break;
                     }
                   }
                 }
                 
                 // If we have eventId from conversation state, look up the crew info for that specific event
                 if (eventId && !crewId) {
                   const { data: eventData } = await supabase
                     .from('events')
                     .select(`
                       id,
                       title,
                       crew_id,
                       crews (name)
                     `)
                     .eq('id', eventId)
                     .single();

                   if (eventData) {
                     crewId = eventData.crew_id;
                     crewName = eventData.crews?.name || 'this crew';
                     eventTitle = eventData.title;
                   }
                 }

                 // If still no event context found, fall back to most recent event
                 if (!eventId) {
                   const { data: recentEvent } = await supabase
                     .from('events')
                     .select(`
                       id,
                       title,
                       crew_id,
                       crews (name)
                     `)
                     .eq('creator_id', userId)
                     .eq('status', 'active')
                     .order('created_at', { ascending: false })
                     .limit(1)
                     .single();

                   if (!recentEvent) {
                     responseContent = 'No event found. Please try again.';
                     shouldSendSMS = true;
                   } else {
                     eventId = recentEvent.id;
                     crewId = recentEvent.crew_id;
                     crewName = recentEvent.crews?.name || 'this crew';
                     eventTitle = recentEvent.title;
                   }
                 }
                 
                 if (eventId) {
                   responseContent = `Add members to ${crewName} by texting member info (eg. Tom 4155551234). When ready, type 'Send Invites'.`;
                   shouldSendSMS = true;

                   // Update conversation state - preserve existing extracted_data
                   const { data: currentStateData } = await supabase
                     .from('conversation_state')
                     .select('extracted_data')
                     .eq('user_id', userId)
                     .single();

                   const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];

                   await supabase
                     .from('conversation_state')
                     .update({
                       waiting_for: 'member_input_for_event',
                       current_state: 'invite_more_people_add_members',
                       extracted_data: [
                         ...existingData,
                         {
                           action: 'ADD_MEMBERS_TO_EVENT',
                           event_id: eventId,
                           crew_id: crewId,
                           crew_name: crewName,
                           event_title: eventTitle,
                           timestamp: new Date().toISOString()
                         }
                       ]
                     })
                     .eq('user_id', userId);
                 }
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'ADD_MEMBERS_TO_EVENT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in ADD_MEMBERS_TO_EVENT pattern matching:', error);
                 responseContent = 'Failed to process add members. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'ADD_MEMBERS_TO_EVENT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
            } else if (action === 'INVALID_UNINVITED_MEMBERS_INPUT') {
              console.log('INVALID_UNINVITED_MEMBERS_INPUT detected via pattern matching');
              responseContent = `I didn't understand that. Type 'Send Invites' to invite, 'Add Members' to add more people, or 'exit'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_UNINVITED_MEMBERS_INPUT',
                response: responseContent,
                optimization: 'pattern_matching'
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
            }else if (action === 'INVALID_MEMBER_INPUT_FOR_EVENT') {
              console.log('INVALID_MEMBER_INPUT_FOR_EVENT detected via pattern matching');

              try {
                const { data: conversationStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();

                let crewNameForError = 'your crew';
                if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                  for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = conversationStateData.extracted_data[i];
                    if ((item.action === 'ADD_MEMBERS_TO_EVENT' || item.action === 'INVITE_MORE_PEOPLE_STEP_2') && item.crew_name) {
                      crewNameForError = item.crew_name;
                      break;
                    }
                  }
                }

                responseContent = `I didn't understand that. Add members to ${crewNameForError} by texting member info (eg. Tom 4155551234) or 'exit' to do something else. Type 'Send Invites' when ready.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);

                return new Response(JSON.stringify({
                  success: true,
                  action: 'INVALID_MEMBER_INPUT_FOR_EVENT',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
              } catch (error) {
                console.error('Error in INVALID_MEMBER_INPUT_FOR_EVENT:', error);
                responseContent = `I didn't understand that. Add members by texting member info (eg. Tom 4155551234) or 'exit'.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({ success: true, action: 'INVALID_MEMBER_INPUT_FOR_EVENT', response: responseContent, optimization: 'pattern_matching' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
              }
            } else if (action === 'SEND_INVITES_AFTER_ADDING') {
               console.log('SEND_INVITES_AFTER_ADDING detected via pattern matching, bypassing AI');
               
               try {
                 // Get conversation state to find event and crew info
                 const { data: conversationStateData } = await supabase
                   .from('conversation_state')
                   .select('extracted_data')
                   .eq('user_id', userId)
                   .single();
                 
                 console.log('Conversation state data:', conversationStateData);
                 
                 let eventId = null;
                 let crewId = null;
                 let crewName = '';
                 
                 if (conversationStateData?.extracted_data && Array.isArray(conversationStateData.extracted_data)) {
                   for (let i = conversationStateData.extracted_data.length - 1; i >= 0; i--) {
                     const item = conversationStateData.extracted_data[i];
                     console.log('Checking item:', item);
                     if (item.action === 'ADD_MEMBERS_TO_EVENT' || item.action === 'INVITE_MORE_PEOPLE_STEP_2') {
                       eventId = item.event_id;
                       crewId = item.crew_id;
                       crewName = item.crew_name;
                       console.log('Found event/crew info:', { eventId, crewId, crewName });
                       break;
                     }
                   }
                 }

                 // If we have eventId but no crewId, look up the crew info from the event
                 if (eventId && !crewId) {
                   const { data: eventData } = await supabase
                     .from('events')
                     .select(`
                       crew_id,
                       crews (name)
                     `)
                     .eq('id', eventId)
                     .single();

                   if (eventData) {
                     crewId = eventData.crew_id;
                     crewName = eventData.crews?.name || crewName || 'this crew';
                     console.log('Looked up crew info from event:', { crewId, crewName });
                   }
                 }
                 
                 console.log('Final event/crew info:', { eventId, crewId, crewName });
                 
                 if (!eventId || !crewId) {
                   responseContent = 'No event or crew found. Please try again.';
                   shouldSendSMS = true;
                   console.log('Missing event or crew info');
               } else {
                   // Get event details
                   const { data: eventData } = await supabase
                   .from('events')
                     .select('title, event_date, start_time, shorten_event_url')
                     .eq('id', eventId)
                     .single();
                   
                   if (!eventData) {
                    responseContent = "I didn't understand that. Reply with an event number or 'exit' to do something else.";
                   shouldSendSMS = true;
                   } else {
                     // Get all crew members
                     const { data: crewMembers } = await supabase
                       .from('crew_members')
                       .select(`
                         contacts (
                           id,
                           first_name,
                           last_name,
                           phone_number
                         )
                       `)
                       .eq('crew_id', crewId);
                     
                     // Get already invited members
                     const { data: invitedMembers } = await supabase
                       .from('invitations')
                       .select('contact_id')
                       .eq('event_id', eventId);
                     
                     const invitedContactIds = new Set(invitedMembers?.map(inv => inv.contact_id) || []);
                     
                     // Filter out already invited members
                     const uninvitedMembers = crewMembers
                       .filter(member => member.contacts && !invitedContactIds.has(member.contacts.id))
                       .map(member => member.contacts);
                     
                     if (uninvitedMembers.length === 0) {
                       responseContent = 'No new members to invite.';
                   shouldSendSMS = true;
                 } else {
                       // Create invitations for uninvited members
                       const invitations = uninvitedMembers.map(member => ({
                         event_id: eventId,
                         contact_id: member.id,
                         invited_by: userId,
                         status: 'pending',
                         sms_sent_at: new Date().toISOString()
                       }));
                       
                       const { error: insertError } = await supabase
                         .from('invitations')
                         .insert(invitations);
                       
                       if (insertError) {
                         console.error('Error creating invitations:', insertError);
                         responseContent = 'Failed to send invitations. Please try again.';
                         shouldSendSMS = true;
                       } else {
                         const eventDate = new Date(eventData.event_date).toLocaleDateString();
                         const eventTime = eventData.start_time ? new Date(`2000-01-01T${eventData.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                         
                         // Fetch event with shorten_event_url (with retry logic)
                         const { shorten_event_url } = await fetchEventWithShortUrl(supabase, eventId);
                         const eventLink = formatEventLink(eventId, shorten_event_url);
                         
                         responseContent = `${uninvitedMembers.length} invites sent for ${eventData.title} on ${eventDate}${eventTime ? ` at ${eventTime}` : ''}. Check RSVPs: ${eventLink}`;
                   shouldSendSMS = true;
                   
                         // Clear conversation state
                   await supabase
                     .from('conversation_state')
                           .update({
                             waiting_for: null,
                             current_state: 'normal',
                             extracted_data: [],
                             last_action: null,
                             last_action_timestamp: null
                           })
                           .eq('user_id', userId);
                       }
                     }
                 }
               }
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                   action: 'SEND_INVITES_AFTER_ADDING',
                 response: responseContent,
                 optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in SEND_INVITES_AFTER_ADDING pattern matching:', error);
                 responseContent = 'Failed to send invitations. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SEND_INVITES_AFTER_ADDING',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'HELP') {
               console.log('HELP detected via pattern matching');
               
               const helpMessage = `Available commands:

**Crew Management:**
• Create Crew – Make a new group
• Add Members – Add people to a crew
• Manage Crew – See who's in a crew, rename crew, remove crew, delete members, or get links and QR codes to add members
• Crew Link – Get a link to share so people can join your crew by adding their contact info
• Crew QR – Get a scannable image so people can join your crew by adding their contact info
• Edit Contact – Update a saved name or phone number, or delete them from your contacts

**Event Management:**
• Create Event – Create a new event and send invitations
• Send Invitations – Send event invitations
• Invite More – Add more people to an existing event
• Manage Event – View event details, edit event details, duplicate event, invite more people, delete event
• RSVPs – See who's coming to an event

**Sync-Up Features:**
• Sync Up – Find a time to meet by sending time options and collecting responses
• Re Sync – Send new time options for a Sync Up
• Sync Check – See Sync Up responses and send invites

**General Actions:**
• Send Message – Send updates or reminders to event guests or crew members
• Menu – Show all available commands
• Exit – Leave current action

Reply with a command or contact support@funlet.ai with any questions.`;
               
               responseContent = helpMessage;
               shouldSendSMS = true;
               
               // No conversation state needed - user automatically exits after help is shown
               // Clear any existing conversation state to ensure clean slate
               await supabase
                 .from('conversation_state')
                 .update({
                   current_state: 'normal',
                   waiting_for: null,
                   extracted_data: [],
                   last_action: 'HELP',
                   last_action_timestamp: new Date().toISOString()
                 })
                 .eq('user_id', userId);
               
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'HELP',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), {
                 headers: { ...corsHeaders, 'Content-Type': 'application/json' }
               });
             } else if (action === 'CHECK_SYNC_STATUS') {
               console.log('CHECK_SYNC_STATUS detected via pattern matching');
               
               // This action is HOST ONLY - verify is_host=true
               if (!is_host) {
                 console.log('Non-host attempted to check sync status');
                 return new Response(JSON.stringify({
                   success: false,
                   error: 'This feature is only available for hosts'
                 }), { 
                   status: 403,
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
               
               const eventName = extractedData.event_name;
               
               // Query user's active sync ups (created by this host)
               const { data: syncUps, error: syncUpsError } = await supabase
                 .from('sync_ups')
                 .select(`
                   id,
                   event_id,
                   crew_id,
                   created_at,
                   events!inner (id, title, location, creator_id),
                   crews (id, name),
                   sync_up_options (id, idx, start_time, end_time, option_text)
                 `)
                 .eq('events.creator_id', userId)
                 .order('created_at', { ascending: false });
               
               if (syncUpsError || !syncUps || syncUps.length === 0) {
                 responseContent = 'No active sync ups found. Type \'Sync Up\' to create one or \'exit\' to do something else.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CHECK_SYNC_STATUS',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // If event name provided, try to find matching sync up
               let selectedSyncUp = null;
               if (eventName) {
                 selectedSyncUp = syncUps.find(su => 
                   su.events.title.toLowerCase().includes(eventName.toLowerCase())
                 );
                 
                 if (!selectedSyncUp) {
                   // Event name not recognized, show selection
                   responseContent = `Event "${eventName}" not found. Check status for which sync up?\n\n`;
                   syncUps.forEach((su, idx) => {
                     const timeOptions = formatTimeOptions(su.sync_up_options);
                     responseContent += `${idx + 1}. ${su.events.title}${timeOptions}\n`;
                   });
                   responseContent += `\nReply with the sync up number or 'exit'.`;
                   
                   // Update conversation state to wait for selection
                   await supabase
                     .from('conversation_state')
                     .upsert({
                       user_id: userId,
                       phone_number: phone_number.replace(/\D/g, ''),
                       waiting_for: 'sync_status_selection',
                       extracted_data: syncUps.map(su => ({ sync_up_id: su.id }))
                     }, {
                       onConflict: 'user_id'
                     });
                   
                   shouldSendSMS = true;
                   await sendSMS(phone_number, responseContent, send_sms, phone_number);
                   return new Response(JSON.stringify({
                     success: true,
                     action: 'CHECK_SYNC_STATUS_SELECT',
                     response: responseContent,
                     optimization: 'pattern_matching'
                   }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
               } else if (syncUps.length === 1) {
                 // Only one sync up, use it
                 selectedSyncUp = syncUps[0];
               } else {
                 // Multiple sync ups, show selection
                 responseContent = `Check status for which sync up?\n\n`;
                 syncUps.forEach((su, idx) => {
                   const timeOptions = formatTimeOptions(su.sync_up_options);
                   responseContent += `${idx + 1}. ${su.events.title}${timeOptions}\n`;
                 });
                 responseContent += `\nReply with the sync up number or 'exit'.`;
                 
                 // Update conversation state
                 await supabase
                   .from('conversation_state')
                   .upsert({
                     user_id: userId,
                     phone_number: phone_number.replace(/\D/g, ''),
                     waiting_for: 'sync_status_selection',
                     extracted_data: syncUps.map(su => ({ sync_up_id: su.id }))
                   }, {
                     onConflict: 'user_id'
                   });
                 
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'CHECK_SYNC_STATUS_SELECT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // Display status for selected sync up
               responseContent = await formatSyncUpStatus(supabase, selectedSyncUp);
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               // Set conversation state for option selection instead of clearing
               await supabase
                 .from('conversation_state')
                 .upsert({
                   user_id: userId,
                   phone_number: phone_number.replace(/\D/g, ''),
                   waiting_for: 'sync_status_option_selection',
                   current_state: 'sync_status_awaiting_action',
                   extracted_data: [{
                     action: 'SYNC_STATUS_DISPLAYED',
                     sync_up_id: selectedSyncUp.id,
                     event_id: selectedSyncUp.event_id,
                     crew_id: selectedSyncUp.crew_id,
                     sync_up_name: selectedSyncUp.events.title,
                     location: selectedSyncUp.events.location,
                     crew_name: selectedSyncUp.crews.name,
                     timestamp: new Date().toISOString()
                   }]
                 }, {
                   onConflict: 'user_id'
                 });
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'CHECK_SYNC_STATUS_DISPLAYED',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SYNC_STATUS_SELECTION') {
               console.log('SYNC_STATUS_SELECTION detected via pattern matching');
               
               const selectionNumber = extractedData.selection_number;
               const syncUpsData = conversationState?.extracted_data || [];
               
               if (selectionNumber < 1 || selectionNumber > syncUpsData.length) {
                 responseContent = `I didn't understand that. Reply with a sync up number or 'exit' to do something else.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_SELECTION_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               const selectedSyncUpId = syncUpsData[selectionNumber - 1].sync_up_id;
               
              // Fetch full sync up data
              const { data: syncUp } = await supabase
                .from('sync_ups')
                .select(`
                  id,
                  event_id,
                  crew_id,
                  events (id, title, location),
                  crews (id, name),
                  sync_up_options (id, idx, start_time, end_time, option_text)
                `)
                .eq('id', selectedSyncUpId)
                .single();
               
               responseContent = await formatSyncUpStatus(supabase, syncUp);
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               // Set conversation state for option selection instead of clearing
               await supabase
                 .from('conversation_state')
                 .upsert({
                   user_id: userId,
                   phone_number: phone_number.replace(/\D/g, ''),
                   waiting_for: 'sync_status_option_selection',
                   current_state: 'sync_status_awaiting_action',
                   extracted_data: [{
                     action: 'SYNC_STATUS_DISPLAYED',
                     sync_up_id: syncUp.id,
                     event_id: syncUp.event_id,
                     crew_id: syncUp.crew_id,
                     sync_up_name: syncUp.events.title,
                     location: syncUp.events.location,
                     crew_name: syncUp.crews.name,
                     timestamp: new Date().toISOString()
                   }]
                 }, {
                   onConflict: 'user_id'
                 });
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_STATUS_DISPLAYED',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SYNC_STATUS_SELECTION_ERROR') {
               console.log('SYNC_STATUS_SELECTION_ERROR detected via pattern matching');
               
               responseContent = `I didn't understand that. Reply with a sync up number or 'exit' to do something else.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_STATUS_SELECTION_ERROR',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SYNC_STATUS_OPTION_SELECTED') {
               console.log('SYNC_STATUS_OPTION_SELECTED detected');
               
               const optionNumber = extractedData.option_number;
               
               // Get sync up data from conversation state
               let syncStatusData = null;
               if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
                 for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                   const item = conversationState.extracted_data[i];
                   if (item.action === 'SYNC_STATUS_DISPLAYED') {
                     syncStatusData = item;
                     break;
                   }
                 }
               }
               
               if (!syncStatusData) {
                 responseContent = 'Sync up data not found. Please start over.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_OPTION_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // Fetch the selected sync up option
               const { data: options } = await supabase
                 .from('sync_up_options')
                 .select('*')
                 .eq('sync_up_id', syncStatusData.sync_up_id)
                 .order('idx');
               
               if (!options || optionNumber < 1 || optionNumber > options.length) {
                 responseContent = `I didn't understand that. Reply with an option number, 'Re Sync', or 'exit'.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_OPTION_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               const selectedOption = options[optionNumber - 1];
               
               // Get crew member count
               const { count: memberCount } = await supabase
                 .from('crew_members')
                 .select('*', { count: 'exact', head: true })
                 .eq('crew_id', syncStatusData.crew_id);
               
               // Format the confirmation message
               const startTime = new Date(selectedOption.start_time);
               const endTime = selectedOption.end_time ? new Date(selectedOption.end_time) : null;
               const dateStr = startTime.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
               const startTimeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
               const endTimeStr = endTime ? `-${endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}` : '';
               
               responseContent = `Confirm: Send invites for ${syncStatusData.sync_up_name} at ${syncStatusData.location} on ${dateStr}, ${startTimeStr}${endTimeStr} to ${syncStatusData.crew_name} (${memberCount} members)?`;
               
               // Update conversation state for confirmation
               await supabase
                 .from('conversation_state')
                 .upsert({
                   user_id: userId,
                   phone_number: phone_number.replace(/\D/g, ''),
                   waiting_for: 'sync_status_invite_confirmation',
                   current_state: 'sync_status_confirming_invite',
                   extracted_data: [
                     ...conversationState.extracted_data,
                     {
                       action: 'SYNC_STATUS_OPTION_CONFIRMED',
                       sync_up_id: syncStatusData.sync_up_id,
                       event_id: syncStatusData.event_id,
                       crew_id: syncStatusData.crew_id,
                       sync_up_name: syncStatusData.sync_up_name,
                       location: syncStatusData.location,
                       crew_name: syncStatusData.crew_name,
                       selected_option_id: selectedOption.id,
                       selected_option: selectedOption,
                       timestamp: new Date().toISOString()
                     }
                   ]
                 }, {
                   onConflict: 'user_id'
                 });
               
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_STATUS_OPTION_SELECTED',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'SYNC_STATUS_CONFIRM_INVITE') {
               console.log('SYNC_STATUS_CONFIRM_INVITE detected');
               
               // Re-fetch conversation state to get latest data
               const { data: latestState } = await supabase
                 .from('conversation_state')
                 .select('extracted_data')
                 .eq('user_id', userId)
                 .maybeSingle();
               
               // Get option data from conversation state
               let optionData = null;
               if (latestState?.extracted_data && Array.isArray(latestState.extracted_data)) {
                 for (let i = latestState.extracted_data.length - 1; i >= 0; i--) {
                   const item = latestState.extracted_data[i];
                   if (item.action === 'SYNC_STATUS_OPTION_CONFIRMED') {
                     optionData = item;
                     break;
                   }
                 }
               }
               
               if (!optionData) {
                 responseContent = 'Invitation data not found. Please start over.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_INVITE_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // Create a new event from the selected sync up option
               // Convert datetime to time format for database
               const startTime = new Date(optionData.selected_option.start_time);
               const endTime = optionData.selected_option.end_time ? new Date(optionData.selected_option.end_time) : null;
               
               const startTimeStr = startTime.toTimeString().split(' ')[0]; // HH:MM:SS format
               const endTimeStr = endTime ? endTime.toTimeString().split(' ')[0] : null;
               
               console.log('Creating event with data:', {
                 title: optionData.sync_up_name || 'Sync Up Event',
                 location: optionData.location || 'TBD',
                 start_time: startTimeStr,
                 end_time: endTimeStr,
                 creator_id: userId,
                 status: 'active',
                 event_date: optionData.selected_option.start_time.split('T')[0],
                 notes: `Created from sync up: ${optionData.sync_up_name}`
               });
               
               const { data: newEvent, error: createEventError } = await supabase
                 .from('events')
                 .insert({
                   title: optionData.sync_up_name || 'Sync Up Event',
                   location: optionData.location || 'TBD',
                   start_time: startTimeStr,
                   end_time: endTimeStr,
                   creator_id: userId,
                   crew_id: optionData.crew_id, // Add crew_id from sync up data
                   status: 'active',
                   event_date: optionData.selected_option.start_time.split('T')[0], // Extract date part
                   notes: `Created from sync up: ${optionData.sync_up_name}`
                 })
                 .select('id')
                 .single();
               
               console.log('Event creation result:', { newEvent, createEventError });
               
               if (createEventError || !newEvent) {
                 console.error('Error creating event:', createEventError);
                 responseContent = `Failed to create event: ${createEventError?.message || 'Unknown error'}. Please try again.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_INVITE_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
               
               // Call send-invitations edge function
               const inviteResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                 method: 'POST',
                 headers: {
                   'Content-Type': 'application/json',
                   'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                 },
                 body: JSON.stringify({
                   event_id: newEvent.id,
                   inviting_user_id: userId,
                   crew_id: optionData.crew_id,
                   send_sms: send_sms
                 })
               });
               
              //  if (!inviteResponse.ok) {
              //    console.error('send-invitations returned error:', inviteResponse.status, inviteResponse.statusText);
              //    const errorText = await inviteResponse.text();
              //    console.error('Error response:', errorText);
              //    responseContent = `Failed to send invitations: ${inviteResponse.statusText || 'Unknown error'}. Please try again.`;
              //    shouldSendSMS = true;
              //    await sendSMS(phone_number, responseContent, send_sms, phone_number);
              //    return new Response(JSON.stringify({
              //      success: true,
              //      action: 'SYNC_STATUS_INVITE_ERROR',
              //      response: responseContent,
              //      optimization: 'pattern_matching'
              //    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
              //  }
               
               const inviteResult = await inviteResponse.json();
               console.log('send-invitations response:', inviteResult);
               
               // Check if invitations were processed successfully
               // send-invitations returns { message: 'Invitations processed', results: [...], ... }
               // It doesn't have a 'success' field, so we check for the message or results
               const invitationsProcessed = inviteResult.message === 'Invitations processed' || inviteResult.results || inviteResult.success;
               
               if (invitationsProcessed) {
                 // Count successful invitations from results array
                 const successfulInvites = inviteResult.results ? inviteResult.results.filter((r: any) => r.status === 'success' || r.status === 'sent').length : 0;
                 const totalInvites = inviteResult.results ? inviteResult.results.length : 0;
                 
                 // Fetch event with shorten_event_url (with retry logic)
                 const { shorten_event_url, event: eventData } = await fetchEventWithShortUrl(supabase, newEvent.id);
                 const eventLink = formatEventLink(newEvent.id, shorten_event_url);
                 
                 // Format date and time from separate fields
                 // event_date is YYYY-MM-DD, start_time is HH:MM:SS
                 let dateStr = '';
                 let timeStr = '';
                 
                 if (eventData && eventData.event_date) {
                   const eventDate = new Date(eventData.event_date + 'T00:00:00');
                   dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
                 }
                 
                 if (eventData && eventData.start_time) {
                   // Parse time string (HH:MM:SS) and format it
                   const [hours, minutes] = eventData.start_time.split(':').map(Number);
                   const timeDate = new Date();
                   timeDate.setHours(hours, minutes, 0, 0);
                   timeStr = timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                 }
                 
                 // Use successful count if available, otherwise use total count or fallback to inviteResult.invites_sent
                 const invitesSent = successfulInvites > 0 ? successfulInvites : (totalInvites > 0 ? totalInvites : (inviteResult.invites_sent || 0));
                 responseContent = `${invitesSent} invites sent for ${eventData?.title || 'event'} on ${dateStr} at ${timeStr}. Check RSVPs: ${eventLink}`;
                 
                 // Update sync_up status to 'completed' since it's been converted to an event
                 await supabase
                   .from('sync_ups')
                   .update({ status: 'completed' })
                   .eq('id', optionData.sync_up_id);
                 
                 // Update all sync_up_responses to mark them as no longer needed
                 await supabase
                   .from('sync_up_responses')
                   .update({ status: 'completed' })
                   .eq('sync_up_id', optionData.sync_up_id);
                 
                 // Reset crew member conversation states to clear waiting_for
                 const { data: crewMembers } = await supabase
                   .from('crew_members')
                   .select('user_id')
                   .eq('crew_id', optionData.crew_id);
                 
                 if (crewMembers && crewMembers.length > 0) {
                   const crewUserIds = crewMembers.map(member => member.user_id);
                   await supabase
                     .from('conversation_state')
                     .update({ 
                       waiting_for: null,
                       current_state: 'idle',
                       extracted_data: []
                     })
                     .in('user_id', crewUserIds);
                 }
                 
                 // Clear host conversation state
                 await supabase
                   .from('conversation_state')
                   .delete()
                   .eq('user_id', userId);
                 
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_INVITES_SENT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               } else {
                 console.error('send-invitations returned unsuccessful result:', inviteResult);
                 const errorMessage = inviteResult.error || inviteResult.message || 'Unknown error';
                 responseContent = `Failed to send invitations: ${errorMessage}. Please try again.`;
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'SYNC_STATUS_INVITE_ERROR',
                   response: responseContent,
                   optimization: 'pattern_matching',
                   error_details: {
                     type: 'invitation_send_error',
                     result: inviteResult
                   }
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
               }
             } else if (action === 'SYNC_STATUS_CONFIRM_INVITE_ERROR') {
               console.log('SYNC_STATUS_CONFIRM_INVITE_ERROR detected via pattern matching');
               
               responseContent = `I didn't understand that. Reply 'yes' to send invites or 'exit' to cancel.`;
               shouldSendSMS = true;
               await sendSMS(phone_number, responseContent, send_sms, phone_number);
               
               return new Response(JSON.stringify({
                 success: true,
                 action: 'SYNC_STATUS_CONFIRM_INVITE_ERROR',
                 response: responseContent,
                 optimization: 'pattern_matching'
               }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             } else if (action === 'RESET') {
               console.log('RESET detected via pattern matching, asking for confirmation');
               
               try {
                 responseContent = 'Are you sure you want to reset the conversation? This will clear all current progress. Reply "yes" to confirm or "no" to cancel.';
                 shouldSendSMS = true;
                 
                 // Update conversation state to wait for reset confirmation
                 await supabase
                   .from('conversation_state')
                   .upsert({
                     user_id: userId,
                     phone_number: phone_number,
                     waiting_for: 'reset_confirmation',
                     current_state: 'reset_confirmation',
                     extracted_data: []
                   });
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in RESET:', error);
                 responseContent = 'Failed to process reset request. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'EXIT') {
               console.log('EXIT detected via pattern matching, ending conversation');
               
               try {
                 // Reset conversation state instead of deleting
                 await supabase
                   .from('conversation_state')
                   .update({
                     current_state: 'normal',
                     waiting_for: null,
                     extracted_data: [],
                     last_action: 'EXIT',
                     last_action_timestamp: new Date().toISOString()
                   })
                   .eq('user_id', userId);
                 
                 responseContent = 'What would you like to do next?';
                 shouldSendSMS = true;
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'EXIT',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
              } catch (error) {
                console.error('Error in EXIT:', error);
                responseContent = 'What would you like to do next?';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'EXIT',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'ONBOARDING') {
              console.log('ONBOARDING detected via pattern matching, resetting user to brand new state');
              
              try {
                // 1. Set profile.is_onboarded = false
                await supabase
                  .from('profiles')
                  .update({
                    is_onboarded: false,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', userId);
                
                console.log('Profile updated: is_onboarded set to false');
                
                // 2. Reset conversation_state to onboarding step 1 (matching auto-launch-onboarding)
                await supabase
                  .from('conversation_state')
                  .upsert({
                    user_id: userId,
                    phone_number: phone_number,
                    current_state: 'onboarding_step_1',
                    onboarding_step: 1,
                    waiting_for: 'crew_name',
                    last_action: 'ONBOARDING_START',
                    last_action_timestamp: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
                    created_at: new Date().toISOString(),
                    extracted_data: []
                  }, {
                    onConflict: 'user_id'
                  });
                
                console.log('Conversation state reset to onboarding_step_1');
                
                // 3. Send welcome message (same as auto-launch-onboarding)
                responseContent = `Welcome to Funlet! 🎉 I'm your AI assistant for organizing group events. What should we call your first crew?`;
                shouldSendSMS = true;
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                // 4. Log user action
                await supabase
                  .from('user_actions')
                  .insert({
                    user_id: userId,
                    action: 'onboarding_restart',
                    event_id: null,
                    metadata: {
                      phone_number: phone_number,
                      trigger: 'manual_command',
                      command: 'onboarding'
                    }
                  });
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'ONBOARDING',
                  response: responseContent,
                  onboarding_step: 1,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } catch (error) {
                console.error('Error in ONBOARDING:', error);
                responseContent = 'Failed to restart onboarding. Please try again.';
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                
                return new Response(JSON.stringify({
                  success: true,
                  action: 'ONBOARDING',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            } else if (action === 'RESET_CONFIRMATION_YES') {
               console.log('RESET_CONFIRMATION_YES detected via pattern matching, clearing conversation state');
               
               try {
                 // Reset conversation state instead of deleting
                 await supabase
                   .from('conversation_state')
                   .update({
                     current_state: 'normal',
                     waiting_for: null,
                     extracted_data: [],
                     last_action: 'RESET_CONFIRMATION_YES',
                     last_action_timestamp: new Date().toISOString()
                   })
                   .eq('user_id', userId);
                 
                 responseContent = 'Conversation reset. You can start fresh with any command.';
                 shouldSendSMS = true;
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in RESET_CONFIRMATION_YES:', error);
                 responseContent = 'Failed to reset conversation. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET_CONFIRMATION_YES',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'RESET_CONFIRMATION_NO') {
               console.log('RESET_CONFIRMATION_NO detected via pattern matching, cancelling reset');
               
               try {
                 // Clear the reset confirmation state but keep other conversation state
                 await supabase
                   .from('conversation_state')
                   .update({
                     waiting_for: null,
                     current_state: 'normal'
                   })
                   .eq('user_id', userId);
                 
                 responseContent = 'Reset cancelled. You can continue with your current conversation.';
                 shouldSendSMS = true;
                 
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET_CONFIRMATION_NO',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               } catch (error) {
                 console.error('Error in RESET_CONFIRMATION_NO:', error);
                 responseContent = 'Failed to cancel reset. Please try again.';
                 shouldSendSMS = true;
                 await sendSMS(phone_number, responseContent, send_sms, phone_number);
                 
                 return new Response(JSON.stringify({
                   success: true,
                   action: 'RESET_CONFIRMATION_NO',
                   response: responseContent,
                   optimization: 'pattern_matching'
                 }), {
                   headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                 });
               }
             } else if (action === 'ADD_CREW_MEMBERS') {
               console.log('ADD_CREW_MEMBERS detected via pattern matching, bypassing AI');
        try {
          // Check if there's a crew_id in the conversation state first
          let crewId = null;
          let crewName = null;
          
          // Check current context (from extracted_data)
          if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            // Search from the end of the array to find the most recent crew_id
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              if (item.crew_id || item.executed_data?.crew_id) {
                crewId = item.crew_id || item.executed_data.crew_id;
                crewName = item.crew_name || item.executed_data?.crew_name;
                break;
              }
            }
          }
          
          // Also check for CREW_SELECTED action in extracted_data
          if (!crewId && conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              if (item.action === 'CREW_SELECTED' && item.crew_id) {
                crewId = item.crew_id;
                crewName = item.crew_name;
                break;
              }
            }
          }
          
          // Also check for CHECK_CREW_MEMBERS action in extracted_data
          if (!crewId && conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              if (item.action === 'CHECK_CREW_MEMBERS' && item.crew_id) {
                crewId = item.crew_id;
                crewName = item.crew_name;
                break;
              }
            }
          }
          
          // NEW: Check for crew name extraction from pattern matching
          if (!crewId && extractedData.crewName) {
            console.log('Crew name extracted from pattern:', extractedData.crewName);
            
            // Handle "my crew" as no specific crew
            if (extractedData.crewName.toLowerCase() === 'my crew') {
              console.log('"my crew" detected, treating as no specific crew');
            } else {
              // Query user's crews for exact match (case-insensitive)
              const { data: userCrews, error: crewsError } = await supabase
                .from('crews')
                .select('id, name')
                .eq('creator_id', userId)
                .ilike('name', extractedData.crewName);
              
              if (crewsError) {
                console.error('Error querying crews:', crewsError);
              } else if (userCrews && userCrews.length > 0) {
                // Found matching crew
                crewId = userCrews[0].id;
                crewName = userCrews[0].name;
                console.log('Auto-selected crew:', crewName, crewId);
                
                // Update conversation state to member adding mode
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: 'member_adding_mode',
                    current_state: 'normal',
                    extracted_data: [
                      ...(conversationState?.extracted_data || []),
                      {
                        action: 'CREW_SELECTED',
                        crew_id: crewId,
                        crew_name: crewName,
                        timestamp: new Date().toISOString()
                      }
                    ]
                  })
                  .eq('user_id', userId);
                
                // Show prompt for member addition
                const joinLink = await getCrewJoinLink(supabase, crewId);
                responseContent = `To add members:\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'ADD_CREW_MEMBERS',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } else {
                // Crew not found
                responseContent = `Crew '${extractedData.crewName}' not found. Reply with a crew number or 'Create Crew'.`;
                shouldSendSMS = true;
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'ADD_CREW_MEMBERS',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            }
          }
          
          if (crewId) {
            // Use the crew from context - proceed directly to member addition
            console.log('Using crew from context:', crewId, crewName);
            
            // Process member data from pattern matching
            if (extractedData.crew_members && extractedData.crew_members.length > 0) {
              const members = extractedData.crew_members;
              
              // NEW: Validate that we actually parsed valid member data
              const hasValidMembers = members.every(m => m.name && m.phone);
              
              if (!hasValidMembers) {
                // Check if multiple names without phone numbers
                const nameOnlyPattern = /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*(?:\s*,\s*[a-zA-Z]+(?:\s+[a-zA-Z]+)*)+$/;
                if (nameOnlyPattern.test(message.trim())) {
                  const joinLink = await getCrewJoinLink(supabase, crewId);
                  responseContent = `I didn't understand that.\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                } else {
                  // Check if mixed input (some with numbers, some without)
                  const parts = message.split(',').map(p => p.trim());
                  const withNumbers = parts.filter(p => /[\+\d\(\)\-\s]{7,}/.test(p));
                  const withoutNumbers = parts.filter(p => !/[\+\d\(\)\-\s]{7,}/.test(p));
                  
                  if (withNumbers.length > 0 && withoutNumbers.length > 0) {
                    const joinLink = await getCrewJoinLink(supabase, crewId);
                    responseContent = `I added what I could. Add the rest one at a time.\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                  } else {
                    const joinLink = await getCrewJoinLink(supabase, crewId);
                    responseContent = `I didn't understand that.\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                  }
                }
                shouldSendSMS = true;
                
                // Update conversation state to maintain member adding mode
                await supabase
                  .from('conversation_state')
                  .update({
                    waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
                  })
                  .eq('user_id', userId);
                
                await sendSMS(phone_number, responseContent, send_sms, phone_number);
                return new Response(JSON.stringify({
                  success: true,
                  action: 'ADD_CREW_MEMBERS',
                  response: responseContent,
                  optimization: 'pattern_matching'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              
              // Add members immediately (no confirmation) - add to existing crew
              const addedMembers = [];
              const skippedMembers = []; // Store objects with name and phone for formatting
              for (const member of members) {
                // Check if contact already exists
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('phone_number', member.phone)
                  .eq('user_id', userId)
                  .single();
                
                let contactId;
                if (existingContact) {
                  // Update existing contact with new name
                  console.log('Updating existing contact name:', existingContact.id);
                  const { first_name, last_name } = parseNameIntoFirstAndLast(member.name);
                  
                  const { error: updateError } = await supabase
                    .from('contacts')
                    .update({
                      first_name: first_name,
                      last_name: last_name
                    })
                    .eq('id', existingContact.id);
                  
                  if (updateError) {
                    console.error('Error updating contact name:', updateError);
                    // Continue with existing contact if update fails
                  }
                  
                  contactId = existingContact.id;
                } else {
                  // Create new contact
                  const { first_name, last_name } = parseNameIntoFirstAndLast(member.name);
                  const { data: newContact, error: contactError } = await supabase
                    .from('contacts')
                    .insert({
                      first_name: first_name,
                      last_name: last_name,
                      phone_number: member.phone,
                      user_id: userId
                    })
                    .select('id')
                    .single();
                  
                  if (contactError) {
                    console.error('Error creating contact:', contactError);
                    // If duplicate key error, try to fetch the existing contact
                    if (contactError.code === '23505') {
                      const { data: duplicateContact } = await supabase
                        .from('contacts')
                        .select('id')
                        .eq('phone_number', member.phone)
                        .eq('user_id', userId)
                        .single();
                      
                      if (duplicateContact) {
                        // Update the duplicate contact with new name
                        const { first_name: dup_first_name, last_name: dup_last_name } = parseNameIntoFirstAndLast(member.name);
                        await supabase
                          .from('contacts')
                          .update({
                            first_name: dup_first_name,
                            last_name: dup_last_name
                          })
                          .eq('id', duplicateContact.id);
                        contactId = duplicateContact.id;
                      } else {
                        console.error('Could not find duplicate contact after error');
                        continue;
                      }
                    } else {
                      // Other error - skip this member
                      continue;
                    }
                  } else {
                    contactId = newContact.id;
                  }
                }
                
                // Check if contact is already a member of this crew
                const { data: existingMember } = await supabase
                  .from('crew_members')
                  .select('id')
                  .eq('crew_id', crewId)
                  .eq('contact_id', contactId)
                  .single();
                
                if (existingMember) {
                  console.log(`Contact ${member.name} is already a member of this crew, skipping...`);
                  // Store both name and phone for formatted display
                  skippedMembers.push({ name: member.name, phone: member.phone });
                  continue;
                }
                
                // Add to crew_members
                const { error: memberError } = await supabase
                  .from('crew_members')
                  .insert({
                    crew_id: crewId,
                    contact_id: contactId
                  });
                
                if (memberError) {
                  console.error('Error adding member to crew:', memberError);
                  continue;
                }
                
                addedMembers.push(member.name);
              }
              
              const joinLink = await getCrewJoinLink(supabase, crewId);
              
              if (addedMembers.length > 0 && skippedMembers.length > 0) {
                // Mixed: some added, some skipped
                const skippedFormatted = skippedMembers.map(m => {
                  const formattedPhone = formatPhoneNumberForCrewMessage(m.phone);
                  return `${m.name} (${formattedPhone})`;
                }).join(', ');
                responseContent = `Added ${addedMembers.join(', ')} to ${crewName}. ${skippedFormatted} ${skippedMembers.length === 1 ? 'is' : 'are'} already in ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                shouldSendSMS = true;
              } else if (addedMembers.length > 0) {
                // All added successfully
                responseContent = `Added ${addedMembers.join(', ')} to ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                shouldSendSMS = true;
              } else if (skippedMembers.length > 0) {
                // All were already members - format with phone numbers
                const skippedFormatted = skippedMembers.map(m => {
                  const formattedPhone = formatPhoneNumberForCrewMessage(m.phone);
                  return `${m.name} (${formattedPhone})`;
                }).join(', ');
                responseContent = `${skippedFormatted} ${skippedMembers.length === 1 ? 'is' : 'are'} already in ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                shouldSendSMS = true;
              } else {
                // Failed to parse or process any members
                const joinLinkError = await getCrewJoinLink(supabase, crewId);
                responseContent = `Failed to add members to ${crewName}. Please try again.\n\nShare link for people to add themselves: ${joinLinkError}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
                shouldSendSMS = true;
              }
            } else {
              // No member data provided - ask for member info
              const joinLink = await getCrewJoinLink(supabase, crewId);
              responseContent = `To add members:\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
              shouldSendSMS = true;
              
              // Set waiting_for state to allow name-only search
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'crew_member_addition'
                })
                .eq('user_id', userId);
            }
          } else {
            // No crew_id in context - show crew selection
            console.log('No crew_id in context, showing crew list for selection');
            
            // Get user's crews to choose from
            const { data: userCrews } = await supabase
              .from('crews')
              .select('id, name')
              .eq('creator_id', userId)
              .order('name');
            
            if (userCrews && userCrews.length === 0) {
              // No crews found - ask to create one first
              responseContent = 'No crews found. Type "Create Crew" to create your first crew.';
              shouldSendSMS = true;
            } else if (userCrews && userCrews.length === 1) {
              // User has exactly one crew - auto-select and proceed
              const crew = userCrews[0];
              const joinLink = await getCrewJoinLink(supabase, crew.id);
              responseContent = `To add members:\n\nType a name already in Funlet: Tom\nType a name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
              shouldSendSMS = true;
              
              // Store the selected crew in conversation state
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'crew_member_addition',
                  extracted_data: [{
                    action: 'CREW_SELECTED',
                    crew_id: crew.id,
                    crew_name: crew.name,
                    timestamp: new Date().toISOString()
                  }]
                })
                .eq('user_id', userId);
            } else {
              // User has multiple crews - show numbered list for selection
              let crewList = 'Add members to which crew?\n';
              userCrews.forEach((crew, index) => {
                crewList += `${index + 1}. ${crew.name}\n`;
              });
              crewList += 'Reply with the crew number or "Create Crew" to make a new one.';
              
              responseContent = crewList;
              shouldSendSMS = true;
              
              // Get existing extracted_data to preserve it
              const { data: conversationStateDataData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              // Append to existing extracted_data
              const existingData = Array.isArray(conversationStateDataData?.extracted_data) ? conversationStateDataData.extracted_data : [];
              const updatedExtractedData = [...existingData, {
                crew_list: userCrews,
                crew_list_message: crewList,
                action: 'CREW_LIST_SHOWN',
                timestamp: new Date().toISOString()
              }];
              
              // Update or create conversation state to wait for crew selection and store crew list
              await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number.replace(/\D/g, ''),
                  current_state: 'normal',
                  waiting_for: 'crew_selection_for_members',
                  last_action: action,
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                }, {
                  onConflict: 'user_id'
                });
            }
          }
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'ADD_CREW_MEMBERS',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in ADD_CREW_MEMBERS pattern matching:', error);
          responseContent = 'Failed to add members. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'ADD_CREW_MEMBERS',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'SEARCH_CONTACT_BY_NAME') {
        console.log('SEARCH_CONTACT_BY_NAME detected via pattern matching');
        
        try {
          const searchName = extractedData.search_name;
          if (!searchName) {
            // Get crew info from conversation state to include join link
            let crewId = null;
            if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
              for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                const item = conversationState.extracted_data[i];
                if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
                  crewId = item.crew_id || item.executed_data?.crew_id;
                  break;
                }
              }
            }
            
            if (crewId) {
              const joinLink = await getCrewJoinLink(supabase, crewId);
              responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            } else {
              responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            }
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Get crew context from conversation state
          let crewId = null;
          let crewName = null;
          if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              // Check for CREW_SELECTED action
              if (item.action === 'CREW_SELECTED' || item.crew_id) {
                crewId = item.crew_id;
                crewName = item.crew_name;
                break;
              }
              // Check for CREW_CREATED in executed_data
              if (item.executed_data && item.executed_data.action === 'CREW_CREATED') {
                crewId = item.executed_data.crew_id;
                crewName = item.executed_data.crew_name;
                break;
              }
            }
          }
          
          if (!crewId) {
            responseContent = 'No crew selected. Please start over by saying "add members".';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Search contacts by name - first get count to check if there are more than 10
          const { count: totalCount } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .or(`first_name.ilike.%${searchName}%,last_name.ilike.%${searchName}%`);
          
          // Search contacts by name - get first 10
          const { data: contacts, error: searchError } = await supabase
            .from('contacts')
            .select('id, first_name, last_name, phone_number')
            .eq('user_id', userId)
            .or(`first_name.ilike.%${searchName}%,last_name.ilike.%${searchName}%`)
            .order('created_at', { ascending: false })
            .limit(10);
          
          if (searchError) {
            console.error('Error searching contacts:', searchError);
            responseContent = 'Error searching contacts. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          if (!contacts || contacts.length === 0) {
            // No matches found
            responseContent = `No one named ${searchName} found in Funlet. To add them, type name and number (${searchName} 4155551234), or type another name.`;
            shouldSendSMS = true;
            
            // Keep in add-members flow
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: conversationState?.waiting_for || 'crew_member_addition'
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (contacts.length === 1) {
            // Single match - show confirmation
            const contact = contacts[0];
            const displayName = contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name;
            // Format phone as XXX-XXX-XXXX (without parentheses)
            const digits = contact.phone_number.replace(/\D/g, '');
            const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
            const formattedPhone = cleanDigits.length === 10 
              ? `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`
              : contact.phone_number;
            
            responseContent = `Found ${displayName} (${formattedPhone}). Add to ${crewName}? Reply 'y' to add, or type a name and number for a new crew member.`;
            shouldSendSMS = true;
            
            // Store contact info in conversation state for confirmation
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'confirm_add_contact',
                extracted_data: [
                  ...(conversationState?.extracted_data || []),
                  {
                    action: 'CONTACT_SEARCH_RESULT',
                    search_name: searchName,
                    contact_id: contact.id,
                    contact_name: displayName,
                    contact_phone: contact.phone_number,
                    crew_id: crewId,
                    crew_name: crewName,
                    timestamp: new Date().toISOString()
                  }
                ]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (contacts.length <= 10 && (!totalCount || totalCount <= 10)) {
            // 2-10 matches - show numbered list
            let contactList = `Found ${contacts.length} people named ${searchName}:\n\n`;
            contacts.forEach((contact, index) => {
              const displayName = contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name;
              // Format phone as XXX-XXX-XXXX (without parentheses)
              const digits = contact.phone_number.replace(/\D/g, '');
              const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
              const formattedPhone = cleanDigits.length === 10 
                ? `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`
                : contact.phone_number;
              contactList += `${index + 1}. ${displayName} (${formattedPhone})\n`;
            });
            contactList += '\nReply with the number of the crew member to add.';
            
            responseContent = contactList;
            shouldSendSMS = true;
            
            // Store contact list in conversation state for selection
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'contact_search_selection',
                extracted_data: [
                  ...(conversationState?.extracted_data || []),
                  {
                    action: 'CONTACT_SEARCH_RESULTS',
                    search_name: searchName,
                    contacts: contacts.map(c => ({
                      id: c.id,
                      name: c.last_name ? `${c.first_name} ${c.last_name}` : c.first_name,
                      phone: c.phone_number
                    })),
                    crew_id: crewId,
                    crew_name: crewName,
                    timestamp: new Date().toISOString()
                  }
                ]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            // 10+ matches - show first 10
            let contactList = `Found 10+ people named ${searchName}. Showing the most recent 10:\n\n`;
            contacts.forEach((contact, index) => {
              const displayName = contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name;
              // Format phone as XXX-XXX-XXXX (without parentheses)
              const digits = contact.phone_number.replace(/\D/g, '');
              const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
              const formattedPhone = cleanDigits.length === 10 
                ? `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`
                : contact.phone_number;
              contactList += `${index + 1}. ${displayName} (${formattedPhone})\n`;
            });
            contactList += '\nReply with the number of the crew member to add.';
            
            responseContent = contactList;
            shouldSendSMS = true;
            
            // Store contact list in conversation state for selection
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'contact_search_selection',
                extracted_data: [
                  ...(conversationState?.extracted_data || []),
                  {
                    action: 'CONTACT_SEARCH_RESULTS',
                    search_name: searchName,
                    contacts: contacts.map(c => ({
                      id: c.id,
                      name: c.last_name ? `${c.first_name} ${c.last_name}` : c.first_name,
                      phone: c.phone_number
                    })),
                    crew_id: crewId,
                    crew_name: crewName,
                    timestamp: new Date().toISOString()
                  }
                ]
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'SEARCH_CONTACT_BY_NAME',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          console.error('Error in SEARCH_CONTACT_BY_NAME:', error);
          responseContent = 'Error searching contacts. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'SEARCH_CONTACT_BY_NAME',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'CONFIRM_ADD_CONTACT') {
        console.log('CONFIRM_ADD_CONTACT detected via pattern matching');
        
        try {
          // Get contact info from conversation state
          let contactId = null;
          let contactName = null;
          let crewId = null;
          let crewName = null;
          
          if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              if (item.action === 'CONTACT_SEARCH_RESULT') {
                contactId = item.contact_id;
                contactName = item.contact_name;
                crewId = item.crew_id;
                crewName = item.crew_name;
                break;
              }
            }
          }
          
          if (!contactId || !crewId) {
            responseContent = 'Contact information not found. Please try searching again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONFIRM_ADD_CONTACT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Check if contact is already in crew
          const { data: existingMember } = await supabase
            .from('crew_members')
            .select('id')
            .eq('crew_id', crewId)
            .eq('contact_id', contactId)
            .single();
          
          if (existingMember) {
            // Get contact's phone number for display
            const { data: contactData } = await supabase
              .from('contacts')
              .select('phone_number')
              .eq('id', contactId)
              .eq('user_id', userId)
              .single();
            
            const formattedPhone = contactData?.phone_number ? formatPhoneNumberForCrewMessage(contactData.phone_number) : '';
            const joinLink = await getCrewJoinLink(supabase, crewId);
            responseContent = `${contactName}${formattedPhone ? ` (${formattedPhone})` : ''} is already in ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            shouldSendSMS = true;
            
            // Reset to add-members flow
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONFIRM_ADD_CONTACT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Add contact to crew
          const { error: memberError } = await supabase
            .from('crew_members')
            .insert({
              crew_id: crewId,
              contact_id: contactId
            });
          
          if (memberError) {
            console.error('Error adding contact to crew:', memberError);
            responseContent = 'Failed to add member. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONFIRM_ADD_CONTACT',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          

          const joinLink = await getCrewJoinLink(supabase, crewId);
          responseContent = `Added ${contactName} to ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
          shouldSendSMS = true;
          
          // Reset to add-members flow
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'CONFIRM_ADD_CONTACT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in CONFIRM_ADD_CONTACT:', error);
          responseContent = 'Error adding member. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'CONFIRM_ADD_CONTACT',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'CONTACT_SEARCH_SELECTION') {
        console.log('CONTACT_SEARCH_SELECTION detected via pattern matching');
        
        try {
          const selectionNumber = extractedData.selection_number;
          if (!selectionNumber || selectionNumber < 1) {
            // Get crew info to return to member adding mode with consistent error format
            let crewId = null;
            if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
              for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                const item = conversationState.extracted_data[i];
                if (item.action === 'CONTACT_SEARCH_RESULTS') {
                  crewId = item.crew_id;
                  break;
                } else if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
                  crewId = item.crew_id || item.executed_data?.crew_id;
                  break;
                }
              }
            }
            
            if (crewId) {
              const joinLink = await getCrewJoinLink(supabase, crewId);
              responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            } else {
              responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            }
            
            // Reset to member adding mode
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
              })
              .eq('user_id', userId);
            
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONTACT_SEARCH_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Get contact list from conversation state
          let contacts = null;
          let crewId = null;
          let crewName = null;
          
          if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
            for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationState.extracted_data[i];
              if (item.action === 'CONTACT_SEARCH_RESULTS') {
                contacts = item.contacts;
                crewId = item.crew_id;
                crewName = item.crew_name;
                break;
              }
            }
          }
          
          if (!contacts || !crewId || selectionNumber > contacts.length) {
            // Try to get crew info from conversation state if not found in search results
            if (!crewId && conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
              for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
                const item = conversationState.extracted_data[i];
                if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
                  crewId = item.crew_id || item.executed_data?.crew_id;
                  crewName = item.crew_name || item.executed_data?.crew_name;
                  break;
                }
              }
            }
            
            if (crewId) {
              const joinLink = await getCrewJoinLink(supabase, crewId);
              responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'CONTACT_SEARCH_SELECTION',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            } else {
              // Contact list not found - return INVALID_MEMBER_ADDING_MODE action
              responseContent = 'Contact list not found. Please try searching again.';
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'INVALID_MEMBER_ADDING_MODE',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
          
          const selectedContact = contacts[selectionNumber - 1];
          
          // Check if contact is already in crew
          const { data: existingMember } = await supabase
            .from('crew_members')
            .select('id')
            .eq('crew_id', crewId)
            .eq('contact_id', selectedContact.id)
            .single();
          

          if (existingMember) {
            const joinLink = await getCrewJoinLink(supabase, crewId);
            // Format phone number as XXX-XXX-XXXX
            const digits = selectedContact.phone?.replace(/\D/g, '') || '';
            const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
            const formattedPhone = cleanDigits.length === 10 
              ? `${cleanDigits.substring(0, 3)}-${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`
              : selectedContact.phone || '';
            const phoneDisplay = formattedPhone ? ` (${formattedPhone})` : '';
            responseContent = `${selectedContact.name}${phoneDisplay} is already in ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
            shouldSendSMS = true;
            
            // Reset to add-members flow
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
              })
              .eq('user_id', userId);
            
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONTACT_SEARCH_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Add contact to crew
          const { error: memberError } = await supabase
            .from('crew_members')
            .insert({
              crew_id: crewId,
              contact_id: selectedContact.id
            });
          
          if (memberError) {
            console.error('Error adding contact to crew:', memberError);
            responseContent = 'Failed to add member. Please try again.';
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            return new Response(JSON.stringify({
              success: true,
              action: 'CONTACT_SEARCH_SELECTION',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          

          const joinLink = await getCrewJoinLink(supabase, crewId);
          responseContent = `Added ${selectedContact.name} to ${crewName}.\n\nTo add more members:\n\nType a name already in Funlet: Mike\nType a name and number for a new crew member: Mike 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
          shouldSendSMS = true;
          
          // Reset to add-members flow
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: conversationState?.waiting_for === 'member_adding_mode' ? 'member_adding_mode' : 'crew_member_addition'
            })
            .eq('user_id', userId);
          
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'CONTACT_SEARCH_SELECTION',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in CONTACT_SEARCH_SELECTION:', error);
          responseContent = 'Error adding member. Please try again.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'CONTACT_SEARCH_SELECTION',
            response: responseContent,
            optimization: 'pattern_matching'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else if (action === 'INVALID_MEMBER_ADDING_MODE') {
        console.log('INVALID_MEMBER_ADDING_MODE detected via pattern matching, bypassing AI');
        
        // Get crew info from conversation state
        let crewId = null;
        let crewName = null;
        
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
              crewId = item.crew_id || item.executed_data?.crew_id;
              crewName = item.crew_name || item.executed_data?.crew_name;
              break;
            }
          }
        }
        
        if (crewId) {
          const joinLink = await getCrewJoinLink(supabase, crewId);
          responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
        } else {
          responseContent = `I didn't understand that. Add members like this: Tom 4155551234. You can also type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
        }
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID_MEMBER_ADDING_MODE',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Get assistant ID from constants table
    const { data: constantData, error: constantError } = await supabase
      .from('constants')
      .select('value')
      .eq('key', 'assistant_id_v2')
      .single();

    if (constantError || !constantData) {
      return new Response(JSON.stringify({
        error: 'Assistant not found. Please create an assistant first.'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const assistantId = constantData.value;
    console.log('Using assistant ID:', assistantId);

    // Get or create thread for the user with 2-hour context window
    let threadId = null;
    let shouldCreateNewThread = false;
    let isFirstTimeUser = false;

    // Check if this is a first-time user BEFORE processing the message
    if (phone_number) {
      const normalizedPhone = phone_number.replace(/\D/g, '');
      console.log('Looking up user for phone:', normalizedPhone);
      
      // Create multiple phone number variations to search for (same as handle-sms-response)
      const phoneVariations = [];
      
      // Original formatted phone (e.g., "18777804236")
      phoneVariations.push(normalizedPhone);
      
      // If it's 11 digits and starts with 1, also try without the leading 1 (e.g., "8777804236")
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      
      // If it's 10 digits, also try with leading 1 (e.g., "18777804236")
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      
      // Add + prefix variations for all existing variations
      const plusVariations = phoneVariations.map(phone => '+' + phone);
      phoneVariations.push(...plusVariations);
      
      console.log('Phone variations to search:', phoneVariations);
      
      // Optimized: Try all phone variations in a single query using OR conditions
      let existingProfile = null;
      let profileError = null;
      let foundPhoneVariation = null;
      
      console.log('Searching for profile with phone variations:', phoneVariations);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, subscription_status, is_onboarded, phone_number')
        .in('phone_number', phoneVariations)
        .limit(1);
      
      if (data && data.length > 0 && !error) {
        existingProfile = data[0];
        foundPhoneVariation = existingProfile.phone_number;
        console.log('Found profile with phone variation:', foundPhoneVariation);
      } else {
        console.log('No profile found for any phone variation');
      }

      if (existingProfile) {
        userId = existingProfile.id;
        console.log('Found user:', userId, 'with plan:', existingProfile.subscription_status, 'is_onboarded:', existingProfile.is_onboarded, 'using phone:', foundPhoneVariation);
        
        // Check if user is not onboarded - force them into onboarding
        if (existingProfile.is_onboarded === false) {
          isFirstTimeUser = true;
          console.log('User not onboarded (is_onboarded = false), forcing onboarding');
        } else {
          // User is onboarded, check if they have conversation history
        const { data: conversationHistory } = await supabase
          .from('conversation_state')
          .select('id, last_action')
          .eq('phone_number', foundPhoneVariation)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!conversationHistory || conversationHistory.length === 0) {
            // Even if no conversation history, don't force onboarding for onboarded users
            isFirstTimeUser = false;
            console.log('Onboarded user with no conversation history - not forcing onboarding');
        } else {
            console.log('Onboarded user with conversation history found');
          }
        }
      } else {
        console.log('No existing user found for any phone variation:', phoneVariations);
        isFirstTimeUser = true;
        console.log('First-time user detected - no profile found');
      }
      
      // Also check if there's any conversation history for any phone variation
      // But only if user is NOT onboarded (is_onboarded = false or null)
      // NEVER force onboarded users into onboarding flow regardless of conversation history
      if (!isFirstTimeUser && foundPhoneVariation && existingProfile && existingProfile.is_onboarded !== true) {
        const { data: anyConversationHistory } = await supabase
          .from('conversation_state')
          .select('id')
          .eq('phone_number', foundPhoneVariation)
          .limit(1);
        
        if (!anyConversationHistory || anyConversationHistory.length === 0) {
          isFirstTimeUser = true;
          console.log('First-time user detected - no conversation history for phone number');
        }
      }
    }
    
    if (phone_number) {
      // Use the same phone variation approach for conversation state lookup
      const normalizedPhone = phone_number.replace(/\D/g, '');
      const phoneVariations = [];
      phoneVariations.push(normalizedPhone);
      
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      
      // Optimized: Try all phone variations in a single query
      let conversationState = null;
      const { data } = await supabase
        .from('conversation_state')
        .select('thread_id, thread_created_at, expires_at, phone_number, current_state, waiting_for, extracted_data')
        .in('phone_number', phoneVariations)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (data && data.length > 0) {
        conversationState = data[0];
        console.log('Found conversation state for phone:', conversationState.phone_number);
      }
      
      if (conversationState?.thread_id) {
        // Check if user is in onboarding - if so, don't expire thread
        const isInOnboarding = conversationState.current_state?.startsWith('onboarding_');
        
        if (isInOnboarding) {
          // Keep existing thread during onboarding
          threadId = conversationState.thread_id;
          console.log('User in onboarding, keeping existing thread:', threadId);
        } else {
          // Check if thread has expired (2 hours) - only for non-onboarding users
          const now = new Date();
          const threadCreatedAt = conversationState.thread_created_at ? new Date(conversationState.thread_created_at) : null;
          const expiresAt = conversationState.expires_at ? new Date(conversationState.expires_at) : null;
          
          // If thread is older than 2 hours or conversation state has expired, create new thread
          if (threadCreatedAt && (now.getTime() - threadCreatedAt.getTime() > 2 * 60 * 60 * 1000)) {
            console.log('Thread expired (older than 2 hours), will create new thread');
            shouldCreateNewThread = true;
            
            // Delete the old thread from OpenAI
            try {
              await fetch(`https://api.openai.com/v1/threads/${conversationState.thread_id}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                  'OpenAI-Beta': 'assistants=v2'
                }
              });
              console.log('Deleted expired thread:', conversationState.thread_id);
            } catch (error) {
              console.error('Error deleting expired thread:', error);
            }
          } else if (expiresAt && now > expiresAt) {
            console.log('Conversation state expired, will create new thread');
            shouldCreateNewThread = true;
          } else {
            threadId = conversationState.thread_id;
            console.log('Using existing thread:', threadId);
          }
        }
      } else {
        shouldCreateNewThread = true;
      }
    } else {
      shouldCreateNewThread = true;
    }

    if (!threadId || shouldCreateNewThread) {
      const threadResponse = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({})
      });

      if (!threadResponse.ok) {
        const errorText = await threadResponse.text();
        console.error('OpenAI Thread Creation Error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to create thread',
          details: errorText
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const threadData = await threadResponse.json();
      threadId = threadData.id;
      console.log('Created new thread:', threadId);
      
      // Store thread creation time for 2-hour context window
      const threadCreatedAt = new Date().toISOString();
    }

    // EMERGENCY ESCAPE COMMANDS - Execute before AI classification
    const cleanMessage = message.toLowerCase().trim();
    
 

    // Handle reset confirmation responses
    const { data: resetState } = await supabase
          .from('conversation_state')
          .select('waiting_for')
          .eq('user_id', userId)
          .single();
        
    if (resetState?.waiting_for === 'reset_confirmation') {
      if (cleanMessage === 'yes') {
        // User confirmed reset - execute full reset
        console.log('RESET confirmed by user, executing full reset...');
          
          // Get current thread ID before deletion
          const { data: stateData } = await supabase
            .from('conversation_state')
            .select('thread_id')
            .eq('user_id', userId)
            .single();
          
          const currentThreadId = stateData?.thread_id;
          
          // Delete OpenAI thread if it exists
          if (currentThreadId) {
            try {
              const deleteResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                  'OpenAI-Beta': 'assistants=v2'
                }
              });
              
              if (deleteResponse.ok) {
                console.log('OpenAI thread deleted successfully:', currentThreadId);
              } else {
                console.log('OpenAI thread deletion failed, continuing with reset:', await deleteResponse.text());
              }
            } catch (threadError) {
              console.error('Error deleting OpenAI thread, continuing with reset:', threadError);
            }
          }
          
          // Reset conversation state instead of deleting
          await supabase
            .from('conversation_state')
            .update({
              current_state: 'normal',
              waiting_for: null,
              extracted_data: [],
              last_action: 'RESET_COMMAND',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
          // Create new OpenAI thread
          const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
              'Content-Type': 'application/json',
              'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({})
          });

          if (!threadResponse.ok) {
            const errorText = await threadResponse.text();
            console.error('Failed to create OpenAI thread:', errorText);
            throw new Error('Failed to create new thread');
          }

          const threadData = await threadResponse.json();
          const newThreadId = threadData.id;
          
          // Create new conversation state
          const { data: newState, error: insertError } = await supabase
            .from('conversation_state')
            .insert({
              user_id: userId,
              phone_number: phone_number,
              thread_id: newThreadId,
              current_state: 'normal',
              thread_created_at: new Date().toISOString(),
              last_action: 'RESET_COMMAND',
              last_action_timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (insertError) {
            throw insertError;
          }
          
          const resetResponse = 'Reset complete. What would you like to do?';
          
          // Send SMS response
          if (phone_number) {
            const smsResult = await sendSMS(phone_number, resetResponse, send_sms, phone_number);
            console.log('RESET SMS sent successfully:', smsResult);
          }
          
          console.log('RESET: Complete reset executed for user:', userId, 'with new thread:', newThreadId);
          
          return new Response(JSON.stringify({
            action: 'RESET',
            content: resetResponse,
            success: true,
            new_thread_id: newThreadId
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
        // User cancelled reset
        console.log('RESET cancelled by user');
        
          await supabase
            .from('conversation_state')
            .update({
            waiting_for: null,
            last_action: 'RESET_CANCELLED',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
        const cancelResponse = 'Reset cancelled.';
          
          // Send SMS response
          if (phone_number) {
          const smsResult = await sendSMS(phone_number, cancelResponse, send_sms, phone_number);
          console.log('RESET cancellation SMS sent successfully:', smsResult);
          }
          
          return new Response(JSON.stringify({
          action: 'RESET_CANCELLED',
          content: cancelResponse,
            success: true
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
    }

    // Get conversation context before adding message to thread
    let conversationContext = '';
    let userOnboardedStatus = false;
    let conversationStateData = null;
    
    // Add the user message to the thread with context and onboarded status
    const messageWithContext = conversationContext ? `${conversationContext}\nUser message: ${message}` : message;
    
    // Create a structured message object with onboarded status and host status
    const structuredMessage = {
      message: message,
      is_onboarded: userOnboardedStatus,
      is_host: is_host,
      context: conversationContext || ''
    };
    
    console.log('Structured message being sent to Assistant:', JSON.stringify(structuredMessage, null, 2));
    
  
  
    const addMessageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: JSON.stringify(structuredMessage)
      })
    });

    if (!addMessageResponse.ok) {
      const errorText = await addMessageResponse.text();
      console.error('Failed to add message to thread:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to add message to thread',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Run the assistant on the thread (without function calls for simplicity)
    const aiStartTime = Date.now();
    console.log(`🤖 [${Date.now() - startTime}ms] Starting AI assistant call`);
    
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        model: model // Override model at thread level as discussed
      })
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('OpenAI Run Error:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to run assistant',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const runData = await runResponse.json();
    const runId = runData.id;
    console.log('Started run:', runId);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    let runStatus = 'queued';

    while (runStatus === 'queued' || runStatus === 'in_progress') {
      if (attempts >= maxAttempts) {
        return new Response(JSON.stringify({
          error: 'Assistant run timed out'
        }), {
          status: 408,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;

      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        runStatus = statusData.status;
        console.log('Run status:', runStatus);
      }
    }

    if (runStatus === 'requires_action') {
      // Get the run details to see what function calls are needed
      const runDetailsResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (runDetailsResponse.ok) {
        const runDetails = await runDetailsResponse.json();
        console.log('Run details:', JSON.stringify(runDetails, null, 2));

        // Submit the function call results
        const submitResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            tool_outputs: runDetails.required_action.submit_tool_outputs.tool_calls.map((toolCall: any) => ({
              tool_call_id: toolCall.id,
              output: JSON.stringify({
                action: 'ONBOARDING_START',
                confidence: 0.95,
                extracted_params: { message: message }
              })
            }))
          })
        });

        if (submitResponse.ok) {
          // Wait for completion after submitting tool outputs
          let submitAttempts = 0;
          const maxSubmitAttempts = 30;
          let submitStatus = 'queued';

          while (submitStatus === 'queued' || submitStatus === 'in_progress') {
            if (submitAttempts >= maxSubmitAttempts) {
              return new Response(JSON.stringify({
                error: 'Assistant run timed out after tool submission'
              }), {
                status: 408,
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json'
                }
              });
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            submitAttempts++;

            const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
              headers: {
                'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            });

            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              submitStatus = statusData.status;
              console.log('Submit status:', submitStatus);
            }
          }

          if (submitStatus !== 'completed') {
            return new Response(JSON.stringify({
              error: 'Assistant run failed after tool submission',
              status: submitStatus
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
        }
      }
    } else if (runStatus !== 'completed') {
      return new Response(JSON.stringify({
        error: 'Assistant run failed',
        status: runStatus
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get the function call result
    console.log(`✅ [${Date.now() - startTime}ms] AI assistant completed, fetching response`);
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error('Failed to get messages:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to get assistant response'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const messagesData = await messagesResponse.json();
    console.log('Messages data:', JSON.stringify(messagesData, null, 2));


    // Extract the action from the assistant's response with enhanced parsing
    let action = 'INVALID';
    let confidence = 0.8; // Default confidence
    let extractedParams = {};
    let assistantResponse = '';
    let shouldSkipRest = false;
    let substep = undefined;

    if (messagesData.data && messagesData.data.length > 0) {
      const lastMessage = messagesData.data[0];
      if (lastMessage.content && lastMessage.content.length > 0) {
        const content = lastMessage.content[0];
        if (content.type === 'text' && content.text.value) {
          assistantResponse = content.text.value.trim();
          
          // Try to parse as structured JSON response first
          try {
            const parsedResponse = JSON.parse(assistantResponse);
            if (parsedResponse.action) {
              action = parsedResponse.action;
              extractedParams = parsedResponse.extractedParams || parsedResponse.extracted_data || {};
              // Extract subtype from top-level parsed response if present
              if (parsedResponse.subtype) {
                extractedParams.invalid_subtype = parsedResponse.subtype;
              }
              substep = parsedResponse.substep;
              confidence = 0.95; // Higher confidence for structured responses
              console.log('Parsed structured response:', { action, extractedParams, substep });
              
              // If we have a structured response, skip the rest of the logic
              if (action && (Object.keys(extractedParams).length > 0 || action === 'HELP')) {
                console.log('Using structured response, skipping keyword matching');
                // Skip to the end of the action extraction logic
                // Set a flag to skip the rest of the logic
                shouldSkipRest = true;
              } else {
                // Continue with the rest of the logic for simple actions
                console.log('Structured response but no extracted data, continuing with logic');
              }
            }
          } catch (e) {
            // Fall back to simple action word parsing
            const responseUpper = assistantResponse.toUpperCase();
            action = responseUpper; // Direct action word
            console.log('Parsed simple action:', action);
          }
      }
    }
    } // Close the else block for shouldSkipRest
    //Note Remove when we need to check limit 
    // Check usage limits before processing AI request


    // User profile lookup already done above

    // Update or create conversation state with thread_id using user_id
    // Skip updating conversation state for INVALID actions to preserve existing state

    // Usage tracking is now handled:
    // - AI usage: Only for AI interactions (not pattern matching) - handled above
    // - SMS usage: Inside sendSMS function for owner-based tracking

    // Log the interaction
    if (phone_number) {
      await supabase.from('sms_log').insert({
        phone_number: phone_number,
        message_body: message,
        direction: 'inbound',
        message_type: 'ai_classification',
        user_id: userId,
        intent_classification: {
          action: action,
          confidence: confidence,
          extracted_params: extractedParams,
          model_used: model,
          assistant_id: assistantId,
          thread_id: threadId
        }
      });
    }


    // Handle different action types
    
    if (action === 'UNKNOWN_MESSAGE') {
      // Handle UNKNOWN_MESSAGE action - check if user was just viewing crew members
      console.log('Processing UNKNOWN_MESSAGE action');
      
      // Check if user was just viewing crew members (CREW_MEMBERS_SHOWN in extracted_data)
      if (conversationStateData?.extracted_data && 
          conversationStateData.extracted_data.length > 0 && 
          conversationStateData.extracted_data[conversationStateData.extracted_data.length - 1]?.action === 'CREW_MEMBERS_SHOWN') {
        
        const crewInfo = conversationStateData.extracted_data[conversationStateData.extracted_data.length - 1];
        const crewName = crewInfo.crew_name;
        
        responseContent = `I didn't understand that. Type 'Add Members' to add people to ${crewName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
        shouldSendSMS = true;
      } else {
        // Generic unknown message response
        responseContent = `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
        shouldSendSMS = true;
      }
    } else if (action === 'INVALID') {
       if (conversationState?.waiting_for === 'post_crew_members_view') {
        console.log('User is in post_crew_members_view, providing contextual guidance');
        
        // Get crew name from extracted_data
        let crewName = 'your crew';
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CREW_MEMBERS_VIEWED' && item.crew_name) {
              crewName = item.crew_name;
              break;
            }
          }
        }
        
        responseContent = `I didn't understand that. Type 'Add Members' to add people to ${crewName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_management_menu') {
        console.log('User is in crew_management_menu, providing menu selection guidance');
        
        responseContent = `I didn't understand that. Reply with a number (1-9), or type 'exit'.`;
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (conversationState?.waiting_for === 'crew_selection_manage') {
        console.log('User is in crew_selection_manage, providing crew selection guidance');
        
        // Check if pagination is available by looking at extracted_data
        let hasPagination = false;
        let hasMore = false;
        let hasPrevious = false;
        const pageSize = 5;
        
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CHECK_CREW_MEMBERS' && item.crew_list) {
              const totalCrews = item.crew_list.length;
              const currentPage = item.current_page || 0;
              
              hasMore = totalCrews > (currentPage + 1) * pageSize;
              hasPrevious = currentPage > 0;
              hasPagination = hasMore || hasPrevious;
              break;
            }
          }
        }
        
        // Build error message with conditional pagination options
        let errorMsg = `I didn't understand that. Reply with a crew number`;
        if (hasPagination) {
          if (hasMore && hasPrevious) {
            errorMsg += `, 'Next' or 'N', 'Prev' or 'P'`;
          } else if (hasMore) {
            errorMsg += `, 'Next' or 'N'`;
          } else if (hasPrevious) {
            errorMsg += `, 'Prev' or 'P'`;
          }
        }
        errorMsg += `, 'Done' or 'D', 'Create Crew', or 'exit'.`;
        
        responseContent = errorMsg;
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (conversationState?.waiting_for === 'event_management_menu') {
        console.log('User is in event_management_menu, providing menu selection guidance');
        
        responseContent = `I didn't understand that. Reply with a number (1–5), or type 'exit'.`;
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID_UNCLEAR_COMMAND',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (conversationState?.waiting_for === 'manage_event_selection') {
        console.log('User is in manage_event_selection, providing event selection guidance');
        
        responseContent = `I didn't understand that. Reply with a number (1–5), 'Next' or 'N', 'Prev' or 'P', 'Done' or 'D', or 'exit'.`;
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        return new Response(JSON.stringify({
          success: true,
          action: 'INVALID_UNCLEAR_COMMAND',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // Handle INVALID action with subtype detection
      console.log('Processing INVALID action - analyzing subtype for appropriate response');
      
      const invalidSubtype = (extractedParams.invalid_subtype || 'unknown').toLowerCase();
      let response = '';
      
      // Check if user is in the middle of SEND_INVITATIONS workflow for context-aware error messages
      if (phone_number && userId) {
        const { data: conversationStateDataData } = await supabase
          .from('conversation_state')
          .select('current_state, extracted_data')
          .eq('user_id', userId)
          .single();
        
        if (conversationStateDataData?.current_state && conversationStateDataData.current_state.includes('send_invitations')) {
          // Determine current step for context-aware error messages
          let currentStep = 1;
          if (conversationStateDataData?.extracted_data && Array.isArray(conversationStateDataData.extracted_data)) {
            let hasCrew = false;
            let hasEventName = false;
            let hasEventDate = false;
            let hasEventTime = false;
            let hasEventLocation = false;
            
            for (let i = conversationStateDataData.extracted_data.length - 1; i >= 0; i--) {
              const item = conversationStateDataData.extracted_data[i];
              if (item.action === 'SEND_INVITATIONS_STEP_1' && item.crew_id) {
                hasCrew = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_2' && item.event_name) {
                hasEventName = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_3' && item.event_date) {
                hasEventDate = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_4' && item.event_time) {
                hasEventTime = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_5' && item.event_location) {
                hasEventLocation = true;
              }
            }
            
            if (hasEventLocation) {
              currentStep = 6; // Need confirmation
            } else if (hasEventTime) {
              currentStep = 5; // Need location
            } else if (hasEventDate) {
              currentStep = 4; // Need start time
            } else if (hasEventName) {
              currentStep = 3; // Need date
            } else if (hasCrew) {
              currentStep = 2; // Need event name
            } else {
              currentStep = 1; // Need crew selection
            }
          }
          
          // Provide context-specific error messages based on current step
          if (currentStep === 1) {
            response = 'I didn\'t understand that. Reply with a crew number, \'Create Crew\', or \'exit\' to do something else.';
          } else if (currentStep === 2) {
            response = 'I didn\'t understand that. What\'s the event name? Type \'exit\' to cancel.';
          } else if (currentStep === 3) {
            response = 'I didn\'t understand that. What\'s the date? Type \'exit\' to cancel.';
          } else if (currentStep === 4) {
            response = 'I didn\'t understand that. What\'s the start time? Type \'exit\' to cancel.';
          } else if (currentStep === 5) {
            response = 'I didn\'t understand that. What\'s the location? Type \'exit\' to cancel.';
          } else if (currentStep === 6) {
            response = 'I didn\'t understand that. Reply \'yes\' to send invites, \'no\' to make changes, or \'exit\' to cancel.';
          } else {
            response = 'I didn\'t understand that. Provide event details (name, date, time, location) or type \'exit\' to cancel.';
          }
        } else {
          // Use generic error messages for other workflows
      switch (invalidSubtype) {
        case 'off_topic':
          console.log('INVALID subtype: off_topic - weather, math, personal questions, general conversation');
          response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
          break;
        case 'inappropriate':
          console.log('INVALID subtype: inappropriate - profanity, offensive language, hostile messages');
          response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
          break;
        case 'gibberish':
        case 'invalid_gibberish':
          console.log('INVALID subtype: gibberish - random characters, repeated text, no letters');
          response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
          break;
        case 'unclear_command':
          console.log('INVALID subtype: unclear_command - partial Funlet terms without clear action');
          response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
          break;
        case 'unknown':
        default:
          console.log('INVALID subtype: unknown - everything else that doesn\'t fit above categories');
          response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
          break;
          }
        }
      } else {
        // Fallback for when no user context
        response = 'I didn\'t understand that. Try again or type \'menu\' to see what you can do.';
      }
      
      // Log invalid request for pattern analysis
      console.log(`INVALID request analysis:`, {
        message: message,
        invalidSubtype: invalidSubtype,
        response: response,
        timestamp: new Date().toISOString()
      });
      
      responseContent = response;
      shouldSendSMS = true;
    }
    } else if (action === 'INVALID_MEMBER_ADDING_MODE') {
      console.log('INVALID_MEMBER_ADDING_MODE detected via pattern matching');
      
      // Get crew info from conversation state
      let crewId = null;
      
      if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
        for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
          const item = conversationState.extracted_data[i];
          if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
            crewId = item.crew_id || item.executed_data?.crew_id;
            break;
          }
        }
      }
      
      if (crewId) {
        const joinLink = await getCrewJoinLink(supabase, crewId);
        responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
      } else {
        responseContent = `I didn't understand that. Add members like this: Tom 4155551234. You can also type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
      }
      shouldSendSMS = true;
      
      // Send SMS and return early to prevent AI handler from overwriting action
      await sendSMS(phone_number, responseContent, send_sms, phone_number);
      
      return new Response(JSON.stringify({
        success: true,
        action: 'INVALID_MEMBER_ADDING_MODE',
        response: responseContent,
        optimization: 'pattern_matching'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else if (action === 'INVALID_UNCLEAR_COMMAND') {
      console.log('INVALID_UNCLEAR_COMMAND detected, checking waiting_for state');
      
      // Check if user is in member_adding_mode, crew_member_addition, or contact_search_selection
      if (conversationState?.waiting_for === 'member_adding_mode' || conversationState?.waiting_for === 'crew_member_addition' || conversationState?.waiting_for === 'contact_search_selection') {
        console.log('User is in member adding mode, providing member addition guidance');
        
        // Get crew info from conversation state to include join link
        let crewId = null;
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CREW_SELECTED' || (item.executed_data && item.executed_data.action === 'CREW_CREATED')) {
              crewId = item.crew_id || item.executed_data?.crew_id;
              break;
            }
          }
        }
        
        if (crewId) {
          const joinLink = await getCrewJoinLink(supabase, crewId);
          responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\nShare link for people to add themselves: ${joinLink}\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
        } else {
          responseContent = `I didn't understand that. Add members by:\n- Name already in Funlet: Tom\n- Name and number for a new crew member: Tom 4155551234\n\nWhen ready, type 'Create Event', 'Sync Up', or 'exit'.`;
        }
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_selection_manage') {
        console.log('User is in crew_selection_manage, providing crew selection guidance');
        
        // Check if pagination is available by looking at extracted_data
        let hasPagination = false;
        let hasMore = false;
        let hasPrevious = false;
        const pageSize = 5;
        
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CHECK_CREW_MEMBERS' && item.crew_list) {
              const totalCrews = item.crew_list.length;
              const currentPage = item.current_page || 0;
              
              hasMore = totalCrews > (currentPage + 1) * pageSize;
              hasPrevious = currentPage > 0;
              hasPagination = hasMore || hasPrevious;
              break;
            }
          }
        }
        
        // Build error message with conditional pagination options
        let errorMsg = `I didn't understand that. Reply with a crew number`;
        if (hasPagination) {
          if (hasMore && hasPrevious) {
            errorMsg += `, 'Next' or 'N', 'Prev' or 'P'`;
          } else if (hasMore) {
            errorMsg += `, 'Next' or 'N'`;
          } else if (hasPrevious) {
            errorMsg += `, 'Prev' or 'P'`;
          }
        }
        errorMsg += `, 'Done' or 'D', 'Create Crew', or 'exit'.`;
        
        responseContent = errorMsg;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_selection_for_members') {
        console.log('User is in crew_selection_for_members, providing crew selection guidance');
        
        responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_selection_for_sync_up') {
        console.log('User is in crew_selection_for_sync_up, providing crew selection guidance');
        
        responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'post_crew_members_view') {
        console.log('User is in post_crew_members_view, providing contextual guidance');
        
        // Get crew name from extracted_data
        let crewName = 'your crew';
        if (conversationState?.extracted_data && Array.isArray(conversationState.extracted_data)) {
          for (let i = conversationState.extracted_data.length - 1; i >= 0; i--) {
            const item = conversationState.extracted_data[i];
            if (item.action === 'CREW_MEMBERS_VIEWED' && item.crew_name) {
              crewName = item.crew_name;
              break;
            }
          }
        }
        
        responseContent = `I didn't understand that. Type 'Add Members' to add people to ${crewName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_selection_for_check_members') {
        console.log('User is in crew_selection_for_check_members, providing crew selection guidance');
        
        responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'crew_selection_for_send_invitations') {
        console.log('User is in crew_selection_for_send_invitations, providing crew selection guidance');
        
        responseContent = `I didn't understand that. Reply with a crew number, "Create Crew", or "exit" to do something else.`;
        shouldSendSMS = true;
      } else if (conversationState?.waiting_for === 'edit_contact_selection') {
        console.log('User is in edit_contact_selection, providing contact selection guidance');
        
        responseContent = `I didn't understand that. Reply with a number or type 'exit'.`;
        shouldSendSMS = true;
      } else {
        // Default response for INVALID_UNCLEAR_COMMAND when not in specific state
        responseContent = `I didn't understand that. Try again or type 'menu' to see what you can do.`;
        shouldSendSMS = true;
      }
    } else if (action === 'MESSAGE_TOO_LONG') {
      console.log('MESSAGE_TOO_LONG detected via pattern matching, bypassing AI');
      
      responseContent = 'That message is too long. Try again or type \'menu\' to see what you can do.';
      shouldSendSMS = true;
      
      await sendSMS(phone_number, responseContent, send_sms, phone_number);
      
      return new Response(JSON.stringify({
        success: true,
        action: 'MESSAGE_TOO_LONG',
        response: responseContent,
        optimization: 'pattern_matching'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else if (action === 'EXIT') {
      console.log('EXIT action detected, returning user to idle state');
      
      // Clear conversation state to return to idle
      if (userId) {
        await supabase
          .from('conversation_state')
          .upsert({
            user_id: userId,
            current_state: 'idle',
            waiting_for: null,
            extracted_data: [],
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          });
      }
      
      responseContent = 'What would you like to do next?';
      shouldSendSMS = true;
    } else if (action === 'HELP') {
      console.log('HELP action detected, processing...');
      
      try {
        // Extract help message from assistant response
        let helpMessage = '';
        
        // Check if it's a structured response with help_message
        if (extractedParams.help_message) {
          helpMessage = extractedParams.help_message;
            } else {
          // Try to parse the assistant response as JSON to extract help_message
          try {
            const parsedResponse = JSON.parse(assistantResponse);
            if (parsedResponse.help_message) {
              helpMessage = parsedResponse.help_message;
          } else {
              // Fallback to the full assistant response if no help_message found
          helpMessage = assistantResponse;
            }
          } catch (parseError) {
            // If parsing fails, use the assistant response as is
            helpMessage = assistantResponse;
          }
        }
        
        console.log('Help message:', helpMessage);
        
        // Send the help message directly
        responseContent = helpMessage;
            shouldSendSMS = true;
        
        // Log help usage for analytics
        if (phone_number) {
          await supabase.from('help_usage_log').insert({
            user_id: userId,
            phone_number: phone_number,
            help_question: message,
            help_category: 'general',
            help_intent: 'help_request',
            response_provided: helpMessage,
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error('Error processing HELP action:', error);
        responseContent = 'I\'m here to help! Text "create crew" to start, "RSVPs" to check responses, or "help" for more options.';
        shouldSendSMS = true;
      }
        } else {
      responseContent = `Action: ${action} | Assistant Response: ${assistantResponse}`;
    }

    // Track AI usage after action extraction is complete (non-blocking)
    const inputText = messageWithContext;
    const outputText = assistantResponse;
    
    // Fire and forget - don't wait for the response
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/calculate-token-usage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: userId,
        phone_number: phone_number,
        assistant_id: assistantId,
        thread_id: threadId,
        model: model,
        input_text: inputText,
        output_text: outputText,
        action: action,
        metadata: {
          confidence: confidence,
          extracted_params: extractedParams,
          is_structured_response: Object.keys(extractedParams).length > 0
        }
      })
    }).then(response => {
      if (response.ok) {
        return response.json();
          } else {
        console.error('Failed to track AI usage:', response.status);
      }
    }).then(data => {
      if (data) {
        console.log('AI usage tracked:', data);
      }
    }).catch(error => {
      console.error('Error tracking AI usage:', error);
    });

    // Increment AI usage for substantive interactions only (before sending response)
    if (!skipUsageTracking && responseContent) {
      console.log('📊 Incrementing AI usage count');
      
      // Call increment-usage edge function (fire and forget)
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/increment-usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: phone_number,
          action_type: 'ai_interaction'
        })
      }).then(response => {
        if (response.ok) {
          return response.json();
        } else {
          console.error('Failed to increment AI usage:', response.status);
        }
      }).then(data => {
        if (data) {
          console.log('✅ AI usage incremented:', data);
        }
      }).catch(error => {
        console.error('Error incrementing AI usage:', error);
      });
    }

    // Send SMS for all responses that should be sent
    console.log('Final SMS check: shouldSendSMS =', shouldSendSMS, 'send_sms =', send_sms, 'phone_number =', phone_number, 'responseContent =', responseContent?.substring(0, 100) + '...');
    if (shouldSendSMS && phone_number && responseContent) {
      const smsResult = await sendSMS(phone_number, responseContent, send_sms, phone_number);
      console.log('SMS result:', smsResult);
      
      // Handle SMS limit exceeded
      if (smsResult && smsResult.success === false && smsResult.error === 'SMS_LIMIT_EXCEEDED') {
        const upgradeMessage = smsResult.limit_data?.upgrade_message || 
          "You're really making the most of Funlet! Upgrade for more fun: funlet.ai/upgrade";
        
        return new Response(JSON.stringify({
          success: true,
          action: 'SMS_LIMIT_REACHED',
          response: upgradeMessage,
          plan: smsResult.limit_data?.plan,
          usage: smsResult.limit_data?.usage,
          limits: smsResult.limit_data?.limits
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else {
      console.log('SMS not sent - shouldSendSMS:', shouldSendSMS, 'phone_number:', phone_number, 'responseContent exists:', !!responseContent);
    }

    // Log final timing
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [${totalTime}ms] Request completed successfully`);
    console.log(`⏱️  Total execution time: ${totalTime}ms`);

    // Return the final response
    return new Response(JSON.stringify({
      success: true,
      action: action,
      response: responseContent,
      confidence: confidence,
      extracted_params: extractedParams,
      model_used: model,
      assistant_id: assistantId,
      thread_id: threadId,
      assistant_response: assistantResponse,
      is_structured_response: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } else {
    console.log(`👥 Crew member detected, processing crew member logic...`);
    
    // Initialize response variables for crew members
    let responseContent = '';
    let shouldSendSMS = true; // Respect the send_sms parameter from request
    
    // Normalize phone number and create variations (used by all crew member workflows)
    const normalizedPhone = phone_number.replace(/\D/g, '');
    const phoneVariations = [normalizedPhone];
    
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      phoneVariations.push(normalizedPhone.substring(1));
    }
    if (normalizedPhone.length === 10) {
      phoneVariations.push('1' + normalizedPhone);
    }
    const plusVariations = phoneVariations.map(phone => '+' + phone);
    phoneVariations.push(...plusVariations);
    
    console.log(`📞 Phone variations for crew member:`, phoneVariations);
    
    // Find the contact by phone number (try all variations) - used by all workflows
    const { data: contactRows, error: contactError } = await supabase
      .from('contacts')
      .select('id, phone_number')
      .in('phone_number', phoneVariations);
    
    const contact = contactRows && contactRows.length > 0 ? contactRows[0] : null;
    const contactId = contact?.id || null;
    
    console.log(`📱 Contact lookup result:`, { contact, contactError, contactId });
    
    // Single query for conversation state (by phone, newest first)
    const { data: csRows, error: csErr } = await supabase
      .from('conversation_state')
      .select('user_id, waiting_for, extracted_data')
      .in('phone_number', phoneVariations)
      .order('created_at', { ascending: false })
      .limit(1);

    const conversationState = csRows?.[0] || null;
    console.log(`📋 Conversation state query result:`, { conversationState, csErr });

    // Check for sync up response pattern matching first
    const lowerMsg = message.trim().toLowerCase();
    
    // First check if there's an active sync up for this contact
    let syncUpId = null;
    if (contactId) {
      // Check conversation state by phone_number for sync_up_response (we can also check by user_id)
      if (conversationState && conversationState.waiting_for === 'sync_up_response') {
        console.log(`✅ Found conversation_state with sync_up_response, checking pending...`);
        
        // Get sync_up_id from conversation state extracted_data
        syncUpId = conversationState.extracted_data?.[0]?.sync_up_id;
      }
      
      // Fallback: If no sync_up_id from conversation_state, check sync_up_responses directly
      if (!syncUpId) {
        console.log(`⚠️ No sync_up_id in conversation_state, checking sync_up_responses directly...`);
        const { data: activeSyncUpResponse } = await supabase
          .from('sync_up_responses')
          .select('sync_up_id, sync_ups!inner(id, status)')
          .eq('contact_id', contactId)
          .in('sync_ups.status', ['active', 'sent'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (activeSyncUpResponse?.sync_up_id) {
          syncUpId = activeSyncUpResponse.sync_up_id;
          console.log(`✅ Found active sync_up from sync_up_responses: ${syncUpId}`);
        }
      }
    }
    
    // If there's an active sync up, process the response (valid or invalid)
    if (syncUpId) {
      console.log(`🔍 SYNC_UP_RESPONSE handler triggered for phone: ${phone_number}, sync_up_id: ${syncUpId}`);
      
      // Allow multiple options (1, 2, 3, 12, 23, 123, 1 2, 1 2 3, etc.) or "none" variations
      const isValidSyncUpReply = /^none(?:\s+of\s+(these|those|them))?$/.test(lowerMsg) || 
                                  lowerMsg.trim() === '0' || 
                                  /^[123\s,]+$/.test(lowerMsg);
      
      // If message doesn't match valid patterns, return invalid error
      if (!isValidSyncUpReply) {
        console.log(`❌ Invalid sync up response: "${message}"`);
        responseContent = `I didn't understand that. Reply with numbers (e.g. '1 2') or 'none'.`;
        shouldSendSMS = true;
        await sendSMS(phone_number, responseContent, send_sms, phone_number);
        
        return new Response(JSON.stringify({
          success: true,
          action: 'SYNC_UP_RESPONSE_INVALID',
          response: responseContent,
          optimization: 'pattern_matching'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
        
      // Check for sync-up response record for this contact and specific sync up
      // Only query if sync up is still active (not completed)
      const { data: syncUpResponse, error: responseError } = await supabase
        .from('sync_up_responses')
        .select(`
          sync_up_id, 
          option_ids, 
          response_type,
          sync_ups!inner(status)
        `)
        .eq('contact_id', contactId)
        .eq('sync_up_id', syncUpId)
        .in('sync_ups.status', ['active', 'sent'])
        .maybeSingle();
      
      // If no sync_up_response record exists yet, create one
      if (!syncUpResponse && contactId && syncUpId) {
        console.log(`📝 Creating sync_up_responses record for contact ${contactId} and sync_up ${syncUpId}`);
        const { error: createResponseError } = await supabase
          .from('sync_up_responses')
          .insert({
            contact_id: contactId,
            sync_up_id: syncUpId,
            option_ids: [],
            response_type: 'selected'
          });
        
        if (createResponseError) {
          console.error(`❌ Error creating sync_up_responses:`, createResponseError);
        }
      }

      console.log(`📝 sync_up_responses lookup:`, { syncUpResponse, responseError, contactId, syncUpId });
      
      // Process response even if sync_up_response record doesn't exist yet (we'll create/update it)
      if (syncUpId) {
        // Process sync up response
        console.log(`✅ Processing sync up response for contact ${contactId}, sync_up_id: ${syncUpId}`);
        
        // Get sync up options
        const { data: optionRows } = await supabase
          .from('sync_up_options')
          .select('id, idx, option_text')
          .eq('sync_up_id', syncUpId)
          .neq('idx', 0) // Exclude global None option
          .order('idx');
        
        if (optionRows && optionRows.length > 0) {
          const maxIdx = optionRows.length;
          let selectedIdxs: number[] = [];
          let isNone = false;
          
          // Check for "none" variations: "none", "none of these", "none of those", "none of them", "0"
          const nonePattern = /^none(?:\s+of\s+(these|those|them))?$/;
          if (nonePattern.test(lowerMsg) || lowerMsg.trim() === '0') {
            isNone = true;
          } else {
              // Extract all digits from the message (supports "1", "12", "1 2", "1, 2", etc.)
              // Since we only have max 3 options, we need to split concatenated numbers like "12" → [1,2], "123" → [1,2,3]
              const digitMatch = lowerMsg.match(/\d+/g);
              if (digitMatch && digitMatch.length > 0) {
                // Process each matched number sequence
                for (const numStr of digitMatch) {
                  const num = parseInt(numStr, 10);
                  
                  // If the number is 0, treat as none
                  if (num === 0) {
                    isNone = true;
                    break;
                  }
                  
                  // Since max options is 3, if the number has multiple digits and all are <= 3,
                  // split it into individual digits (e.g., "12" → [1,2], "123" → [1,2,3])
                  if (numStr.length > 1) {
                    // Split into individual digits and filter valid options (1-3)
                    const digits = numStr.split('').map(d => parseInt(d, 10)).filter(d => d >= 1 && d <= 3);
                    selectedIdxs.push(...digits);
                  } else {
                    // Single digit, add if valid (1-3)
                    if (num >= 1 && num <= 3) {
                      selectedIdxs.push(num);
                    }
                  }
                }
              }
              
              // Remove duplicates and sort
              selectedIdxs = Array.from(new Set(selectedIdxs)).sort((a,b)=>a-b);
              
            // Validate that we got at least one valid selection
            if (selectedIdxs.length === 0 && !isNone) {
              responseContent = `I didn't understand that. Reply with numbers (e.g. '1 2') or 'none'.`;
              shouldSendSMS = true;
              await sendSMS(phone_number, responseContent, send_sms, phone_number);
              
              return new Response(JSON.stringify({
                success: true,
                action: 'SYNC_UP_RESPONSE_INVALID',
                response: responseContent,
                optimization: 'pattern_matching'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
          
          // Validate selections
          if (!isNone && selectedIdxs.some(idx => idx < 1 || idx > maxIdx)) {
            responseContent = `I didn't understand that. Reply with numbers (e.g. '1 2') or 'none'.`;
            shouldSendSMS = true;
            await sendSMS(phone_number, responseContent, send_sms, phone_number);
            
            return new Response(JSON.stringify({
              success: true,
              action: 'SYNC_UP_RESPONSE_INVALID',
              response: responseContent,
              optimization: 'pattern_matching'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          // Record the response (multiple options in single row)
          const selectedOptionIds: string[] = [];
          if (!isNone) {
            for (const idx of selectedIdxs) {
              const option = optionRows.find(o => o.idx === idx);
              if (option) {
                selectedOptionIds.push(option.id);
              }
            }
          } else {
            // Map NONE selection to the global None option id (idx = 0)
            try {
              const { data: noneOption } = await supabase
                .from('sync_up_options')
                .select('id')
                .eq('idx', 0)
                .maybeSingle();
              if (noneOption?.id) {
                selectedOptionIds.push(noneOption.id);
              }
            } catch (_) {}
          }
          
          // Update or create the response with the selected options
          await supabase
            .from('sync_up_responses')
            .upsert({
              contact_id: contactId,
              sync_up_id: syncUpId,
              option_ids: selectedOptionIds, // Store all selected options (None mapped to global id)
              response_type: isNone ? 'none' : 'selected',
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'contact_id,sync_up_id'
            });
          
          // Clear conversation_state waiting_for to reset the crew member's state
          await supabase
            .from('conversation_state')
            .delete()
            .in('phone_number', phoneVariations);
          
          responseContent = 'Got it, thanks!';
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({ 
            success: true, 
            action: 'SYNC_UP_RESPONSE', 
            response: responseContent, 
            optimization: 'pattern_matching' 
          }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        } else {
          responseContent = 'No time options found for this sync up.';
          shouldSendSMS = true;
          await sendSMS(phone_number, responseContent, send_sms, phone_number);
          return new Response(JSON.stringify({
            success: true,
            action: 'SYNC_UP_RESPONSE_NO_OPTIONS',
            response: responseContent
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
    }
    
    // Load conversation state for RSVP flow (by phone) - normalize and pick latest relevant

    // If waiting to select an event for RSVP, handle numeric selection now
    if (conversationState?.waiting_for === 'event_select') {
      const numericMatch = message.trim().match(/^([1-9][0-9]*)$/);
      // Find event list from extracted_data
      const eventListItem = (conversationState.extracted_data || []).find((x: any) => x?.action === 'RSVP_EVENT_LIST');
      const eventList = eventListItem?.event_list || [];
      if (!numericMatch || eventList.length === 0) {
        // Re-prompt with the list
        let eventListMsg = 'You have multiple event invitations. Which one are you responding to?\n\n';
        eventList.forEach((e: any, index: number) => {
          eventListMsg += `${index + 1}. ${e.title}\n`;
        });
        eventListMsg += '\nReply with the number of your choice.';
        await sendSMS(phone_number, eventListMsg, send_sms, phone_number);
        return new Response(JSON.stringify({ success: true, action: 'RSVP_EVENT_SELECT_PROMPT', message: eventListMsg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const idx = parseInt(numericMatch[1], 10) - 1;
      if (idx < 0 || idx >= eventList.length) {
        let eventListMsg = 'Please choose a valid number from the list:\n\n';
        eventList.forEach((e: any, index: number) => {
          eventListMsg += `${index + 1}. ${e.title}\n`;
        });
        await sendSMS(phone_number, eventListMsg, send_sms, phone_number);
        return new Response(JSON.stringify({ success: true, action: 'RSVP_EVENT_SELECT_INVALID', message: eventListMsg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const selected = eventList[idx];
      // Update existing RSVP state for this phone
      try {
        const normalizedPhone = (phone_number || '').replace(/\D/g, '');
        console.log('DEBUG: Updating RSVP conversation state for phone:', normalizedPhone);

        const { data: updateResult, error: updateError } = await supabase
          .from('conversation_state')
          .update({
            waiting_for: 'rsvp',
            current_state: 'rsvp_flow',
            extracted_data: [
              ...(conversationState?.extracted_data || []).filter((x: any) => x?.action !== 'RSVP_SELECTED_INVITATION'),
              { action: 'RSVP_SELECTED_INVITATION', invitation_id: selected.id }
            ]
          })
          .eq('phone_number', normalizedPhone)
          .select('id');

        console.log('DEBUG: RSVP update result:', { updateResult, updateError });

        if (updateError) {
          console.error('DEBUG: Failed to update RSVP conversation state:', updateError);
        }
      } catch (error) {
        console.error('DEBUG: Exception in RSVP conversation state update:', error);
      }

      const prompt = 'Reply 1=Yes, 2=Maybe, 3=No';
      await sendSMS(phone_number, prompt, send_sms, phone_number);
      return new Response(JSON.stringify({ success: true, action: 'RSVP_CHOICE_PROMPT', message: prompt }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check for RSVP response pattern (in, out, maybe)
    const isRsvpResponse = /^(in|out|maybe|1|2|3)$/i.test(lowerMsg);
    
    if (isRsvpResponse) {
      console.log(`📝 RSVP response detected from crew member: ${lowerMsg}`);
      
      // Map response to status
      let rsvpStatus = '';
      if (lowerMsg === 'in' || lowerMsg === '1') {
        rsvpStatus = 'in';
      } else if (lowerMsg === 'out' || lowerMsg === '2') {
        rsvpStatus = 'out';
      } else if (lowerMsg === 'maybe' || lowerMsg === '3') {
        rsvpStatus = 'maybe';
      }
      
      // If we already have a selected invitation in state, use it directly
      if (conversationState?.waiting_for === 'rsvp') {
        const selItem = (conversationState.extracted_data || []).find((x: any) => x?.action === 'RSVP_SELECTED_INVITATION');
        const selectedInvitationId = selItem?.invitation_id;
        if (selectedInvitationId) {
          const { data: inv, error: invLoadErr } = await supabase
            .from('invitations')
            .select('id, event_id, status, events!inner(title, creator_id, shorten_calendar_url)')
            .eq('id', selectedInvitationId)
            .single();
          if (!invLoadErr && inv) {
            const { error: updateError } = await supabase
              .from('invitations')
              .update({
                response_note: rsvpStatus,
                responded_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', selectedInvitationId);
            if (!updateError) {
              // Clear conversation state for this phone (normalize variations)
              try {
                const normalizedPhone = (phone_number || '').replace(/\D/g, '');
                const phoneVariations = [normalizedPhone];
                if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
                  phoneVariations.push(normalizedPhone.substring(1));
                }
                await supabase.from('conversation_state').delete().in('phone_number', phoneVariations);
              } catch (_) {}
              const calendarLink = inv.events.shorten_calendar_url ? `\nAdd to calendar: ${inv.events.shorten_calendar_url}` : '';
              const confirmationMsg = rsvpStatus === 'in'
                ? `Great! You're in for ${inv.events.title}! 🎉${calendarLink}`
                : rsvpStatus === 'out'
                ? `Got it, you're out for ${inv.events.title}. Maybe next time!`
                : `Noted! You're a maybe for ${inv.events.title}. Let us know when you decide!${calendarLink}`;
              await sendSMS(phone_number, confirmationMsg, send_sms, phone_number);
              return new Response(JSON.stringify({
                success: true,
                action: 'RSVP_RESPONSE',
                rsvp_status: rsvpStatus,
                event_title: inv.events.title,
                message: confirmationMsg
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
          }
        }
        // If anything fails, fall through to original lookup logic
      }
      
      console.log(`🔍 Looking for invitation using contact_id:`, contactId);
      
      if (!contactId) {
        console.log(`❌ No contact found, cannot look up invitation`);
        return new Response(JSON.stringify({
          success: true,
          action: 'RSVP_RESPONSE_NO_CONTACT',
          message: 'No contact record found. Please ask the host to add you to their crew first.'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Find the invitation for this contact
      const { data: invitations, error: invError } = await supabase
        .from('invitations')
        .select('id, event_id, status, events!inner(title, creator_id, shorten_calendar_url)')
        .eq('contact_id', contactId)
        .eq('events.status', 'active')
        .eq('response_note', 'no_response')
        .order('created_at', { ascending: false });
      
      if (invError) {
        console.error(`❌ Error finding invitation:`, invError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to find invitation'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      if (!invitations || invitations.length === 0) {
        console.log(`❌ No active invitations found for phone: ${phone_number}`);
        return new Response(JSON.stringify({
          success: true,
          action: 'RSVP_RESPONSE_NO_INVITATION',
          message: 'No active event invitations found. Please ask the host to send you an invitation.'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // If multiple invitations, prompt for event selection and set conversation state
      if (invitations.length > 1) {
        const eventList = invitations.map(inv => ({ id: inv.id, title: inv.events.title }));
        let eventListMsg = 'You have multiple event invitations. Which one are you responding to?\n\n';
        eventList.forEach((e, index) => {
          eventListMsg += `${index + 1}. ${e.title}\n`;
        });
        eventListMsg += '\nReply with the number of your choice.';

        // Insert new state for this phone only if empty
        try {
          const normalizedPhone = (phone_number || '').replace(/\D/g, '');
          console.log('DEBUG: Checking if conversation state exists for phone:', normalizedPhone);

          // Check if state already exists
          const { data: existingState } = await supabase
            .from('conversation_state')
            .select('id')
            .eq('phone_number', normalizedPhone)
            .limit(1);

          if (!existingState || existingState.length === 0) {
            console.log('DEBUG: No existing state found, inserting new conversation state');

            const { data: insertResult, error: insertError } = await supabase
              .from('conversation_state')
              .insert({
                user_id: null,
                phone_number: normalizedPhone,
                waiting_for: 'event_select',
                current_state: 'rsvp_flow',
                extracted_data: [ { action: 'RSVP_EVENT_LIST', event_list: eventList } ]
              })
              .select('id');

            console.log('DEBUG: Insert result:', { insertResult, insertError });

            if (insertError) {
              console.error('DEBUG: Failed to insert conversation state:', insertError);
              // Return error response to debug
              return new Response(JSON.stringify({
                success: false,
                error: 'Failed to save conversation state',
                details: insertError.message,
                phone: normalizedPhone
              }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else {
            console.log('DEBUG: Conversation state already exists for phone, skipping insert');
          }
        } catch (error) {
          console.error('DEBUG: Exception in conversation state insert:', error);
        }

        await sendSMS(phone_number, eventListMsg, send_sms, phone_number);
        return new Response(JSON.stringify({ success: true, action: 'RSVP_EVENT_SELECT_PROMPT', message: eventListMsg, event_count: invitations.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // Use the most recent invitation
      const invitation = invitations[0];
      console.log(`✅ Found invitation: ${invitation.id} for event: ${invitation.events.title}`);
      
      // Update the invitation with response (only response_note and responded_at, NOT status)
      const { error: updateError } = await supabase
        .from('invitations')
        .update({
          response_note: rsvpStatus,
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', invitation.id);
      
      if (updateError) {
        console.error(`❌ Error updating invitation:`, updateError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to update RSVP'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      console.log(`✅ Invitation updated successfully with response: ${rsvpStatus}`);
      
      // Send confirmation SMS
      const calendarLink = invitation.events.shorten_calendar_url ? `\nAdd to calendar: ${invitation.events.shorten_calendar_url}` : '';
      let confirmationMsg = '';
      if (rsvpStatus === 'in') {
        confirmationMsg = `Great! You're in for ${invitation.events.title}! 🎉${calendarLink}`;
      } else if (rsvpStatus === 'out') {
        confirmationMsg = `Got it, you're out for ${invitation.events.title}. Maybe next time!`;
      } else if (rsvpStatus === 'maybe') {
        confirmationMsg = `Noted! You're a maybe for ${invitation.events.title}. Let us know when you decide!${calendarLink}`;
      }
      
      await sendSMS(phone_number, confirmationMsg, send_sms, phone_number);
      
      return new Response(JSON.stringify({
        success: true,
        action: 'RSVP_RESPONSE',
        rsvp_status: rsvpStatus,
        event_title: invitation.events.title,
        message: confirmationMsg
      }), {
      headers: {
          ...corsHeaders,
        'Content-Type': 'application/json'
        }
      });
    }
    
    // If not a sync up response or RSVP response, return a generic crew member message
    console.log(`🤖 Crew member message not recognized`);
    
    return new Response(JSON.stringify({
      success: true,
      action: 'CREW_MEMBER_MESSAGE',
      message: 'Crew member message received. Please respond to event invitations or sync up requests.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  } catch (error) {
    console.error(`❌ [${Date.now() - startTime}ms] SMS Handler Error:`, error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});