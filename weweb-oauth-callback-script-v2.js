// WeWeb OAuth Callback Script v2
// IMPORTANT: provider_refresh_token is NOT in URL hash - must get from Supabase session!
// Add this to your WeWeb page that handles the OAuth callback

(function() {
  console.log('🔐 OAuth Callback Handler - Starting...');
  
  // Step 1: Extract tokens from URL hash
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  
  const accessToken = hashParams.get('access_token'); // Supabase JWT
  const providerToken = hashParams.get('provider_token'); // Google access token
  const refreshToken = hashParams.get('refresh_token'); // Supabase refresh token (NOT Google!)
  const expiresAt = hashParams.get('expires_at');
  const expiresIn = hashParams.get('expires_in');
  const tokenType = hashParams.get('token_type');
  
  console.log('📋 URL Hash Parameters:', {
    hasAccessToken: !!accessToken,
    hasProviderToken: !!providerToken,
    hasRefreshToken: !!refreshToken,
    refreshTokenLength: refreshToken?.length || 0
  });
  
  // Check if we have the required tokens
  if (!accessToken || !providerToken) {
    console.error('❌ Missing required tokens in OAuth callback');
    return;
  }
  
  // Extract user_id from Supabase access_token JWT (decode payload)
  let userId = null;
  try {
    const jwtParts = accessToken.split('.');
    if (jwtParts.length === 3) {
      const payload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
      userId = payload.sub; // 'sub' is the user_id in Supabase JWT
      console.log('✅ User ID extracted:', userId);
    }
  } catch (e) {
    console.error('❌ Failed to extract user_id from access_token:', e);
    return;
  }
  
  if (!userId) {
    console.error('❌ Could not extract user_id from access_token');
    return;
  }
  
  // Step 2: Get provider_refresh_token from Supabase session
  // CRITICAL: provider_refresh_token is NOT in URL hash, only in session!
  console.log('🔍 Getting provider_refresh_token from Supabase session...');
  
  // Initialize Supabase client
  const supabaseUrl = 'https://jjkduivjlzazcvdeeqde.supabase.co';
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs';
  
  // Load Supabase client (adjust based on your setup)
  // If using CDN: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  if (typeof supabase === 'undefined') {
    console.error('❌ Supabase client not loaded. Make sure to include @supabase/supabase-js');
    console.log('💡 Add this to your page: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>');
    return;
  }
  
  const supabaseClient = supabase.createClient(supabaseUrl, anonKey);
  
  // Get session to extract provider_refresh_token
  supabaseClient.auth.getSession().then(({ data: { session }, error }) => {
    if (error) {
      console.error('❌ Error getting session:', error);
      return;
    }
    
    if (!session) {
      console.error('❌ No session found');
      return;
    }
    
    console.log('✅ Session retrieved');
    
    // Extract provider_refresh_token from session (NOT from URL hash!)
    const providerRefreshToken = session.provider_refresh_token;
    const providerTokenScope = session.provider_token_scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events';
    
    console.log('📋 Session Tokens:', {
      hasProviderToken: !!session.provider_token,
      hasProviderRefreshToken: !!providerRefreshToken,
      providerRefreshTokenLength: providerRefreshToken?.length || 0,
      scope: providerTokenScope
    });
    
    if (!providerRefreshToken) {
      console.warn('⚠️  No provider_refresh_token in session!');
      console.warn('   OAuth may not have been done with access_type=offline');
      console.warn('   User needs to re-authenticate with access_type=offline');
      
      // Still store what we have, but warn user
      console.log('💡 Storing tokens without refresh_token (will need re-auth later)');
    } else {
      // Validate it's a Google token (50+ characters)
      if (providerRefreshToken.length < 20) {
        console.warn('⚠️  provider_refresh_token appears to be too short');
        console.warn(`   Length: ${providerRefreshToken.length} (expected 50+ for Google token)`);
      } else {
        console.log('✅ Valid Google provider_refresh_token found!');
      }
    }
    
    // Step 3: Store tokens via Edge Function
    console.log('💾 Storing tokens in database...');
    
    fetch(`${supabaseUrl}/functions/v1/store-google-calendar-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`, // Use Supabase JWT from URL
        'Content-Type': 'application/json',
        'apikey': anonKey
      },
      body: JSON.stringify({
        user_id: userId,
        provider_token: providerToken, // From URL hash
        provider_refresh_token: providerRefreshToken || null, // From session (NOT URL hash!)
        expires_at: expiresAt ? parseInt(expiresAt) : null,
        expires_in: expiresIn ? parseInt(expiresIn) : 3600,
        scope: providerTokenScope
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log('✅ Google Calendar tokens stored successfully!', data);
        
        if (providerRefreshToken) {
          console.log('✅ Refresh token stored - tokens can be refreshed automatically');
        } else {
          console.warn('⚠️  No refresh token stored - user will need to re-authenticate when token expires');
        }
        
        // Optionally trigger a WeWeb event or update state
        // window.dispatchEvent(new CustomEvent('calendarTokensStored', { detail: data }));
        
        // Redirect to success page or update UI
        // window.location.href = '/dashboard';
      } else {
        console.error('❌ Failed to store tokens:', data);
      }
    })
    .catch(error => {
      console.error('❌ Error storing tokens:', error);
    });
    
    // Clean up URL hash (optional - removes tokens from URL for security)
    // window.history.replaceState(null, '', window.location.pathname);
  });
})();




