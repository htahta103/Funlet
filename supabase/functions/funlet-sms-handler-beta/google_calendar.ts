/**
 * Google Calendar API Helper Module
 * 
 * Provides functions to:
 * - Retrieve and automatically refresh Google Calendar tokens
 * - Fetch calendar events
 * - Check calendar availability
 * - Get calendar timezone
 * - Validate and refresh expired tokens
 * 
 * IMPORTANT: Token Types
 * - Supabase OAuth returns:
 *   - access_token: Supabase JWT (for Supabase API)
 *   - provider_token: Google access token (for Google Calendar API)
 *   - refresh_token: Supabase refresh token (for Supabase session)
 *   - provider_refresh_token: Google refresh token (for Google Calendar API) ← USE THIS!
 * 
 * The google_calendar_tokens table stores:
 * - access_token: Google access token (from provider_token)
 * - refresh_token: Google refresh token (from provider_refresh_token)
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface GoogleCalendarToken {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  token_type: string;
  scope: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
}

export interface CalendarEventsResponse {
  items: CalendarEvent[];
  timeZone: string;
}

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

/**
 * Extract Google provider tokens from Supabase OAuth session
 * 
 * When using Supabase OAuth, the session contains:
 * - provider_token: Google access token
 * - provider_refresh_token: Google refresh token (use this for Google Calendar!)
 * 
 * NOTE: refresh_token in session is for Supabase, NOT for Google
 */
export function extractProviderTokensFromSession(session: any): {
  providerToken: string | null;
  providerRefreshToken: string | null;
  expiresAt: number | null;
  expiresIn: number | null;
} {
  return {
    providerToken: session?.provider_token || null,
    providerRefreshToken: session?.provider_refresh_token || null, // ← This is the Google refresh token!
    expiresAt: session?.expires_at || null,
    expiresIn: session?.expires_in || null,
  };
}

/**
 * Store Google Calendar tokens from Supabase OAuth session
 * 
 * Extracts provider_token and provider_refresh_token from session
 * and stores them in google_calendar_tokens table
 */
export async function storeTokensFromSession(
  supabase: any,
  userId: string,
  session: any
): Promise<boolean> {
  try {
    const { providerToken, providerRefreshToken, expiresAt, expiresIn } = 
      extractProviderTokensFromSession(session);

    if (!providerToken) {
      console.error('No provider_token in session');
      return false;
    }

    // Calculate expires_at if not provided
    const expiresAtISO = expiresAt 
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString();

    const { error } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: userId,
        access_token: providerToken, // Google access token
        refresh_token: providerRefreshToken, // Google refresh token (from provider_refresh_token)
        expires_at: expiresAtISO,
        token_type: 'Bearer',
        scope: session?.provider_token_scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Failed to store tokens:', error);
      return false;
    }

    console.log('Google Calendar tokens stored successfully');
    return true;
  } catch (error) {
    console.error('Error storing tokens from session:', error);
    return false;
  }
}

/**
 * Try to get provider_refresh_token from current Supabase session
 * 
 * According to Supabase docs: https://supabase.com/docs/guides/auth/social-login/auth-google
 * The session contains provider_refresh_token when OAuth was done with access_type=offline
 * 
 * This can be used to update the database if we have an active session
 */
export async function getProviderRefreshTokenFromSession(
  supabase: any,
  userId: string
): Promise<string | null> {
  try {
    // Get current session
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('No active session found');
      return null;
    }

    // Check if session is for the correct user
    if (session.user.id !== userId) {
      console.log('Session user does not match requested user');
      return null;
    }

    // Extract provider_refresh_token from session
    const providerRefreshToken = (session as any).provider_refresh_token;
    
    if (!providerRefreshToken) {
      console.log('No provider_refresh_token in session. OAuth may not have been done with access_type=offline');
      return null;
    }

    // Validate it's a Google token (50+ characters)
    if (providerRefreshToken.length < 20) {
      console.warn('⚠️  provider_refresh_token appears to be too short. Expected Google token (50+ chars)');
      return null;
    }

    console.log('✅ Found provider_refresh_token in session');
    return providerRefreshToken;
  } catch (error) {
    console.error('Error getting provider_refresh_token from session:', error);
    return null;
  }
}

/**
 * Update stored tokens with provider_refresh_token from current session
 * 
 * If user has an active Supabase session with provider_refresh_token,
 * we can update the database without requiring re-authentication
 */
export async function updateTokensFromCurrentSession(
  supabase: any,
  userId: string
): Promise<boolean> {
  try {
    const providerRefreshToken = await getProviderRefreshTokenFromSession(supabase, userId);
    
    if (!providerRefreshToken) {
      console.error('Could not get provider_refresh_token from session');
      return false;
    }

    // Get current session to also get provider_token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return false;
    }

    const providerToken = (session as any).provider_token;
    if (!providerToken) {
      console.error('No provider_token in session');
      return false;
    }

    // Calculate expiration
    const expiresAt = session.expires_at 
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    // Update database with correct tokens
    const { error } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: userId,
        access_token: providerToken,
        refresh_token: providerRefreshToken, // Google provider_refresh_token
        expires_at: expiresAt,
        token_type: 'Bearer',
        scope: (session as any).provider_token_scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Failed to update tokens from session:', error);
      return false;
    }

    console.log('✅ Updated tokens from current session');
    return true;
  } catch (error) {
    console.error('Error updating tokens from session:', error);
    return false;
  }
}

/**
 * Get access token for user, automatically refreshing if expired
 * This is the main function to use - it handles token refresh automatically
 * 
 * NOTE: Uses refresh_token from database, which should be the Google provider_refresh_token
 * 
 * If refresh fails and user has active session, tries to update from session first
 */
export async function getAccessToken(
  supabase: any,
  userId: string
): Promise<string | null> {
  try {
    // Get tokens from database
    const { data: tokens, error } = await supabase
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .single();

    if (error || !tokens) {
      console.error('No Google Calendar tokens found for user:', userId);
      
      // Try to get from current session if available
      console.log('Attempting to get tokens from current session...');
      const updated = await updateTokensFromCurrentSession(supabase, userId);
      if (updated) {
        // Retry getting tokens
        const { data: newTokens } = await supabase
          .from('google_calendar_tokens')
          .select('access_token, refresh_token, expires_at')
          .eq('user_id', userId)
          .single();
        
        if (newTokens) {
          return newTokens.access_token;
        }
      }
      return null;
    }

    // Check if token is expired
    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer before expiration

    // If token is still valid (with buffer), return it
    if (expiresAt.getTime() > now.getTime() + bufferTime) {
      console.log('Access token is valid');
      return tokens.access_token;
    }

    // Token is expired or about to expire, try to refresh
    if (tokens.refresh_token) {
      // Check if refresh token is valid (Google tokens are 50+ chars)
      if (tokens.refresh_token.length < 20) {
        console.warn('⚠️  Refresh token appears to be Supabase token, not Google token');
        console.log('Attempting to get provider_refresh_token from current session...');
        
        // Try to update from current session
        const updated = await updateTokensFromCurrentSession(supabase, userId);
        if (updated) {
          // Retry refresh with updated token
          const { data: updatedTokens } = await supabase
            .from('google_calendar_tokens')
            .select('refresh_token')
            .eq('user_id', userId)
            .single();
          
          if (updatedTokens?.refresh_token && updatedTokens.refresh_token.length >= 20) {
            return await refreshAccessToken(supabase, userId, updatedTokens.refresh_token);
          }
        }
        
        console.error('Invalid refresh token and could not get from session. User needs to re-authenticate.');
        return null;
      }

      console.log('Access token expired or expiring soon, refreshing...');
      const refreshedToken = await refreshAccessToken(
        supabase,
        userId,
        tokens.refresh_token
      );
      
      if (refreshedToken) {
        return refreshedToken;
      }
      
      // If refresh failed, try to get from current session
      console.log('Refresh failed, attempting to get tokens from current session...');
      const updated = await updateTokensFromCurrentSession(supabase, userId);
      if (updated) {
        const { data: newTokens } = await supabase
          .from('google_calendar_tokens')
          .select('access_token')
          .eq('user_id', userId)
          .single();
        
        return newTokens?.access_token || null;
      }
    }

    console.error('Token expired and no refresh token available');
    return null;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
}

/**
 * Refresh Google Calendar access token using Google refresh token
 * Automatically updates the database with the new token
 * 
 * IMPORTANT: refreshToken must be the Google provider_refresh_token,
 * NOT the Supabase refresh_token!
 * 
 * When using Supabase OAuth:
 * - Supabase session.refresh_token = Supabase refresh token (for Supabase session)
 * - Supabase session.provider_refresh_token = Google refresh token (for Google API) ← USE THIS!
 */
export async function refreshAccessToken(
  supabase: any,
  userId: string,
  refreshToken: string
): Promise<string | null> {
  try {
    // Validate refresh token format
    // Google refresh tokens are typically 50+ characters
    // Supabase refresh tokens are typically 12-13 characters
    if (refreshToken.length < 20) {
      console.error('⚠️  Refresh token appears to be a Supabase token, not a Google token!');
      console.error('   Google refresh tokens are typically 50+ characters.');
      console.error('   Make sure you stored provider_refresh_token, not refresh_token from Supabase session.');
      return null;
    }

    // Get Google OAuth client credentials from environment
    // These should be set in Supabase Edge Function secrets
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('Google OAuth credentials not configured');
      console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase Edge Function secrets');
      return null;
    }

    console.log('Calling Google OAuth2 token refresh endpoint...');
    console.log('Refresh token length:', refreshToken.length, 'characters');

    // Call Google OAuth2 token refresh endpoint
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken, // This should be Google provider_refresh_token
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to refresh token:', response.status, errorText);
      
      // If refresh token is invalid, user needs to re-authenticate
      if (response.status === 400) {
        console.error('Refresh token is invalid or expired. User needs to re-authenticate.');
      }
      
      return null;
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600; // Default to 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log('Token refreshed successfully, updating database...');

    // Update token in database
    const { error: updateError } = await supabase
      .from('google_calendar_tokens')
      .update({
        access_token: newAccessToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to update refreshed token in database:', updateError);
      return null;
    }

    console.log('Token refreshed and saved to database');
    return newAccessToken;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return null;
  }
}

/**
 * Validate if an access token is still valid by making a test API call
 * Returns true if token is valid, false otherwise
 */
export async function validateAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Error validating access token:', error);
    return false;
  }
}

// ============================================================================
// CALENDAR API CALLS
// ============================================================================

/**
 * Get calendar events for a time range
 * Automatically handles token refresh if needed
 */
export async function getCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  timezone?: string
): Promise<CalendarEventsResponse | null> {
  try {
    const timeMinISO = timeMin.toISOString();
    const timeMaxISO = timeMax.toISOString();

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', timeMinISO);
    url.searchParams.set('timeMax', timeMaxISO);
    url.searchParams.set('maxResults', '250'); // Max allowed
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    if (timezone) {
      url.searchParams.set('timeZone', timezone);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // If unauthorized, token might be invalid
    if (response.status === 401) {
      console.error('Unauthorized - token may be invalid');
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get calendar events:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return {
      items: data.items || [],
      timeZone: data.timeZone || 'UTC',
    };
  } catch (error) {
    console.error('Error getting calendar events:', error);
    return null;
  }
}

/**
 * Get calendar timezone
 */
export async function getCalendarTimezone(
  accessToken: string
): Promise<string | null> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get calendar timezone:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return data.timeZone || null;
  } catch (error) {
    console.error('Error getting calendar timezone:', error);
    return null;
  }
}

/**
 * Check if a time slot conflicts with existing events
 */
export function checkTimeSlotAvailability(
  events: CalendarEvent[],
  startTime: Date,
  endTime: Date
): { isAvailable: boolean; conflicts: CalendarEvent[] } {
  const conflicts: CalendarEvent[] = [];

  for (const event of events) {
    const eventStart = event.start.dateTime
      ? new Date(event.start.dateTime)
      : new Date(event.start.date!);
    const eventEnd = event.end.dateTime
      ? new Date(event.end.dateTime)
      : new Date(event.end.date!);

    // Check for overlap
    if (
      (startTime >= eventStart && startTime < eventEnd) ||
      (endTime > eventStart && endTime <= eventEnd) ||
      (startTime <= eventStart && endTime >= eventEnd)
    ) {
      conflicts.push(event);
    }
  }

  return {
    isAvailable: conflicts.length === 0,
    conflicts,
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get calendar events for user (with automatic token management)
 * This is the main convenience function - handles everything automatically
 */
export async function getUserCalendarEvents(
  supabase: any,
  userId: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEventsResponse | null> {
  // Get access token (automatically refreshes if expired)
  const accessToken = await getAccessToken(supabase, userId);
  if (!accessToken) {
    console.error('Failed to get access token for user:', userId);
    return null;
  }

  // Get user's calendar timezone
  const timezone = await getCalendarTimezone(accessToken);
  
  // Get events
  return await getCalendarEvents(accessToken, timeMin, timeMax, timezone || undefined);
}

/**
 * Get calendar timezone for user (with automatic token management)
 */
export async function getUserCalendarTimezone(
  supabase: any,
  userId: string
): Promise<string | null> {
  const accessToken = await getAccessToken(supabase, userId);
  if (!accessToken) {
    return null;
  }

  return await getCalendarTimezone(accessToken);
}

/**
 * Check if user has valid calendar connection
 * Returns true if user has valid tokens (even if expired but refreshable)
 * 
 * NOTE: Checks for Google refresh_token in database (should be provider_refresh_token from session)
 */
export async function hasValidCalendarConnection(
  supabase: any,
  userId: string
): Promise<boolean> {
  try {
    const { data: tokens, error } = await supabase
      .from('google_calendar_tokens')
      .select('expires_at, refresh_token')
      .eq('user_id', userId)
      .single();

    if (error || !tokens) {
      return false;
    }

    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();

    // Check if refresh_token is a valid Google token (not Supabase token)
    const hasValidGoogleRefreshToken = tokens.refresh_token && tokens.refresh_token.length >= 20;

    // Valid if: not expired yet OR has valid Google refresh token
    return expiresAt > now || hasValidGoogleRefreshToken;
  } catch (error) {
    console.error('Error checking calendar connection:', error);
    return false;
  }
}
