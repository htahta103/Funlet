/**
 * Auto Sync Module
 * 
 * Handles all Auto Sync functionality including:
 * - Pattern matching for Auto Sync commands
 * - Setup and configuration workflows
 * - Execution and state management
 * - Invitee response handling
 * - Auto Sync management (check, reminder, send invites, stop)
 */

import { sendSMS } from './sms.ts';
import { logWorkflowStart, logWorkflowProgress, logWorkflowComplete, logWorkflowError } from './logger.ts';
import { hasValidCalendarConnection, CalendarEvent, checkTimeSlotAvailability, getUserCalendarEvents, getUserCalendarTimezone } from './google_calendar.ts';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type AutoSyncStatus = 'running' | 'paused' | 'stopped' | 'completed';
export type ResponseGoal = 'everyone' | 'critical_mass';
export type MessageType = 'initial' | 'reminder';
export type ResponseType = 'available' | 'not_available';

export interface AutoSyncRecord {
  id: string;
  organizer_id: string;
  crew_id: string;
  event_name: string;
  event_location: string | null;
  status: AutoSyncStatus;
  response_goal: ResponseGoal;
  timezone: string;
  calendar_connected: boolean;
  created_at: string;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  last_reminder_sent_at: string | null;
  metadata: any;
}

export interface AutoSyncOption {
  id: string;
  auto_sync_id: string;
  idx: number;
  start_time: string;
  end_time: string | null;
  timezone: string;
  created_at: string;
}

export interface ResponseStats {
  total: number;
  responded: number;
  available: number;
  not_available: number;
  no_response: number;
}

// ============================================================================
// PATTERN MATCHING FUNCTIONS
// ============================================================================

/**
 * Check if message matches "auto sync" or "auto sync [crew name]" pattern
 * Note: Excludes "check" and other commands that should be handled separately
 */
export function checkAutoSyncPattern(message: string): { isMatch: boolean, crewName: string | null } {
  const normalizedMessage = message.toLowerCase().trim();
  const originalMessage = message.trim();
  
  // Exclude commands that should be handled by other patterns
  const excludedCommands = ['check', 'stop', 'cancel'];
  const normalizedLower = normalizedMessage.toLowerCase();
  
  // Check if message contains excluded commands
  for (const cmd of excludedCommands) {
    if (normalizedLower.includes(`auto sync ${cmd}`) || normalizedLower.includes(`autosync ${cmd}`)) {
      return { isMatch: false, crewName: null };
    }
  }
  
  const autoSyncPatterns = [
    // With crew name (but not commands)
    /^auto\s+sync\s+(.+)$/i,
    /^auto\s+sync\s+the\s+(.+)\s+crew$/i,
    
    // Simple patterns
    /^auto\s+sync$/i,
    /^autosync$/i,
  ];
  
  for (const pattern of autoSyncPatterns) {
    const match = normalizedMessage.match(pattern);
    if (match) {
      const hasCrewName = pattern.source.includes('(.+)');
      const crewName = hasCrewName && match[1] ? match[1].trim() : null;
      
      // Double-check: if crewName is an excluded command, don't match
      if (crewName && excludedCommands.includes(crewName.toLowerCase())) {
        continue;
      }
      
      return {
        isMatch: true,
        crewName: crewName
      };
    }
  }
  
  return { isMatch: false, crewName: null };
}

/**
 * Check if message matches "auto sync check" pattern
 */
export function checkAutoSyncCheckPattern(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  
  const patterns = [
    /^auto\s+sync\s+check$/i,
    /^autosync\s+check$/i,
    /^check\s+auto\s+sync$/i,
    /^check\s+autosync$/i,
  ];
  
  return patterns.some(pattern => pattern.test(normalizedMessage));
}

/**
 * Check if message matches "stop auto sync" or "stop" pattern
 * Note: "stop" is context-dependent (only in paused/stop confirmation state)
 */
export function checkAutoSyncStopPattern(message: string, currentState?: any): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Always match explicit "stop auto sync"
  const explicitPatterns = [
    /^stop\s+auto\s+sync$/i,
    /^stop\s+autosync$/i,
    /^cancel\s+auto\s+sync$/i,
  ];
  
  if (explicitPatterns.some(pattern => pattern.test(normalizedMessage))) {
    return true;
  }
  
  // Match "stop" only in relevant conversation states
  if (normalizedMessage === 'stop' || normalizedMessage === 'cancel') {
    if (currentState?.waiting_for === 'auto_sync_stop_confirmation' ||
        currentState?.waiting_for === 'auto_sync_paused_menu') {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if message matches reminder pattern ("1" in paused state)
 */
export function checkAutoSyncReminderPattern(message: string, currentState?: any): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Match "1" only in paused menu state
  if (normalizedMessage === '1' && currentState?.waiting_for === 'auto_sync_paused_menu') {
    return true;
  }
  
  return false;
}

/**
 * Check if message matches send invites pattern ("2" in paused state, or "send invites")
 */
export function checkAutoSyncSendInvitesPattern(message: string, currentState?: any): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Explicit "send invites" pattern
  const explicitPatterns = [
    /^send\s+invites?$/i,
    /^send\s+invitations?$/i,
  ];
  
  if (explicitPatterns.some(pattern => pattern.test(normalizedMessage))) {
    return true;
  }
  
  // Match "2" in paused menu state
  if (normalizedMessage === '2' && currentState?.waiting_for === 'auto_sync_paused_menu') {
    return true;
  }
  
  return false;
}

/**
 * Check if message is an invitee response (numbers or "none")
 * Used to identify invitee replies to Auto Sync messages
 */
export function checkAutoSyncResponsePattern(message: string): { isMatch: boolean, isNone: boolean, numbers: number[] } {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Check for "none" variations
  const nonePatterns = ['none', 'nothing', 'no', "nope", "nah", "can't", "cant", "unavailable"];
  if (nonePatterns.includes(normalizedMessage)) {
    return { isMatch: true, isNone: true, numbers: [] };
  }
  
  // Extract all numbers from message (e.g., "1", "2", "12", "1 2", "1,2", "123")
  const numberMatches = normalizedMessage.match(/\d/g);
  if (numberMatches && numberMatches.length > 0) {
    const numbers = numberMatches.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 3);
    if (numbers.length > 0) {
      return { isMatch: true, isNone: false, numbers };
    }
  }
  
  return { isMatch: false, isNone: false, numbers: [] };
}

// ============================================================================
// HELPER FUNCTIONS - Message Formatting
// ============================================================================

/**
 * Normalize timezone input to IANA timezone format
 * Only accepts numbers (1-6) or abbreviations (PT/MT/CT/ET/AKT/HT)
 * Returns IANA format (e.g., 'America/Los_Angeles')
 */
export function normalizeTimezone(input: string): string {
  const normalized = input.trim().toUpperCase();
  
  // Map numbers to abbreviations first
  const numberToAbbr: { [key: string]: string } = {
    '1': 'PT',
    '2': 'MT',
    '3': 'CT',
    '4': 'ET',
    '5': 'AKT',
    '6': 'HT'
  };
  
  // If input is a number (1-6), convert to abbreviation
  const abbr = numberToAbbr[normalized] || normalized;
  
  // Map abbreviations to IANA timezones
  const abbrToIANA: { [key: string]: string } = {
    'PT': 'America/Los_Angeles',
    'MT': 'America/Denver',
    'CT': 'America/Chicago',
    'ET': 'America/New_York',
    'AKT': 'America/Anchorage',
    'HT': 'Pacific/Honolulu'
  };
  
  // If input is an abbreviation, convert to IANA
  if (abbrToIANA[abbr]) {
    return abbrToIANA[abbr];
  }
  
  // If we can't match, return input as-is (let it fail validation later)
  return input.trim();
}

/**
 * Get timezone abbreviation from IANA timezone format
 * Returns common abbreviations (PT/MT/CT/ET/AKT/HT) or formatted string
 */
export function getTimezoneAbbreviation(ianaTimezone: string): string {
  const ianaToAbbr: { [key: string]: string } = {
    'America/Los_Angeles': 'PT',
    'America/Denver': 'MT',
    'America/Chicago': 'CT',
    'America/New_York': 'ET',
    'America/Anchorage': 'AKT',
    'Pacific/Honolulu': 'HT'
  };
  
  // Return abbreviation if we have a mapping
  if (ianaToAbbr[ianaTimezone]) {
    return ianaToAbbr[ianaTimezone];
  }
  
  // Fallback: extract from IANA format (e.g., 'America/Los_Angeles' -> 'Los Angeles')
  return ianaTimezone.split('/').pop()?.replace(/_/g, ' ') || ianaTimezone;
}

/**
 * Format time options for invitee messages with timezone
 */
export function formatTimeOptionsForInvitee(options: AutoSyncOption[], timezone: string): string {
  const formattedOptions: string[] = [];
  
  for (const option of options.sort((a, b) => a.idx - b.idx)) {
    const start = new Date(option.start_time);
    const end = option.end_time ? new Date(option.end_time) : null;
    
    // Format day and date
    const dayName = start.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    // Format time with timezone
    const formatTime = (date: Date) => {
      let hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      const minutesStr = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`;
      return `${hours}${minutesStr} ${ampm}`;
    };
    
    let timeText: string;
    if (end) {
      const startTime = formatTime(start);
      const endTime = formatTime(end);
      timeText = `${startTime}–${endTime}`;
    } else {
      timeText = formatTime(start);
    }
    
    // Get timezone abbreviation using proper lookup
    const tzAbbr = getTimezoneAbbreviation(timezone);
    
    formattedOptions.push(`${option.idx}. ${dayName}, ${monthDay} at ${timeText} ${tzAbbr}`);
  }
  
  return formattedOptions.join('\n');
}

/**
 * Format invitee availability message
 */
export function formatInviteeAvailabilityMessage(
  organizerName: string,
  eventName: string,
  options: AutoSyncOption[],
  timezone: string
): string {
  const header = `${organizerName} is finding a time for ${eventName}.`;
  const optionsText = formatTimeOptionsForInvitee(options, timezone);
  const body = `Which of these work for you?\n${optionsText}\nReply with the number(s) that work, or none if nothing works.`;
  
  return `${header}\n\n${body}`;
}

/**
 * Format paused state summary message
 */
export function formatPausedStateSummary(
  eventName: string,
  stats: ResponseStats
): string {
  return `Auto Sync paused for ${eventName}. Responses so far (${stats.responded}/${stats.total}):
Available: ${stats.available}
Not available: ${stats.not_available}
No response: ${stats.no_response}`;
}

/**
 * Format Auto Sync status for display
 */
export function formatAutoSyncStatus(eventName: string, status: AutoSyncStatus, stats: ResponseStats): string {
  const statusText = status === 'running' ? 'Running' : 'Paused';
  return `${eventName} — ${statusText} — ${stats.responded}/${stats.total}`;
}

// ============================================================================
// HELPER FUNCTIONS - Data Processing
// ============================================================================

/**
 * Calculate response statistics for an Auto Sync
 */
export async function calculateResponseStats(
  supabase: any,
  autoSyncId: string
): Promise<ResponseStats> {
  // Get all crew members (contacts) for this Auto Sync's crew
  const { data: autoSync } = await supabase
    .from('auto_syncs')
    .select('crew_id')
    .eq('id', autoSyncId)
    .single();
  
  if (!autoSync) {
    return { total: 0, responded: 0, available: 0, not_available: 0, no_response: 0 };
  }
  
  // Get all crew members
  const { data: crewMembers } = await supabase
    .from('crew_members')
    .select('contact_id')
    .eq('crew_id', autoSync.crew_id);
  
  const total = crewMembers?.length || 0;
  
  // Get all responses
  const { data: responses } = await supabase
    .from('auto_sync_responses')
    .select('response_type, option_ids')
    .eq('auto_sync_id', autoSyncId);
  
  const responded = responses?.length || 0;
  const available = responses?.filter(r => r.response_type === 'available' && r.option_ids.length > 0).length || 0;
  const not_available = responses?.filter(r => r.response_type === 'not_available' || r.option_ids.length === 0).length || 0;
  const no_response = total - responded;
  
  return { total, responded, available, not_available, no_response };
}

/**
 * Get most recent unresolved message for a contact
 * Used for binding invitee replies to the correct Auto Sync message
 */
export async function getMostRecentUnresolvedMessage(
  supabase: any,
  contactId: string
): Promise<{ auto_sync_id: string, message_id: string } | null> {
  const { data: messages } = await supabase
    .from('auto_sync_messages')
    .select('id, auto_sync_id')
    .eq('contact_id', contactId)
    .eq('is_resolved', false)
    .order('sent_at', { ascending: false })
    .limit(1);
  
  if (messages && messages.length > 0) {
    return {
      auto_sync_id: messages[0].auto_sync_id,
      message_id: messages[0].id
    };
  }
  
  return null;
}

/**
 * Check if all time options have passed (based on end_time)
 */
export async function checkAllOptionsPassed(
  supabase: any,
  autoSyncId: string
): Promise<boolean> {
  const { data: options } = await supabase
    .from('auto_sync_options')
    .select('end_time, start_time')
    .eq('auto_sync_id', autoSyncId);
  
  if (!options || options.length === 0) {
    return false;
  }
  
  const now = new Date();
  
  // Check if all options have passed
  // Use end_time if available, otherwise use start_time
  return options.every(option => {
    const endTime = option.end_time ? new Date(option.end_time) : new Date(option.start_time);
    return endTime < now;
  });
}

/**
 * Parse invitee response (extract numbers or detect "none")
 * Reuses logic from sync_up response handling
 */
export function parseAutoSyncResponse(message: string): { isValid: boolean, isNone: boolean, optionIdxs: number[] } {
  const normalizedMessage = message.toLowerCase().trim();
  
  // Check for "none" variations
  const nonePatterns = ['none', 'nothing', 'no', "nope", "nah", "can't", "cant", "unavailable"];
  if (nonePatterns.includes(normalizedMessage)) {
    return { isValid: true, isNone: true, optionIdxs: [] };
  }
  
  // Extract all numbers (1-3)
  const numberMatches = normalizedMessage.match(/\d/g);
  if (numberMatches && numberMatches.length > 0) {
    const numbers = numberMatches.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 3);
    // Remove duplicates and sort
    const uniqueNumbers = [...new Set(numbers)].sort();
    if (uniqueNumbers.length > 0) {
      return { isValid: true, isNone: false, optionIdxs: uniqueNumbers };
    }
  }
  
  return { isValid: false, isNone: false, optionIdxs: [] };
}

// ============================================================================
// HELPER FUNCTIONS - Database Operations
// ============================================================================

/**
 * Create auto_syncs record
 */
export async function createAutoSyncRecord(
  supabase: any,
  organizerId: string,
  crewId: string,
  eventName: string,
  responseGoal: ResponseGoal,
  timezone: string,
  calendarConnected: boolean,
  metadata?: any,
  eventLocation?: string | null
): Promise<{ id: string } | null> {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('auto_syncs')
    .insert({
      organizer_id: organizerId,
      crew_id: crewId,
      event_name: eventName,
      event_location: eventLocation || null,
      status: 'running',
      response_goal: responseGoal,
      timezone: timezone,
      calendar_connected: calendarConnected,
      started_at: now,
      metadata: metadata || {}
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating auto_syncs record:', error);
    return null;
  }
  
  return data;
}

/**
 * Create auto_sync_options records (1-3 options)
 */
export async function createAutoSyncOptions(
  supabase: any,
  autoSyncId: string,
  options: Array<{ idx: number, start_time: string, end_time: string | null, timezone: string }>
): Promise<boolean> {
  const records = options.map(opt => ({
    auto_sync_id: autoSyncId,
    idx: opt.idx,
    start_time: opt.start_time,
    end_time: opt.end_time,
    timezone: opt.timezone
  }));
  
  const { error } = await supabase
    .from('auto_sync_options')
    .insert(records);
  
  if (error) {
    console.error('Error creating auto_sync_options records:', error);
    return false;
  }
  
  return true;
}

/**
 * Create auto_sync_messages records for all invitees
 */
export async function createAutoSyncMessages(
  supabase: any,
  autoSyncId: string,
  contactIds: string[],
  messageType: MessageType
): Promise<boolean> {
  const records = contactIds.map(contactId => ({
    auto_sync_id: autoSyncId,
    contact_id: contactId,
    message_type: messageType,
    is_resolved: false
  }));
  
  const { error } = await supabase
    .from('auto_sync_messages')
    .insert(records);
  
  if (error) {
    console.error('Error creating auto_sync_messages records:', error);
    return false;
  }
  
  return true;
}

/**
 * Update or create auto_sync_responses record (last reply wins)
 */
export async function updateAutoSyncResponse(
  supabase: any,
  autoSyncId: string,
  contactId: string,
  optionIds: string[],
  responseType: ResponseType
): Promise<boolean> {
  const now = new Date().toISOString();
  
  const { error } = await supabase
    .from('auto_sync_responses')
    .upsert({
      auto_sync_id: autoSyncId,
      contact_id: contactId,
      option_ids: optionIds,
      response_type: responseType,
      updated_at: now
    }, {
      onConflict: 'auto_sync_id,contact_id'
    });
  
  if (error) {
    console.error('Error updating auto_sync_responses:', error);
    return false;
  }
  
  return true;
}

/**
 * Get active Auto Syncs (running or paused) for an organizer
 */
export async function getActiveAutoSyncs(
  supabase: any,
  organizerId: string
): Promise<AutoSyncRecord[]> {
  const { data, error } = await supabase
    .from('auto_syncs')
    .select('*')
    .eq('organizer_id', organizerId)
    .in('status', ['running', 'paused'])
    .order('started_at', { ascending: false });
  
  if (error) {
    console.error('Error getting active auto syncs:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Get Auto Sync with response statistics
 */
export async function getAutoSyncWithStats(
  supabase: any,
  autoSyncId: string
): Promise<{ autoSync: AutoSyncRecord | null, stats: ResponseStats }> {
  const { data: autoSync, error } = await supabase
    .from('auto_syncs')
    .select('*')
    .eq('id', autoSyncId)
    .single();
  
  if (error || !autoSync) {
    return { autoSync: null, stats: { total: 0, responded: 0, available: 0, not_available: 0, no_response: 0 } };
  }
  
  const stats = await calculateResponseStats(supabase, autoSyncId);
  
  return { autoSync, stats };
}

// ============================================================================
// ACTION HANDLERS - Phase 1: Setup
// ============================================================================

/**
 * Handle Auto Sync entry - crew selection
 */
export async function handleAutoSyncEntry(
  supabase: any,
  userId: string,
  phoneNumber: string,
  crewName: string | null
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    logWorkflowStart({
      supabase,
      userId,
      workflowName: 'auto_sync',
      workflowStep: 'initiated'
    });
    
    // If crew name provided, try to find it
    if (crewName) {
      const { data: userCrews } = await supabase
        .from('crews')
        .select('id, name')
        .eq('creator_id', userId)
        .order('name');
      
      if (userCrews && userCrews.length > 0) {
        const targetCrew = userCrews.find(crew => 
          crew.name.toLowerCase() === crewName.toLowerCase()
        );
        
        if (targetCrew) {
          // Crew found, proceed to event name
          const conversationState = {
            waiting_for: 'auto_sync_event_name',
            current_state: 'auto_sync_setup',
            extracted_data: [{
              action: 'AUTO_SYNC',
              crew_id: targetCrew.id,
              crew_name: targetCrew.name
            }]
          };
          
          return {
            response: "Event name?",
            shouldSendSMS: true,
            conversationState
          };
        } else {
          // Crew not found
          return {
            response: "I couldn't find that crew. Try again, text create crew to make a new one, or exit.",
            shouldSendSMS: true
          };
        }
      }
    }
    
    // No crew name or need to show crew list
    const { data: userCrews } = await supabase
      .from('crews')
      .select('id, name')
      .eq('creator_id', userId)
      .order('name');
    
    if (!userCrews || userCrews.length === 0) {
      return {
        response: "You don't have any crews yet. Text create crew to get started.",
        shouldSendSMS: true
      };
    }
    
    // Show crew selection menu
    const crewList = userCrews.map((crew, idx) => `${idx + 1}. ${crew.name}`).join('\n');
    const conversationState = {
      waiting_for: 'auto_sync_crew_selection',
      current_state: 'auto_sync_setup',
      extracted_data: [{
        action: 'AUTO_SYNC',
        available_crews: userCrews
      }]
    };
    
    return {
      response: `Which crew?\n${crewList}`,
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleAutoSyncEntry:', error);
    logWorkflowError({
      supabase,
      userId,
      workflowName: 'auto_sync',
      workflowStep: 'entry_error',
      errorDetails: { error: error.message || String(error) }
    });
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle event name collection
 */
export async function handleAutoSyncEventName(
  supabase: any,
  userId: string,
  phoneNumber: string,
  eventName: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    if (!eventName || eventName.trim().length === 0) {
      return {
        response: "Please add an event name.",
        shouldSendSMS: true
      };
    }
    
    // Check calendar connection using google_calendar helper
    const calendarConnected = await hasValidCalendarConnection(supabase, userId);
    
    const crewId = currentState?.extracted_data?.[0]?.crew_id;
    if (!crewId) {
      return {
        response: 'Crew not found. Please start over.',
        shouldSendSMS: true
      };
    }
    
    const conversationState = {
      waiting_for: 'auto_sync_event_location',
      current_state: 'auto_sync_configuration',
      extracted_data: [{
        action: 'AUTO_SYNC',
        crew_id: crewId,
        event_name: eventName.trim(),
        calendar_connected: calendarConnected
      }]
    };
    
    return {
      response: "Event location? (or reply 'skip' to leave blank)",
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleAutoSyncEventName:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle event location collection
 */
export async function handleAutoSyncEventLocation(
  supabase: any,
  userId: string,
  phoneNumber: string,
  eventLocation: string | null,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const crewId = currentState?.extracted_data?.[0]?.crew_id;
    const eventName = currentState?.extracted_data?.[0]?.event_name;
    const calendarConnected = currentState?.extracted_data?.[0]?.calendar_connected;
    
    if (!crewId || !eventName) {
      return {
        response: 'Missing information. Please start over.',
        shouldSendSMS: true
      };
    }
    
    // Normalize location - allow skip/done
    let finalLocation: string | null = null;
    if (eventLocation && eventLocation.trim().toLowerCase() !== 'skip' && eventLocation.trim().toLowerCase() !== 'done') {
      finalLocation = eventLocation.trim();
    }
    
    const conversationState = {
      waiting_for: calendarConnected ? 'auto_sync_time_definition_calendar' : 'auto_sync_time_definition',
      current_state: 'auto_sync_configuration',
      extracted_data: [{
        action: 'AUTO_SYNC',
        crew_id: crewId,
        event_name: eventName,
        event_location: finalLocation,
        calendar_connected: calendarConnected
      }]
    };
    
    if (calendarConnected) {
      return {
        response: "What time window works for you? (e.g., 'next week evenings' or 'weekend mornings')",
        shouldSendSMS: true,
        conversationState
      };
    } else {
      return {
        response: "What times work? Send 1-3 options (e.g., 'Thu 12/19, 6-8pm, Sat 12/21, 10am-12pm')",
        shouldSendSMS: true,
        conversationState
      };
    }
  } catch (error) {
    console.error('Error in handleAutoSyncEventLocation:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Check calendar connection status
 * @deprecated Use hasValidCalendarConnection from google_calendar.ts instead
 * Kept for backward compatibility
 */
export async function checkCalendarConnection(
  supabase: any,
  userId: string
): Promise<boolean> {
  return await hasValidCalendarConnection(supabase, userId);
}

// ============================================================================
// NATURAL LANGUAGE TIME WINDOW PARSER
// ============================================================================

export interface TimeWindow {
  startDate: Date;
  endDate: Date;
  dayOfWeek?: number[]; // 0-6 (Sunday-Saturday)
  timeRange?: { start: string, end: string }; // "18:00", "20:00"
  description: string;
}

export interface ParseTimeWindowResult {
  isValid: boolean;
  timeWindows: TimeWindow[];
  error?: string;
}

/**
 * Parse natural language time window input into structured time windows
 * Supports patterns like "next week evenings", "weekend mornings", etc.
 */
export function parseNaturalLanguageTimeWindow(
  message: string,
  referenceDate: Date = new Date()
): ParseTimeWindowResult {
  try {
    const normalizedMessage = message.toLowerCase().trim();
    const timeWindows: TimeWindow[] = [];
    
    // Helper to get day of week number (0=Sunday, 6=Saturday)
    const getDayOfWeek = (dayName: string): number | null => {
      const days: { [key: string]: number } = {
        'sunday': 0, 'sun': 0,
        'monday': 1, 'mon': 1,
        'tuesday': 2, 'tue': 2, 'tues': 2,
        'wednesday': 3, 'wed': 3,
        'thursday': 4, 'thu': 4, 'thur': 4, 'thurs': 4,
        'friday': 5, 'fri': 5,
        'saturday': 6, 'sat': 6
      };
      return days[dayName.toLowerCase()] ?? null;
    };

    // Helper to get start of week (Monday)
    const getStartOfWeek = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      return new Date(d.setDate(diff));
    };

    // Helper to get next occurrence of day
    const getNextDay = (dayOfWeek: number, fromDate: Date = referenceDate): Date => {
      const result = new Date(fromDate);
      const currentDay = result.getDay();
      let daysToAdd = dayOfWeek - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next week if same or past
      result.setDate(result.getDate() + daysToAdd);
      return result;
    };

    // Time range definitions
    const timeRanges: { [key: string]: { start: string, end: string } } = {
      'morning': { start: '09:00', end: '12:00' },
      'mornings': { start: '09:00', end: '12:00' },
      'afternoon': { start: '12:00', end: '18:00' },
      'afternoons': { start: '12:00', end: '18:00' },
      'evening': { start: '18:00', end: '22:00' },
      'evenings': { start: '18:00', end: '22:00' },
      'night': { start: '22:00', end: '23:59' },
      'nights': { start: '22:00', end: '23:59' }
    };

    // Pattern 1: "next week evenings" or "evenings next week"
    const nextWeekPattern = /(?:next\s+week|week\s+next)\s+(\w+)/i;
    const matchNextWeek = normalizedMessage.match(nextWeekPattern);
    if (matchNextWeek) {
      const timeRangeName = matchNextWeek[1];
      const timeRange = timeRanges[timeRangeName];
      if (timeRange) {
        const startOfNextWeek = getStartOfWeek(referenceDate);
        startOfNextWeek.setDate(startOfNextWeek.getDate() + 7); // Next week
        const endOfNextWeek = new Date(startOfNextWeek);
        endOfNextWeek.setDate(endOfNextWeek.getDate() + 6); // Sunday
        
        timeWindows.push({
          startDate: startOfNextWeek,
          endDate: endOfNextWeek,
          timeRange: timeRange,
          description: `next week ${timeRangeName}`
        });
        return { isValid: true, timeWindows };
      }
    }

    // Pattern 2: "this week evenings" or "evenings this week"
    const thisWeekPattern = /(?:this\s+week|week\s+this)\s+(\w+)/i;
    const matchThisWeek = normalizedMessage.match(thisWeekPattern);
    if (matchThisWeek) {
      const timeRangeName = matchThisWeek[1];
      const timeRange = timeRanges[timeRangeName];
      if (timeRange) {
        const startOfWeek = getStartOfWeek(referenceDate);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        
        timeWindows.push({
          startDate: startOfWeek,
          endDate: endOfWeek,
          timeRange: timeRange,
          description: `this week ${timeRangeName}`
        });
        return { isValid: true, timeWindows };
      }
    }

    // Pattern 3: "weekend mornings" or "mornings weekend"
    const weekendPattern = /(?:weekend|weekends?)\s+(\w+)/i;
    const matchWeekend = normalizedMessage.match(weekendPattern);
    if (matchWeekend) {
      const timeRangeName = matchWeekend[1];
      const timeRange = timeRanges[timeRangeName];
      if (timeRange) {
        const nextSaturday = getNextDay(6, referenceDate);
        const nextSunday = new Date(nextSaturday);
        nextSunday.setDate(nextSunday.getDate() + 1);
        
        timeWindows.push({
          startDate: nextSaturday,
          endDate: nextSunday,
          dayOfWeek: [6, 0], // Saturday, Sunday
          timeRange: timeRange,
          description: `weekend ${timeRangeName}`
        });
        return { isValid: true, timeWindows };
      }
    }

    // Pattern 4: "this Friday afternoon" or "next Monday"
    const dayPattern = /(?:this|next)\s+(\w+)(?:\s+(\w+))?/i;
    const matchDay = normalizedMessage.match(dayPattern);
    if (matchDay) {
      const dayName = matchDay[1];
      const timeRangeName = matchDay[2];
      const dayOfWeek = getDayOfWeek(dayName);
      
      if (dayOfWeek !== null) {
        const isNext = normalizedMessage.includes('next');
        const targetDay = isNext ? getNextDay(dayOfWeek) : getNextDay(dayOfWeek, new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000));
        
        const timeRange = timeRangeName ? timeRanges[timeRangeName] : undefined;
        
        timeWindows.push({
          startDate: targetDay,
          endDate: new Date(targetDay),
          dayOfWeek: [dayOfWeek],
          timeRange: timeRange,
          description: `${isNext ? 'next' : 'this'} ${dayName}${timeRangeName ? ' ' + timeRangeName : ''}`
        });
        return { isValid: true, timeWindows };
      }
    }

    // Pattern 5: "next Monday to Wednesday" or "Monday to Wednesday"
    const rangePattern = /(?:next\s+)?(\w+)\s+to\s+(\w+)/i;
    const matchRange = normalizedMessage.match(rangePattern);
    if (matchRange) {
      const startDayName = matchRange[1];
      const endDayName = matchRange[2];
      const startDayOfWeek = getDayOfWeek(startDayName);
      const endDayOfWeek = getDayOfWeek(endDayName);
      
      if (startDayOfWeek !== null && endDayOfWeek !== null) {
        const isNext = normalizedMessage.includes('next');
        const startDay = isNext ? getNextDay(startDayOfWeek) : getNextDay(startDayOfWeek, new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000));
        const endDay = new Date(startDay);
        
        // Calculate days to add
        let daysToAdd = endDayOfWeek - startDayOfWeek;
        if (daysToAdd < 0) daysToAdd += 7;
        endDay.setDate(endDay.getDate() + daysToAdd);
        
        const dayOfWeekRange: number[] = [];
        for (let i = startDayOfWeek; i <= (endDayOfWeek >= startDayOfWeek ? endDayOfWeek : endDayOfWeek + 7); i++) {
          dayOfWeekRange.push(i % 7);
        }
        
        timeWindows.push({
          startDate: startDay,
          endDate: endDay,
          dayOfWeek: dayOfWeekRange,
          description: `${isNext ? 'next ' : ''}${startDayName} to ${endDayName}`
        });
        return { isValid: true, timeWindows };
      }
    }

    // Pattern 6: Just time range (e.g., "evenings", "mornings")
    const timeOnlyPattern = /^(morning|afternoon|evening|night)s?$/i;
    const matchTimeOnly = normalizedMessage.match(timeOnlyPattern);
    if (matchTimeOnly) {
      const timeRangeName = matchTimeOnly[1].toLowerCase();
      const timeRange = timeRanges[timeRangeName + 's'] || timeRanges[timeRangeName];
      if (timeRange) {
        // Default to next 7 days
        const startDate = new Date(referenceDate);
        const endDate = new Date(referenceDate);
        endDate.setDate(endDate.getDate() + 7);
        
        timeWindows.push({
          startDate: startDate,
          endDate: endDate,
          timeRange: timeRange,
          description: timeRangeName
        });
        return { isValid: true, timeWindows };
      }
    }

    // If no pattern matched, return error
    return {
      isValid: false,
      timeWindows: [],
      error: "I need more details. Try: 'next week evenings' or 'weekend mornings'"
    };
  } catch (error) {
    console.error('Error parsing natural language time window:', error);
    return {
      isValid: false,
      timeWindows: [],
      error: "I couldn't understand that time window. Try: 'next week evenings' or 'weekend mornings'"
    };
  }
}

// ============================================================================
// TIME PROPOSAL GENERATION
// ============================================================================

export interface TimeProposal {
  start: Date;
  end: Date;
  isFullyOpen: boolean;
  conflicts: number;
  rank: number;
  description: string;
}

/**
 * Generate time proposals from calendar events and time windows
 */
export function generateTimeProposals(
  calendarEvents: CalendarEvent[],
  timeWindows: TimeWindow[],
  timezone: string,
  maxProposals: number = 10
): TimeProposal[] {
  const proposals: TimeProposal[] = [];
  const defaultDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
  const slotIncrement = 30 * 60 * 1000; // 30 minutes

  // Helper to format proposal description
  const formatProposalDescription = (start: Date, end: Date): string => {
    const dayName = start.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayName}, ${monthDay} at ${startTime}–${endTime}`;
  };

  // Helper to calculate rank
  const calculateRank = (proposal: TimeProposal, timeWindow: TimeWindow): number => {
    let rank = 0;
    
    // Fully open windows rank higher
    if (proposal.isFullyOpen) {
      rank += 1000;
    } else {
      // Partially open: rank by inverse of conflicts
      rank += Math.max(0, 1000 - (proposal.conflicts * 100));
    }
    
    // Prefer evening times (6pm-9pm) - default preference
    const hour = proposal.start.getHours();
    if (hour >= 18 && hour < 21) {
      rank += 100;
    } else if (hour >= 9 && hour < 12) {
      rank += 50; // Morning preference if specified
    } else if (hour >= 12 && hour < 18) {
      rank += 30; // Afternoon preference if specified
    }
    
    // Prefer weekdays over weekends
    const dayOfWeek = proposal.start.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      rank += 10;
    }
    
    // Prefer earlier dates
    const daysFromNow = Math.floor((proposal.start.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000));
    rank += Math.max(0, 50 - daysFromNow);
    
    return rank;
  };

  // Process each time window
  for (const timeWindow of timeWindows) {
    const startDate = new Date(timeWindow.startDate);
    const endDate = new Date(timeWindow.endDate);
    
    // Set time range if specified
    if (timeWindow.timeRange) {
      const [startHour, startMin] = timeWindow.timeRange.start.split(':').map(Number);
      const [endHour, endMin] = timeWindow.timeRange.end.split(':').map(Number);
      
      // Generate slots within the time window
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        // Check if this day matches dayOfWeek filter
        if (timeWindow.dayOfWeek && !timeWindow.dayOfWeek.includes(currentDate.getDay())) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        // Generate slots for this day within the time range
        const slotStart = new Date(currentDate);
        slotStart.setHours(startHour, startMin, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setHours(endHour, endMin, 0, 0);
        
        // Generate proposals in 30-minute increments
        let currentSlotStart = new Date(slotStart);
        
        while (currentSlotStart < slotEnd) {
          const currentSlotEnd = new Date(currentSlotStart.getTime() + defaultDuration);
          
          // Don't exceed the end time
          if (currentSlotEnd > slotEnd) {
            break;
          }
          
          // Check for conflicts
          const availability = checkTimeSlotAvailability(
            calendarEvents,
            currentSlotStart,
            currentSlotEnd
          );
          
          const proposal: TimeProposal = {
            start: new Date(currentSlotStart),
            end: new Date(currentSlotEnd),
            isFullyOpen: availability.isAvailable,
            conflicts: availability.conflicts.length,
            rank: 0, // Will be calculated
            description: formatProposalDescription(currentSlotStart, currentSlotEnd)
          };
          
          // Calculate rank
          proposal.rank = calculateRank(proposal, timeWindow);
          
          proposals.push(proposal);
          
          // Move to next slot (30 minutes later)
          currentSlotStart = new Date(currentSlotStart.getTime() + slotIncrement);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      // No time range specified, generate all-day slots
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        // Check if this day matches dayOfWeek filter
        if (timeWindow.dayOfWeek && !timeWindow.dayOfWeek.includes(currentDate.getDay())) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        // Default to evening times (6pm-8pm) if no time range
        const slotStart = new Date(currentDate);
        slotStart.setHours(18, 0, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setHours(20, 0, 0, 0);
        
        // Check for conflicts
        const availability = checkTimeSlotAvailability(
          calendarEvents,
          slotStart,
          slotEnd
        );
        
        const proposal: TimeProposal = {
          start: new Date(slotStart),
          end: new Date(slotEnd),
          isFullyOpen: availability.isAvailable,
          conflicts: availability.conflicts.length,
          rank: 0,
          description: formatProposalDescription(slotStart, slotEnd)
        };
        
        proposal.rank = calculateRank(proposal, timeWindow);
        proposals.push(proposal);
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  }
  
  // Sort by rank (highest first) and return top N
  proposals.sort((a, b) => b.rank - a.rank);
  
  // If no fully open windows, still return the best options
  if (proposals.length === 0) {
    return [];
  }
  
  return proposals.slice(0, maxProposals);
}

/**
 * Format calendar proposal with week view for SMS
 */
export function formatCalendarProposalForSMS(
  proposal: TimeProposal,
  calendarEvents: CalendarEvent[],
  timezone: string,
  weekStartDate: Date
): string {
  // Calculate week start (Monday)
  const weekStart = new Date(weekStartDate);
  const dayOfWeek = weekStart.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + daysToMonday);
  weekStart.setHours(0, 0, 0, 0);
  
  // Calculate week end (Sunday)
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  // Define 4-hour time blocks
  const timeBlocks = [
    { name: 'Morning', start: 9, end: 13 },
    { name: 'Afternoon', start: 13, end: 17 },
    { name: 'Evening', start: 17, end: 21 },
    { name: 'Night', start: 21, end: 1 }
  ];
  
  // Build week view
  let weekView = 'Week view:\n';
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const currentDay = new Date(weekStart);
    currentDay.setDate(currentDay.getDate() + dayOffset);
    
    const dayName = dayNames[dayOffset];
    const monthDay = currentDay.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    
    weekView += `${dayName} ${monthDay}  `;
    
    // Check each time block for this day
    for (const block of timeBlocks) {
      const blockStart = new Date(currentDay);
      blockStart.setHours(block.start, 0, 0, 0);
      
      const blockEnd = new Date(currentDay);
      if (block.end === 1) {
        blockEnd.setDate(blockEnd.getDate() + 1);
        blockEnd.setHours(1, 0, 0, 0);
      } else {
        blockEnd.setHours(block.end, 0, 0, 0);
      }
      
      // Check if proposal time is in this block
      const isProposalBlock = proposal.start >= blockStart && proposal.start < blockEnd;
      
      // Check if any events conflict with this block
      const hasConflict = calendarEvents.some(event => {
        const eventStart = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date!);
        const eventEnd = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date!);
        
        return (eventStart < blockEnd && eventEnd > blockStart);
      });
      
      if (isProposalBlock) {
        weekView += '[*] ';
      } else if (hasConflict) {
        weekView += '[busy] ';
      } else {
        weekView += '[free] ';
      }
    }
    
    weekView += '\n';
  }
  
  return weekView;
}

/**
 * Parse time adjustment from user message
 */
export function parseTimeAdjustment(
  message: string,
  currentProposal: TimeProposal
): { isValid: boolean; adjustedProposal?: TimeProposal; error?: string } {
  try {
    const normalizedMessage = message.toLowerCase().trim();
    const adjustedProposal: TimeProposal = {
      ...currentProposal,
      start: new Date(currentProposal.start),
      end: new Date(currentProposal.end)
    };
    
    // Pattern 1: "make it 7pm" or "make it 7:30pm"
    const makeItTimePattern = /make\s+it\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const matchMakeIt = normalizedMessage.match(makeItTimePattern);
    if (matchMakeIt) {
      let hours = parseInt(matchMakeIt[1]);
      const minutes = matchMakeIt[2] ? parseInt(matchMakeIt[2]) : 0;
      const ampm = matchMakeIt[3]?.toLowerCase();
      
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      adjustedProposal.start.setHours(hours, minutes, 0, 0);
      const duration = adjustedProposal.end.getTime() - adjustedProposal.start.getTime();
      adjustedProposal.end = new Date(adjustedProposal.start.getTime() + duration);
      
      adjustedProposal.description = formatProposalDescription(adjustedProposal.start, adjustedProposal.end);
      return { isValid: true, adjustedProposal };
    }
    
    // Pattern 2: "30 minutes later" or "1 hour later"
    const laterPattern = /(\d+)\s*(minute|hour|hr)s?\s+later/i;
    const matchLater = normalizedMessage.match(laterPattern);
    if (matchLater) {
      const amount = parseInt(matchLater[1]);
      const unit = matchLater[2].toLowerCase();
      const milliseconds = unit === 'hour' || unit === 'hr' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
      
      adjustedProposal.start = new Date(adjustedProposal.start.getTime() + milliseconds);
      adjustedProposal.end = new Date(adjustedProposal.end.getTime() + milliseconds);
      
      adjustedProposal.description = formatProposalDescription(adjustedProposal.start, adjustedProposal.end);
      return { isValid: true, adjustedProposal };
    }
    
    // Pattern 3: "make it 2 hours" (duration change)
    const durationPattern = /make\s+it\s+(\d+)\s+hours?/i;
    const matchDuration = normalizedMessage.match(durationPattern);
    if (matchDuration) {
      const hours = parseInt(matchDuration[1]);
      adjustedProposal.end = new Date(adjustedProposal.start.getTime() + hours * 60 * 60 * 1000);
      
      adjustedProposal.description = formatProposalDescription(adjustedProposal.start, adjustedProposal.end);
      return { isValid: true, adjustedProposal };
    }
    
    // Pattern 4: "next day" or "tomorrow"
    if (normalizedMessage.includes('next day') || normalizedMessage.includes('tomorrow')) {
      adjustedProposal.start.setDate(adjustedProposal.start.getDate() + 1);
      adjustedProposal.end.setDate(adjustedProposal.end.getDate() + 1);
      
      adjustedProposal.description = formatProposalDescription(adjustedProposal.start, adjustedProposal.end);
      return { isValid: true, adjustedProposal };
    }
    
    // Pattern 5: Day name (e.g., "Friday")
    const dayNames: { [key: string]: number } = {
      'sunday': 0, 'sun': 0,
      'monday': 1, 'mon': 1,
      'tuesday': 2, 'tue': 2,
      'wednesday': 3, 'wed': 3,
      'thursday': 4, 'thu': 4,
      'friday': 5, 'fri': 5,
      'saturday': 6, 'sat': 6
    };
    
    for (const [dayName, dayOfWeek] of Object.entries(dayNames)) {
      if (normalizedMessage.includes(dayName)) {
        const currentDay = adjustedProposal.start.getDay();
        let daysToAdd = dayOfWeek - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        
        adjustedProposal.start.setDate(adjustedProposal.start.getDate() + daysToAdd);
        adjustedProposal.end.setDate(adjustedProposal.end.getDate() + daysToAdd);
        
        adjustedProposal.description = formatProposalDescription(adjustedProposal.start, adjustedProposal.end);
        return { isValid: true, adjustedProposal };
      }
    }
    
    return { isValid: false, error: "I couldn't understand that adjustment. Try: 'make it 7pm' or '30 minutes later'" };
  } catch (error) {
    console.error('Error parsing time adjustment:', error);
    return { isValid: false, error: "I couldn't understand that adjustment." };
  }
}

/**
 * Helper to format proposal description
 */
function formatProposalDescription(start: Date, end: Date): string {
  const dayName = start.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dayName}, ${monthDay} at ${startTime}–${endTime}`;
}

/**
 * Validate time adjustment against calendar conflicts
 */
export async function validateTimeAdjustment(
  adjustedProposal: TimeProposal,
  calendarEvents: CalendarEvent[],
  timezone: string
): Promise<{ isValid: boolean; error?: string }> {
  const availability = checkTimeSlotAvailability(
    calendarEvents,
    adjustedProposal.start,
    adjustedProposal.end
  );
  
  if (!availability.isAvailable) {
    return {
      isValid: false,
      error: "That time conflicts with an existing event. Try a different time."
    };
  }
  
  return { isValid: true };
}

// ============================================================================
// ACTION HANDLERS - Phase 2: Configuration
// ============================================================================

/**
 * Handle calendar time definition (natural language input)
 */
export async function handleCalendarTimeDefinition(
  supabase: any,
  userId: string,
  phoneNumber: string,
  message: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    // Parse natural language time window
    const parseResult = parseNaturalLanguageTimeWindow(message);
    
    if (!parseResult.isValid) {
      return {
        response: parseResult.error || "I need more details. Try: 'next week evenings' or 'weekend mornings'",
        shouldSendSMS: true
      };
    }
    
    // Get user's calendar timezone
    const calendarTimezone = await getUserCalendarTimezone(supabase, userId);
    if (!calendarTimezone) {
      return {
        response: "I'm having trouble accessing your calendar right now. Try again soon.",
        shouldSendSMS: true
      };
    }
    
    // Calculate time range for fetching events (use the time windows)
    const earliestStart = parseResult.timeWindows.reduce((earliest, tw) => 
      tw.startDate < earliest ? tw.startDate : earliest, parseResult.timeWindows[0].startDate);
    const latestEnd = parseResult.timeWindows.reduce((latest, tw) => 
      tw.endDate > latest ? tw.endDate : latest, parseResult.timeWindows[0].endDate);
    
    // Add buffer to ensure we get all events
    const timeMin = new Date(earliestStart);
    timeMin.setDate(timeMin.getDate() - 1);
    const timeMax = new Date(latestEnd);
    timeMax.setDate(timeMax.getDate() + 1);
    timeMax.setHours(23, 59, 59, 999);
    
    // Fetch calendar events
    const eventsResponse = await getUserCalendarEvents(supabase, userId, timeMin, timeMax);
    
    if (!eventsResponse) {
      return {
        response: "I'm having trouble accessing your calendar right now. Try again soon.",
        shouldSendSMS: true
      };
    }
    
    // Generate time proposals
    const proposals = generateTimeProposals(
      eventsResponse.items,
      parseResult.timeWindows,
      calendarTimezone,
      10
    );
    
    if (proposals.length === 0) {
      return {
        response: "I couldn't find any available times in that window. Try a different time range.",
        shouldSendSMS: true
      };
    }
    
    // Store proposals and state
    const extractedData = currentState?.extracted_data?.[0] || {};
    extractedData.proposals = proposals.map(p => ({
      start: p.start.toISOString(),
      end: p.end.toISOString(),
      isFullyOpen: p.isFullyOpen,
      conflicts: p.conflicts,
      description: p.description
    }));
    extractedData.current_proposal_index = 0;
    extractedData.saved_options = [];
    extractedData.calendar_timezone = calendarTimezone;
    // Store calendar events for later validation
    extractedData.calendar_events = eventsResponse.items;
    
    // Get first proposal
    const firstProposal = proposals[0];
    const hasFullyOpen = proposals.some(p => p.isFullyOpen);
    
    // Format response message
    let responseMessage = '';
    if (!hasFullyOpen) {
      responseMessage = "I couldn't find a fully open window, but here's the closest option.\n\n";
    }
    responseMessage += `Here's a window that works. ${firstProposal.description}.\n\n`;
    
    // Add calendar visual (will be implemented in next step)
    responseMessage += formatCalendarProposalForSMS(
      firstProposal,
      eventsResponse.items,
      calendarTimezone,
      new Date(firstProposal.start)
    );
    
    responseMessage += "\n\nReply yes to save, suggest a change, or next to see another option.";
    
    const conversationState = {
      waiting_for: 'auto_sync_option_proposal',
      current_state: 'auto_sync_configuration',
      extracted_data: [extractedData]
    };
    
    return {
      response: responseMessage,
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleCalendarTimeDefinition:', error);
    return {
      response: "I'm having trouble accessing your calendar right now. Try again soon.",
      shouldSendSMS: true
    };
  }
}

/**
 * Handle no-calendar time definition
 * Reuses parseReSyncTimeOptions from index.ts (will need to import or duplicate logic)
 */
export async function handleNoCalendarTimeDefinition(
  supabase: any,
  userId: string,
  phoneNumber: string,
  message: string,
  currentState: any,
  parseReSyncTimeOptions: (msg: string) => any // Function passed from index.ts
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const timeOptionsResult = parseReSyncTimeOptions(message);
    
    if (!timeOptionsResult.isValid || timeOptionsResult.timeOptions.length < 1 || timeOptionsResult.timeOptions.length > 3) {
      return {
        response: "I need 1-3 time options. Try again (e.g., 'Thu 12/19, 6-8pm, Sat 12/21, 10am-12pm')",
        shouldSendSMS: true
      };
    }
    
    const extractedData = currentState?.extracted_data?.[0] || {};
    extractedData.time_options = timeOptionsResult.timeOptions;
    
    const conversationState = {
      waiting_for: 'auto_sync_response_goal',
      current_state: 'auto_sync_configuration',
      extracted_data: [extractedData]
    };
    
    return {
      response: "What's the response goal? Reply 1 for Everyone, 2 for Critical mass.",
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleNoCalendarTimeDefinition:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle option proposal (calendar mode)
 */
export async function handleOptionProposal(
  supabase: any,
  userId: string,
  phoneNumber: string,
  message: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const normalizedMessage = message.toLowerCase().trim();
    const extractedData = currentState?.extracted_data?.[0] || {};
    const proposals = extractedData.proposals || [];
    let currentIndex = extractedData.current_proposal_index || 0;
    
    if (proposals.length === 0) {
      return {
        response: 'No proposals available. Please start over.',
        shouldSendSMS: true
      };
    }
    
    // Handle exit
    if (normalizedMessage === 'exit' || normalizedMessage === 'cancel') {
      await supabase
        .from('conversation_state')
        .update({
          current_state: 'normal',
          waiting_for: null,
          extracted_data: []
        })
        .eq('user_id', userId);
      
      return {
        response: 'Auto Sync cancelled.',
        shouldSendSMS: true
      };
    }
    
    // Handle "yes" to save
    if (normalizedMessage === 'yes' || normalizedMessage === 'y') {
      const currentProposal = proposals[currentIndex];
      const savedOptions = extractedData.saved_options || [];
      
      if (savedOptions.length >= 3) {
        return {
          response: "You've already saved 3 options. Reply send to start Auto Sync, or exit.",
          shouldSendSMS: true
        };
      }
      
      // Save the proposal
      savedOptions.push({
        start: currentProposal.start,
        end: currentProposal.end,
        description: currentProposal.description
      });
      
      extractedData.saved_options = savedOptions;
      
      // Format saved message
      const dayName = new Date(currentProposal.start).toLocaleDateString('en-US', { weekday: 'long' });
      const monthDay = new Date(currentProposal.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const startTime = new Date(currentProposal.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      
      let responseMessage = `Saved. ${dayName}, ${monthDay} at ${startTime}.`;
      
      if (savedOptions.length >= 3) {
        responseMessage += " You've added the maximum number of options. Reply send to start Auto Sync, or exit.";
      } else {
        responseMessage += " Send Auto Sync, add another option, or exit?";
      }
      
      const conversationState = {
        waiting_for: 'auto_sync_saving_options',
        current_state: 'auto_sync_configuration',
        extracted_data: [extractedData]
      };
      
      return {
        response: responseMessage,
        shouldSendSMS: true,
        conversationState
      };
    }
    
    // Handle "next" to show next proposal
    if (normalizedMessage === 'next') {
      if (currentIndex >= proposals.length - 1) {
        return {
          response: "No more options available. Reply yes to save this one, or exit.",
          shouldSendSMS: true
        };
      }
      
      currentIndex++;
      extractedData.current_proposal_index = currentIndex;
      
      const nextProposal = proposals[currentIndex];
      const calendarTimezone = extractedData.calendar_timezone || 'UTC';
      
      // Get calendar events from state (stored during time definition)
      const calendarEvents: CalendarEvent[] = extractedData.calendar_events || [];
      
      let responseMessage = `Here's a window that works. ${nextProposal.description}.\n\n`;
      responseMessage += formatCalendarProposalForSMS(
        {
          start: new Date(nextProposal.start),
          end: new Date(nextProposal.end),
          isFullyOpen: nextProposal.isFullyOpen,
          conflicts: nextProposal.conflicts,
          rank: nextProposal.rank,
          description: nextProposal.description
        },
        calendarEvents,
        calendarTimezone,
        new Date(nextProposal.start)
      );
      responseMessage += "\n\nReply yes to save, suggest a change, or next to see another option.";
      
      const conversationState = {
        waiting_for: 'auto_sync_option_proposal',
        current_state: 'auto_sync_configuration',
        extracted_data: [extractedData]
      };
      
      return {
        response: responseMessage,
        shouldSendSMS: true,
        conversationState
      };
    }
    
    // Handle time adjustment
    const currentProposal = proposals[currentIndex];
    const proposalObj: TimeProposal = {
      start: new Date(currentProposal.start),
      end: new Date(currentProposal.end),
      isFullyOpen: currentProposal.isFullyOpen,
      conflicts: currentProposal.conflicts,
      rank: currentProposal.rank,
      description: currentProposal.description
    };
    
    const adjustmentResult = parseTimeAdjustment(message, proposalObj);
    
    if (!adjustmentResult.isValid) {
      return {
        response: adjustmentResult.error || "I couldn't understand that adjustment. Try: 'make it 7pm' or '30 minutes later'",
        shouldSendSMS: true
      };
    }
    
    // Validate adjusted time against calendar
    const calendarEvents: CalendarEvent[] = extractedData.calendar_events || [];
    const validationResult = await validateTimeAdjustment(
      adjustmentResult.adjustedProposal!,
      calendarEvents,
      extractedData.calendar_timezone || 'UTC'
    );
    
    if (!validationResult.isValid) {
      return {
        response: validationResult.error || "That time conflicts with an existing event. Try a different time.",
        shouldSendSMS: true
      };
    }
    
    // Update proposal with adjusted time
    proposals[currentIndex] = {
      start: adjustmentResult.adjustedProposal!.start.toISOString(),
      end: adjustmentResult.adjustedProposal!.end.toISOString(),
      isFullyOpen: adjustmentResult.adjustedProposal!.isFullyOpen,
      conflicts: adjustmentResult.adjustedProposal!.conflicts,
      description: adjustmentResult.adjustedProposal!.description
    };
    
    extractedData.proposals = proposals;
    
    // Show adjusted proposal
    let responseMessage = `Here's the adjusted window. ${adjustmentResult.adjustedProposal!.description}.\n\n`;
    responseMessage += formatCalendarProposalForSMS(
      adjustmentResult.adjustedProposal!,
      calendarEvents,
      extractedData.calendar_timezone || 'UTC',
      adjustmentResult.adjustedProposal!.start
    );
    responseMessage += "\n\nReply yes to save, suggest a change, or next to see another option.";
    
    const conversationState = {
      waiting_for: 'auto_sync_option_proposal',
      current_state: 'auto_sync_configuration',
      extracted_data: [extractedData]
    };
    
    return {
      response: responseMessage,
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleOptionProposal:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle response goal selection
 */
export async function handleResponseGoal(
  supabase: any,
  userId: string,
  phoneNumber: string,
  message: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const normalizedMessage = message.toLowerCase().trim();
    let responseGoal: ResponseGoal;
    
    if (normalizedMessage === '1' || normalizedMessage === 'everyone') {
      responseGoal = 'everyone';
    } else if (normalizedMessage === '2' || normalizedMessage === 'critical mass' || normalizedMessage === 'critical') {
      responseGoal = 'critical_mass';
    } else {
      return {
        response: "Please reply 1 for Everyone, or 2 for Critical mass.",
        shouldSendSMS: true
      };
    }
    
    const extractedData = currentState?.extracted_data?.[0] || {};
    extractedData.response_goal = responseGoal;
    
    const conversationState = {
      waiting_for: 'auto_sync_confirmation',
      current_state: 'auto_sync_configuration',
      extracted_data: [extractedData]
    };
    
    return {
      response: "Ready to start Auto Sync? Reply send or exit.",
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleResponseGoal:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle Auto Sync confirmation and timezone collection
 */
export async function handleAutoSyncConfirmation(
  supabase: any,
  userId: string,
  phoneNumber: string,
  message: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any, shouldInitialize?: boolean }> {
  try {
    const normalizedMessage = message.toLowerCase().trim();
    
    if (normalizedMessage === 'exit' || normalizedMessage === 'cancel') {
      // Clear conversation state
      await supabase
        .from('conversation_state')
        .update({
          current_state: 'normal',
          waiting_for: null,
          extracted_data: []
        })
        .eq('user_id', userId);
      
      return {
        response: 'Auto Sync cancelled.',
        shouldSendSMS: true
      };
    }
    
    if (normalizedMessage !== 'send' && normalizedMessage !== 'yes' && normalizedMessage !== 'y') {
      return {
        response: "Please reply send to start Auto Sync, or exit to cancel.",
        shouldSendSMS: true
      };
    }
    
    const extractedData = currentState?.extracted_data?.[0] || {};
    const calendarConnected = extractedData.calendar_connected || false;
    
    // If no calendar, check for timezone
    if (!calendarConnected) {
      // Check if timezone already in extracted_data (user provided it)
      if (extractedData.timezone) {
        // Timezone already provided, ready to initialize
        return {
          response: '', // Will be set by initializeAutoSync
          shouldSendSMS: false,
          shouldInitialize: true
        };
      }
      
      // Check profile for preferred_timezone
      const { data: profile } = await supabase
        .from('profiles')
        .select('preferred_timezone')
        .eq('id', userId)
        .single();
      
      const profileTimezone = profile?.preferred_timezone;
      
      // If profile timezone is empty/null, prompt for timezone
      if (!profileTimezone || profileTimezone.trim() === '') {
        // Prompt user for timezone
        const conversationState = {
          waiting_for: 'auto_sync_timezone',
          current_state: 'auto_sync_configuration',
          extracted_data: [extractedData]
        };
        
        return {
          response: "What timezone?\n1. PT (Pacific)\n2. MT (Mountain)\n3. CT (Central)\n4. ET (Eastern)\n5. AKT (Alaska)\n6. HT (Hawaii)\n\nReply with the number (1-6).",
          shouldSendSMS: true,
          conversationState
        };
      } else {
        // Use profile timezone, no prompt needed
        extractedData.timezone = profileTimezone;
        const conversationState = {
          waiting_for: 'auto_sync_confirmation',
          current_state: 'auto_sync_configuration',
          extracted_data: [extractedData]
        };
        
        await supabase
          .from('conversation_state')
          .update(conversationState)
          .eq('user_id', userId);
        
        // Ready to initialize with profile timezone
        return {
          response: '', // Will be set by initializeAutoSync
          shouldSendSMS: false,
          shouldInitialize: true
        };
      }
    }
    
    // Calendar connected, ready to initialize
    return {
      response: '', // Will be set by initializeAutoSync
      shouldSendSMS: false,
      shouldInitialize: true
    };
  } catch (error) {
    console.error('Error in handleAutoSyncConfirmation:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

// ============================================================================
// ACTION HANDLERS - Phase 3: Execution
// ============================================================================

/**
 * Initialize Auto Sync - create records and send initial messages
 */
export async function initializeAutoSync(
  supabase: any,
  userId: string,
  phoneNumber: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean }> {
  try {
    const extractedData = currentState?.extracted_data?.[0] || {};
    const { crew_id, event_name, event_location, response_goal, time_options, timezone, calendar_connected, saved_options, calendar_timezone } = extractedData;
    
    // Handle calendar mode: convert saved_options to time_options format
    let finalTimeOptions = time_options;
    let finalTimezone = timezone;
    
    if (calendar_connected && saved_options && saved_options.length > 0) {
      // Convert calendar proposals to time_options format
      finalTimeOptions = saved_options.map((opt: any, idx: number) => ({
        idx: idx + 1,
        text: opt.description,
        start_time: opt.start,
        end_time: opt.end
      }));
      
      // Use calendar timezone if available
      if (calendar_timezone) {
        finalTimezone = calendar_timezone;
      } else {
        // Fallback: get timezone from calendar
        const tz = await getUserCalendarTimezone(supabase, userId);
        if (tz) {
          finalTimezone = tz;
        }
      }
    }
    
    if (!crew_id || !event_name || !response_goal || !finalTimeOptions || !finalTimezone) {
      return {
        response: 'Missing required information. Please start over.',
        shouldSendSMS: true
      };
    }
    
    // Validate all data BEFORE creating auto_sync record
    // Get crew members (contacts) - validate first
    const { data: crewMembers } = await supabase
      .from('crew_members')
      .select('contact_id, contacts(id, phone_number, first_name, last_name)')
      .eq('crew_id', crew_id);
    
    if (!crewMembers || crewMembers.length === 0) {
      return {
        response: 'No crew members found. Please add members to your crew first.',
        shouldSendSMS: true
      };
    }
    
    // Get organizer name
    const { data: organizer } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .single();
    
    const organizerName = organizer?.first_name || 'Someone';
    
    // Prepare options data
    const optionsData = finalTimeOptions.map((opt: any, idx: number) => ({
      idx: idx + 1,
      start_time: opt.start_time,
      end_time: opt.end_time,
      timezone: finalTimezone
    }));

  // Calculate earliest option end time for auto-end scheduling
  let earliestEndTime: Date | null = null;
  for (const opt of finalTimeOptions as any[]) {
    const raw = opt.end_time || opt.start_time;
    if (!raw) continue;
    const dt = new Date(raw);
    if (!earliestEndTime || dt < earliestEndTime) {
      earliestEndTime = dt;
    }
  }
    
    // Prepare contact list BEFORE creating auto_sync (to ensure everything is ready)
    const contactIds: string[] = [];
    for (const member of crewMembers) {
      if (member.contact_id && member.contacts) {
        contactIds.push(member.contact_id);
      }
    }
    
    // NOW create Auto Sync record - LAST STEP before sending invitations
    // This ensures the trigger only fires when we're ready to send
    const autoSyncRecord = await createAutoSyncRecord(
      supabase,
      userId,
      crew_id,
      event_name,
      response_goal,
      finalTimezone,
      calendar_connected || false,
      {},
      event_location || null
    );
    
    if (!autoSyncRecord) {
      return {
        response: 'Failed to create Auto Sync. Please try again.',
        shouldSendSMS: true
      };
    }
    
    // Create options (after auto_sync is created)
    const optionsCreated = await createAutoSyncOptions(supabase, autoSyncRecord.id, optionsData);
    if (!optionsCreated) {
      return {
        response: 'Failed to create time options. Please try again.',
        shouldSendSMS: true
      };
    }

  // Schedule initial auto_end_check job at earliest option end time (if available)
  if (earliestEndTime) {
    try {
      await supabase
        .from('job_queue')
        .insert({
          sync_id: autoSyncRecord.id,
          job_type: 'auto_end_check',
          scheduled_at: earliestEndTime.toISOString()
        })
        .select();
      console.log(`Scheduled initial auto_end_check for auto_sync ${autoSyncRecord.id} at ${earliestEndTime.toISOString()}`);
    } catch (error) {
      console.error(`Error scheduling initial auto_end_check for auto_sync ${autoSyncRecord.id}:`, error);
      // Best-effort only; do not fail initialization if scheduling fails
    }
  }
    
    // Get options for formatting (after they're created)
    const { data: options } = await supabase
      .from('auto_sync_options')
      .select('*')
      .eq('auto_sync_id', autoSyncRecord.id)
      .order('idx');
    
    // Create message records and prepare messages
    const messagesToSend: Array<{ phone: string, message: string }> = [];
    
    for (const member of crewMembers) {
      if (member.contact_id && member.contacts) {
        const contact = member.contacts;
        const phone = contact.phone_number;
        
        if (options) {
          const message = formatInviteeAvailabilityMessage(
            organizerName,
            event_name,
            options,
            finalTimezone
          );
          messagesToSend.push({ phone, message });
        }
      }
    }
    
    // Create message records
    await createAutoSyncMessages(supabase, autoSyncRecord.id, contactIds, 'initial');
    
    // Send messages (final step - invitations are sent)
    for (const { phone, message } of messagesToSend) {
      await sendSMS(phone, message, true, undefined);
    }
    
    // Clear conversation state
    await supabase
      .from('conversation_state')
      .update({
        current_state: 'normal',
        waiting_for: null,
        extracted_data: []
      })
      .eq('user_id', userId);
    
    logWorkflowComplete({
      supabase,
      userId,
      workflowName: 'auto_sync',
      workflowStep: 'initialized',
      crewId: crew_id
    });
    
    return {
      response: `Auto Sync sent to ${contactIds.length} people.`,
      shouldSendSMS: true
    };
  } catch (error) {
    console.error('Error in initializeAutoSync:', error);
    logWorkflowError({
      supabase,
      userId,
      workflowName: 'auto_sync',
      workflowStep: 'initialization_error',
      errorDetails: { error: error.message || String(error) }
    });
    return {
      response: 'Failed to initialize Auto Sync. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle invitee Auto Sync reply
 */
export async function handleInviteeAutoSyncReply(
  supabase: any,
  contactId: string,
  phoneNumber: string,
  message: string
): Promise<{ response: string, shouldSendSMS: boolean }> {
  try {
    // Find most recent unresolved message
    const recentMessage = await getMostRecentUnresolvedMessage(supabase, contactId);
    
    if (!recentMessage) {
      // No active Auto Sync message found
      return {
        response: "Got it — thanks.",
        shouldSendSMS: true
      };
    }
    
    const { auto_sync_id } = recentMessage;
    
    // Check if Auto Sync is still active
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('status, organizer_id')
      .eq('id', auto_sync_id)
      .single();
    
    if (!autoSync || (autoSync.status !== 'running' && autoSync.status !== 'paused')) {
      // Auto Sync is stopped or completed
      return {
        response: "Got it — thanks.",
        shouldSendSMS: true
      };
    }
    
    // Get options first to validate against actual available options
    const { data: options } = await supabase
      .from('auto_sync_options')
      .select('id, idx')
      .eq('auto_sync_id', auto_sync_id)
      .order('idx');
    
    if (!options || options.length === 0) {
      return {
        response: "Got it — thanks.",
        shouldSendSMS: true
      };
    }
    
    // Parse response
    const parsed = parseAutoSyncResponse(message);
    
    if (!parsed.isValid) {
      return {
        response: "Reply with the number(s) that work for you, or none if nothing works.",
        shouldSendSMS: true
      };
    }
    
    let optionIds: string[] = [];
    let responseType: ResponseType;
    
    if (parsed.isNone) {
      responseType = 'not_available';
    } else {
      // Validate that all selected option indices exist in available options
      const availableIndices = options.map(opt => opt.idx);
      const invalidIndices = parsed.optionIdxs.filter(idx => !availableIndices.includes(idx));
      
      if (invalidIndices.length > 0) {
        // Build error message with valid range
        const validOptions = availableIndices.sort((a, b) => a - b);
        let errorMessage = "Please reply with ";
        if (validOptions.length === 1) {
          errorMessage += `${validOptions[0]}`;
        } else if (validOptions.length === 2) {
          errorMessage += `${validOptions[0]} or ${validOptions[1]}`;
        } else {
          const lastOption = validOptions[validOptions.length - 1];
          errorMessage += `${validOptions.slice(0, -1).join(', ')}, or ${lastOption}`;
        }
        errorMessage += ", or none if nothing works.";
        
        return {
          response: errorMessage,
          shouldSendSMS: true
        };
      }
      
      // All indices are valid, proceed with mapping
      responseType = 'available';
      for (const idx of parsed.optionIdxs) {
        const option = options.find(opt => opt.idx === idx);
        if (option) {
          optionIds.push(option.id);
        }
      }
    }
    
    // Update or create response
    const responseSaved = await updateAutoSyncResponse(supabase, auto_sync_id, contactId, optionIds, responseType);
    console.log(`[handleInviteeAutoSyncReply] Response saved: ${responseSaved} for contact ${contactId}, sync ${auto_sync_id}`);
    
    if (!responseSaved) {
      console.error(`[handleInviteeAutoSyncReply] Failed to save response for contact ${contactId}`);
      return {
        response: "Got it — thanks.",
        shouldSendSMS: true
      };
    }
    
    // Mark message as resolved
    await supabase
      .from('auto_sync_messages')
      .update({ is_resolved: true })
      .eq('id', recentMessage.message_id);
    
    // No confirmation message (silent update)
    // Note: Auto sync does NOT auto-complete when all invitees respond
    // It will pause after 48h and wait for organizer to send invites
    return {
      response: '',
      shouldSendSMS: false
    };
  } catch (error) {
    console.error('Error in handleInviteeAutoSyncReply:', error);
    return {
      response: "Got it — thanks.",
      shouldSendSMS: true
    };
  }
}

/**
 * Handle Auto Sync Check command
 */
export async function handleAutoSyncCheck(
  supabase: any,
  userId: string,
  phoneNumber: string
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const activeAutoSyncs = await getActiveAutoSyncs(supabase, userId);
    
    if (activeAutoSyncs.length === 0) {
      return {
        response: "You don't have any active Auto Syncs. Text Auto Sync to create one.",
        shouldSendSMS: true
      };
    }
    
    // Calculate stats for each
    const syncList: string[] = [];
    for (const autoSync of activeAutoSyncs) {
      const stats = await calculateResponseStats(supabase, autoSync.id);
      const statusText = formatAutoSyncStatus(autoSync.event_name, autoSync.status, stats);
      syncList.push(`${activeAutoSyncs.indexOf(autoSync) + 1}. ${statusText}`);
    }
    
    const conversationState = {
      waiting_for: 'auto_sync_selection',
      current_state: 'auto_sync_management',
      extracted_data: [{
        action: 'AUTO_SYNC_CHECK',
        auto_syncs: activeAutoSyncs
      }]
    };
    
    return {
      response: `Here are your Auto Syncs:\n${syncList.join('\n')}\nReply with a number to manage, or exit.`,
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleAutoSyncCheck:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle Auto Sync selection and show management menu
 */
export async function handleAutoSyncSelection(
  supabase: any,
  userId: string,
  phoneNumber: string,
  selection: string,
  currentState: any
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const autoSyncs = currentState?.extracted_data?.[0]?.auto_syncs || [];
    const index = parseInt(selection, 10) - 1;
    
    if (isNaN(index) || index < 0 || index >= autoSyncs.length) {
      return {
        response: 'Invalid selection. Please try again.',
        shouldSendSMS: true
      };
    }
    
    const selectedAutoSync = autoSyncs[index];
    const stats = await calculateResponseStats(supabase, selectedAutoSync.id);
    
    const conversationState = {
      waiting_for: selectedAutoSync.status === 'paused' ? 'auto_sync_paused_menu' : 'auto_sync_running_menu',
      current_state: 'auto_sync_management',
      extracted_data: [{
        action: 'AUTO_SYNC_SELECTED',
        auto_sync_id: selectedAutoSync.id,
        event_name: selectedAutoSync.event_name
      }]
    };
    
    if (selectedAutoSync.status === 'paused') {
      return {
        response: formatPausedStateSummary(selectedAutoSync.event_name, stats),
        shouldSendSMS: true,
        conversationState
      };
    } else {
      // Running state
      return {
        response: `Auto Sync for ${selectedAutoSync.event_name} (${stats.responded}/${stats.total} responded).\nReply 1 to send invites, 2 to stop, or exit.`,
        shouldSendSMS: true,
        conversationState
      };
    }
  } catch (error) {
    console.error('Error in handleAutoSyncSelection:', error);
    return {
      response: 'Something went wrong. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle sending reminder (from paused state)
 */
export async function handleAutoSyncReminder(
  supabase: any,
  userId: string,
  phoneNumber: string,
  autoSyncId: string
): Promise<{ response: string, shouldSendSMS: boolean }> {
  try {
    // Verify Auto Sync belongs to user and is paused
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('*')
      .eq('id', autoSyncId)
      .eq('organizer_id', userId)
      .single();
    
    if (!autoSync || autoSync.status !== 'paused') {
      return {
        response: 'Auto Sync not found or not in paused state.',
        shouldSendSMS: true
      };
    }
    
    // Update status to running
    await supabase
      .from('auto_syncs')
      .update({
        status: 'running',
        paused_at: null
      })
      .eq('id', autoSyncId);
    
    // Get pending invitees (no response or unresolved messages)
    const { data: options } = await supabase
      .from('auto_sync_options')
      .select('*')
      .eq('auto_sync_id', autoSyncId)
      .order('idx');
    
    const { data: crewMembers } = await supabase
      .from('crew_members')
      .select('contact_id, contacts(phone_number, first_name, last_name)')
      .eq('crew_id', autoSync.crew_id);
    
    const { data: responses } = await supabase
      .from('auto_sync_responses')
      .select('contact_id')
      .eq('auto_sync_id', autoSyncId);
    
    const respondedContactIds = new Set(responses?.map(r => r.contact_id) || []);
    
    // Get organizer name
    const { data: organizer } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .single();
    
    const organizerName = organizer?.first_name || 'Someone';
    
    // Send reminders to pending invitees
    let reminderCount = 0;
    for (const member of crewMembers || []) {
      if (member.contact_id && !respondedContactIds.has(member.contact_id) && member.contacts) {
        const contact = member.contacts;
        const message = formatInviteeAvailabilityMessage(
          organizerName,
          autoSync.event_name,
          options || [],
          autoSync.timezone
        );
        
        await sendSMS(contact.phone_number, message, true, undefined);
        
        // Create new message record
        await supabase
          .from('auto_sync_messages')
          .insert({
            auto_sync_id: autoSyncId,
            contact_id: member.contact_id,
            message_type: 'reminder',
            is_resolved: false
          });
        
        reminderCount++;
      }
    }
    
    // Update last reminder sent
    await supabase
      .from('auto_syncs')
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq('id', autoSyncId);
    
    return {
      response: `Reminder sent to ${reminderCount} people.`,
      shouldSendSMS: true
    };
  } catch (error) {
    console.error('Error in handleAutoSyncReminder:', error);
    return {
      response: 'Failed to send reminder. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Helper function to format time like "Thu 12/19, 6-8pm" or "Sat 12/21, 10am-12pm"
 */
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

/**
 * Handle sending invites (completes Auto Sync)
 * Now shows options first and waits for user selection
 */
export async function handleAutoSyncSendInvites(
  supabase: any,
  userId: string,
  phoneNumber: string,
  autoSyncId: string
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    // Verify Auto Sync belongs to user
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('*')
      .eq('id', autoSyncId)
      .eq('organizer_id', userId)
      .single();
    
    if (!autoSync || (autoSync.status !== 'running' && autoSync.status !== 'paused')) {
      return {
        response: 'Auto Sync not found or not active.',
        shouldSendSMS: true
      };
    }
    
    // Get all options
    const { data: options } = await supabase
      .from('auto_sync_options')
      .select('*')
      .eq('auto_sync_id', autoSyncId)
      .order('idx');
    
    if (!options || options.length === 0) {
      return {
        response: 'No time options found.',
        shouldSendSMS: true
      };
    }
    
    // Format options for display
    let optionsList = 'Send invites for which time?\n';
    options.forEach((option: any, index: number) => {
      const { dayMonth, timeText } = formatTimeRangeForOption(option.start_time, option.end_time);
      const formattedTime = timeText ? `${dayMonth}, ${timeText}` : dayMonth;
      optionsList += `${index + 1}. ${formattedTime}\n`;
    });
    optionsList += '\nReply with the option number or \'exit\'.';
    
    // Set conversation state to wait for option selection
    const conversationState = {
      waiting_for: 'auto_sync_select_option_for_invites',
      current_state: 'auto_sync_send_invites',
      extracted_data: [{
        auto_sync_id: autoSyncId,
        action: 'AUTO_SYNC_SEND_INVITES'
      }]
    };
    
    return {
      response: optionsList,
      shouldSendSMS: true,
      conversationState
    };
  } catch (error) {
    console.error('Error in handleAutoSyncSendInvites:', error);
    return {
      response: 'Failed to load options. Please try again.',
      shouldSendSMS: true
    };
  }
}
    
/**
 * Handle sending invites with a selected option (completes Auto Sync)
 */
export async function handleAutoSyncSendInvitesWithOption(
  supabase: any,
  userId: string,
  phoneNumber: string,
  autoSyncId: string,
  selectedOptionId: string
): Promise<{ response: string, shouldSendSMS: boolean }> {
  try {
    // Verify Auto Sync belongs to user
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('*')
      .eq('id', autoSyncId)
      .eq('organizer_id', userId)
      .single();
    
    if (!autoSync || (autoSync.status !== 'running' && autoSync.status !== 'paused')) {
      return {
        response: 'Auto Sync not found or not active.',
        shouldSendSMS: true
      };
    }
    
    // Get the selected option
    const { data: selectedOption } = await supabase
      .from('auto_sync_options')
      .select('*')
      .eq('id', selectedOptionId)
      .eq('auto_sync_id', autoSyncId)
      .single();
    
    if (!selectedOption) {
      return {
        response: 'Selected option not found. Please try again.',
        shouldSendSMS: true
      };
    }
    
    const startTime = new Date(selectedOption.start_time);
    const endTime = selectedOption.end_time ? new Date(selectedOption.end_time) : null;
    
    // Get organizer phone number for confirmation message
    const { data: organizer } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('id', userId)
      .single();
    
    // Step 1: Create event in events table
    const startTimeStr = selectedOption.start_time;
    const endTimeStr = selectedOption.end_time || selectedOption.start_time;
    const eventDate = startTimeStr.split('T')[0]; // Extract date part
    
    // Extract time portion (HH:MM:SS) from ISO datetime string
    // Format: "2026-01-06T14:00:00+00:00" -> "14:00:00"
    const startTimeOnly = startTimeStr.includes('T') 
      ? startTimeStr.split('T')[1].split('+')[0].split('-')[0].split('Z')[0].substring(0, 8)
      : startTimeStr;
    const endTimeOnly = endTimeStr.includes('T')
      ? endTimeStr.split('T')[1].split('+')[0].split('-')[0].split('Z')[0].substring(0, 8)
      : endTimeStr;
    
    const { data: newEvent, error: createEventError } = await supabase
      .from('events')
      .insert({
        title: autoSync.event_name,
        location: autoSync.event_location || 'TBD',
        start_time: startTimeOnly,
        end_time: endTimeOnly,
        creator_id: userId,
        crew_id: autoSync.crew_id,
        status: 'active',
        event_date: eventDate,
        notes: `Created from Auto Sync: ${autoSync.event_name}`
      })
      .select('id')
      .single();
    
    if (createEventError || !newEvent) {
      console.error('Error creating event:', createEventError);
      console.error('Event data attempted:', {
        title: autoSync.event_name,
        location: 'TBD',
        start_time: startTimeStr,
        end_time: endTimeStr,
        creator_id: userId,
        crew_id: autoSync.crew_id,
        status: 'active',
        event_date: eventDate,
        notes: `Created from Auto Sync: ${autoSync.event_name}`
      });
      return {
        response: `Failed to create event: ${createEventError?.message || 'Unknown error'}. Please try again.`,
        shouldSendSMS: true
      };
    }
    
    // Step 2: Send SMS invitations to all crew members via send-invitations Edge Function
    let invitationsSent = false;
    let invitationError = null;
    
    try {
      // @ts-ignore - Deno.env is available in Edge Functions
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      // @ts-ignore - Deno.env is available in Edge Functions
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing Supabase environment variables');
      }
      
      const inviteResponse = await fetch(`${supabaseUrl}/functions/v1/send-invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          event_id: newEvent.id,
          inviting_user_id: userId,
          crew_id: autoSync.crew_id
        })
      });
      
      if (inviteResponse.ok) {
        const inviteResult = await inviteResponse.json();
        invitationsSent = true;
        console.log('Invitations sent successfully:', inviteResult);
      } else {
        const errorText = await inviteResponse.text();
        throw new Error(`Send invitations error: ${inviteResponse.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error sending invitations:', error);
      invitationError = error;
      // Continue - don't fail the entire operation
      // Event is already created, we'll still complete the auto sync
    }
    
    // Step 3: Attempt to create calendar event (wrapped in try-catch)
    let calendarEventCreated = false;
    let calendarError = null;
    
    try {
      if (autoSync.calendar_connected) {
        // Get organizer calendar tokens
        const { data: tokens } = await supabase
          .from('google_calendar_tokens')
          .select('*')
          .eq('user_id', userId)
          .single();
        
        if (tokens && tokens.access_token) {
          // Check if token is expired (token refresh workflow not complete yet)
          if (tokens.expires_at && new Date(tokens.expires_at) < new Date()) {
            console.log('Token expired, refresh not implemented yet - skipping calendar event');
            throw new Error('Token expired and refresh not available');
          }
          
          // Get crew member emails for attendees
          const { data: crewMembers } = await supabase
            .from('crew_members')
            .select('contact_id, contacts(email)')
            .eq('crew_id', autoSync.crew_id);
          
          const attendeeEmails = crewMembers
            ?.filter((m: any) => m.contacts?.email)
            .map((m: any) => ({ email: m.contacts.email })) || [];
          
          // Create calendar event via Google Calendar API
          const eventResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokens.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              summary: autoSync.event_name,
              location: autoSync.event_location || undefined,
              start: {
                dateTime: selectedOption.start_time,
                timeZone: autoSync.timezone
              },
              end: {
                dateTime: selectedOption.end_time || selectedOption.start_time,
                timeZone: autoSync.timezone
              },
              attendees: attendeeEmails,
              description: `Auto Sync event: ${autoSync.event_name}`
            })
          });
          
          if (eventResponse.ok) {
            calendarEventCreated = true;
            const calendarEventData = await eventResponse.json();
            const calendarEventLink = calendarEventData.htmlLink || null;
            const calendarEventId = calendarEventData.id || null;
            
            console.log('Calendar event created successfully', {
              eventId: calendarEventId,
              hasLink: !!calendarEventLink
            });
            
            // Update the events table with the Google Calendar event link
            if (newEvent && calendarEventLink) {
              const { error: updateError } = await supabase
                .from('events')
                .update({
                  google_calendar_event_link: calendarEventLink
                })
                .eq('id', newEvent.id);
              
              if (updateError) {
                console.error('Failed to save Google Calendar event link:', updateError);
              } else {
                console.log('Google Calendar event link saved to events table:', calendarEventLink);
              }
            } else {
              console.warn('Cannot save calendar event link:', {
                hasNewEvent: !!newEvent,
                hasCalendarEventLink: !!calendarEventLink,
                newEventId: newEvent?.id
              });
            }
          } else {
            const errorText = await eventResponse.text();
            throw new Error(`Calendar API error: ${eventResponse.status} - ${errorText}`);
          }
        } else {
          console.log('No calendar tokens found - skipping calendar event creation');
        }
      }
    } catch (error) {
      console.error('Error creating calendar event:', error);
      calendarError = error;
      // Continue - don't fail the entire operation
      // Auto sync will still be marked as completed
    }
    
    // Mark as completed (always, even if calendar failed)
    await supabase
      .from('auto_syncs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', autoSyncId);
    
    // Format date/time for response
    const dateStr = startTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    // Send confirmation message to organizer (always, regardless of calendar/invitation success)
    let message = `You're invited to ${autoSync.event_name} on ${dateStr} at ${timeStr}.`;
    if (calendarEventCreated) {
      message += ' Calendar invite sent.';
    } else if (invitationsSent) {
      message += ' Invitations sent.';
    } else {
      message += ' Event created.';
    }
    
    if (organizer?.phone_number) {
      await sendSMS(organizer.phone_number, message, true, undefined);
    }
    
    return {
      response: message,
      shouldSendSMS: true
    };
  } catch (error) {
    console.error('Error in handleAutoSyncSendInvitesWithOption:', error);
    return {
      response: 'Failed to send invites. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Handle stopping Auto Sync
 */
export async function handleAutoSyncStop(
  supabase: any,
  userId: string,
  phoneNumber: string,
  autoSyncId: string,
  confirmed: boolean = false
): Promise<{ response: string, shouldSendSMS: boolean, conversationState?: any }> {
  try {
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('*')
      .eq('id', autoSyncId)
      .eq('organizer_id', userId)
      .single();
    
    if (!autoSync) {
      return {
        response: 'Auto Sync not found.',
        shouldSendSMS: true
      };
    }
    
    if (!confirmed) {
      // Show confirmation prompt
      const conversationState = {
        waiting_for: 'auto_sync_stop_confirmation',
        current_state: 'auto_sync_management',
        extracted_data: [{
          action: 'AUTO_SYNC_STOP',
          auto_sync_id: autoSyncId,
          event_name: autoSync.event_name
        }]
      };
      
      return {
        response: `Stop Auto Sync for ${autoSync.event_name}? Reply yes to confirm, or exit.`,
        shouldSendSMS: true,
        conversationState
      };
    }
    
    // Confirm stop
    await supabase
      .from('auto_syncs')
      .update({
        status: 'stopped',
        stopped_at: new Date().toISOString()
      })
      .eq('id', autoSyncId);
    
    return {
      response: `Auto Sync stopped for ${autoSync.event_name}.`,
      shouldSendSMS: true
    };
  } catch (error) {
    console.error('Error in handleAutoSyncStop:', error);
    return {
      response: 'Failed to stop Auto Sync. Please try again.',
      shouldSendSMS: true
    };
  }
}

/**
 * Auto-complete auto sync when all invitees respond
 */
async function autoCompleteAutoSync(
  supabase: any,
  autoSyncId: string,
  organizerId: string
): Promise<void> {
  try {
    console.log(`[autoCompleteAutoSync] Starting for sync ${autoSyncId}, organizer ${organizerId}`);
    // Get auto sync
    const { data: autoSync } = await supabase
      .from('auto_syncs')
      .select('*')
      .eq('id', autoSyncId)
      .single();
    
    if (!autoSync) {
      console.log(`[autoCompleteAutoSync] Auto sync ${autoSyncId} not found`);
      return;
    }
    
    if (autoSync.status !== 'running') {
      console.log(`[autoCompleteAutoSync] Auto sync ${autoSyncId} status is ${autoSync.status}, not running. Skipping.`);
      return; // Already completed or not running
    }
    
    console.log(`[autoCompleteAutoSync] Auto sync ${autoSyncId} is running, proceeding with completion`);
    
    // Get all responses to determine best time option
    const { data: responses } = await supabase
      .from('auto_sync_responses')
      .select('option_ids, response_type')
      .eq('auto_sync_id', autoSyncId)
      .eq('response_type', 'available');
    
    // Count votes per option
    const optionVotes: { [optionId: string]: number } = {};
    responses?.forEach((r: any) => {
      if (r.option_ids && Array.isArray(r.option_ids)) {
        r.option_ids.forEach((optId: string) => {
          optionVotes[optId] = (optionVotes[optId] || 0) + 1;
        });
      }
    });
    
    // Get best option (most votes, or first option if tie)
    const { data: options } = await supabase
      .from('auto_sync_options')
      .select('*')
      .eq('auto_sync_id', autoSyncId)
      .order('idx');
    
    let bestOption = options?.[0]; // Default to first option
    if (options && Object.keys(optionVotes).length > 0) {
      const sortedOptions = [...options].sort((a, b) => {
        const votesA = optionVotes[a.id] || 0;
        const votesB = optionVotes[b.id] || 0;
        return votesB - votesA; // Descending
      });
      bestOption = sortedOptions[0];
    }
    
    // TODO: Create calendar event and send invites
    // For now, just mark as completed
    
    // Update status to completed
    await supabase
      .from('auto_syncs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', autoSyncId);
    
    // Get organizer phone to send confirmation
    const { data: organizer } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('id', organizerId)
      .single();
    
    if (organizer?.phone_number && bestOption) {
      const startTime = new Date(bestOption.start_time);
      const dateStr = startTime.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      const timeStr = startTime.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
      
      const message = `You're invited to ${autoSync.event_name} on ${dateStr} at ${timeStr}. Calendar invite sent.`;
      await sendSMS(organizer.phone_number, message, true, undefined);
      
      console.log(`Auto-completed auto sync ${autoSyncId} - all invitees responded`);
    }
  } catch (error) {
    console.error('Error in autoCompleteAutoSync:', error);
    // Don't throw - allow response to be saved even if auto-complete fails
  }
}

