// WeWeb OAuth Callback Script
// Add this to your WeWeb page that handles the OAuth callback
// This script extracts tokens from the URL hash and stores them via the Edge Function

(function() {
  // Extract parameters from URL hash
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  
  const accessToken = hashParams.get('access_token');
  const providerToken = hashParams.get('provider_token');
  const refreshToken = hashParams.get('refresh_token');
  const expiresAt = hashParams.get('expires_at');
  const expiresIn = hashParams.get('expires_in');
  const tokenType = hashParams.get('token_type');
  
  // Check if we have the required tokens
  if (!accessToken || !providerToken) {
    console.error('Missing required tokens in OAuth callback');
    return;
  }
  
  // Extract user_id from Supabase access_token JWT (decode payload)
  let userId = null;
  try {
    const jwtParts = accessToken.split('.');
    if (jwtParts.length === 3) {
      const payload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
      userId = payload.sub; // 'sub' is the user_id in Supabase JWT
    }
  } catch (e) {
    console.error('Failed to extract user_id from access_token:', e);
    return;
  }
  
  if (!userId) {
    console.error('Could not extract user_id from access_token');
    return;
  }
  
  // Verify it's a Google token (starts with ya29)
  const isGoogleToken = providerToken && providerToken.startsWith('ya29');
  
  if (!isGoogleToken) {
    console.warn('Provider token does not appear to be a Google OAuth token');
  }
  
  // Call the Edge Function to store tokens
  // NOTE: Replace anonKey with your actual Supabase anon key
  // This should be stored securely in WeWeb environment variables
  const supabaseUrl = 'https://jjkduivjlzazcvdeeqde.supabase.co';
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs';
  
  fetch(`${supabaseUrl}/functions/v1/store-google-calendar-tokens`, {
    method: 'POST',
    headers: {
      'apikey': anonKey, // Use anon key to bypass gateway JWT check
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_id: userId, // Required: user_id extracted from JWT
      provider_token: providerToken,
      provider_refresh_token: refreshToken || null,
      expires_at: expiresAt ? parseInt(expiresAt) : null,
      expires_in: expiresIn ? parseInt(expiresIn) : 3600,
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events' // Default calendar scopes
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log('✅ Google Calendar tokens stored successfully:', data);
      // Optionally trigger a WeWeb event or update state
      // window.dispatchEvent(new CustomEvent('calendarTokensStored', { detail: data }));
    } else {
      console.error('❌ Failed to store tokens:', data);
    }
  })
  .catch(error => {
    console.error('❌ Error storing tokens:', error);
  });
  
  // Clean up URL hash (optional - removes tokens from URL for security)
  // window.history.replaceState(null, '', window.location.pathname);
})();