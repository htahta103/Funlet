// Edge Function to handle Google OAuth callback and automatically save tokens
// This function is used as the redirect_to URL in the OAuth flow
// It extracts tokens from Supabase session and saves them to google_calendar_tokens table
// Then redirects to the final WeWeb page

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('📥 Google OAuth Callback - Request received')
  console.log('📋 Request details:', {
    method: req.method,
    url: req.url,
    headers: Object.fromEntries(req.headers.entries())
  })

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('✅ CORS preflight request')
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jjkduivjlzazcvdeeqde.supabase.co'
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs'
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!serviceRoleKey) {
      console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({
        error: 'Server configuration error',
        details: 'Missing SUPABASE_SERVICE_ROLE_KEY'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse URL to extract parameters
    // Note: Server cannot read URL hash (#), so we rely on query params or Authorization header
    const url = new URL(req.url)
    console.log('🔍 Full URL:', url.toString())
    console.log('🔍 URL pathname:', url.pathname)
    console.log('🔍 URL search:', url.search)
    console.log('🔍 URL hash:', url.hash || 'none (server cannot read hash)')
    console.log('🔍 All query params:', Object.fromEntries(url.searchParams.entries()))

    const accessToken = url.searchParams.get('access_token')
    const code = url.searchParams.get('code') // Authorization code (if using code flow)
    const error = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')

    // Get redirect_uri from callback URL query params (set by get-google-oauth-url)
    // This avoids state parameter issues with Supabase's OAuth flow
    const redirectUri = url.searchParams.get('redirect_uri')
    const userIdFromUrl = url.searchParams.get('user_id')

    console.log('📋 Callback parameters:', {
      hasAccessToken: !!accessToken,
      hasCode: !!code,
      hasError: !!error,
      error: error || 'none',
      errorDescription: errorDescription || 'none',
      redirectUri: redirectUri || 'not provided',
      userIdFromUrl: userIdFromUrl || 'not provided',
      allQueryParams: Object.fromEntries(url.searchParams.entries())
    })

    // If there's an error from Supabase, return error page
    if (error) {
      console.error('❌ OAuth error received:', {
        error,
        errorDescription,
        url: req.url
      })
      const errorHtml = `<!DOCTYPE html>
<html>
<head>
  <title>OAuth Error</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
    .error { color: #d32f2f; }
  </style>
</head>
<body>
  <h1 class="error">OAuth Error</h1>
  <p>Error: ${error}</p>
  <p>${errorDescription || 'Unknown error'}</p>
  <p><small>Check Supabase logs and ensure callback URL is registered in Supabase Dashboard</small></p>
</body>
</html>`
      return new Response(errorHtml, {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // Return loading HTML page immediately
    // Tokens are in URL hash (client-side only), so we process them client-side
    // The redirect_uri is passed in the callback URL query params
    const encodedRedirectUri = redirectUri ? encodeURIComponent(redirectUri) : ''
    const loadingHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Connecting Google Calendar...</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    .spinner {
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid #fff;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 { font-size: 24px; margin-bottom: 10px; }
    p { font-size: 16px; opacity: 0.9; }
    .error { color: #ff6b6b; margin-top: 20px; }
    .success { color: #51cf66; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Connecting Google Calendar...</h1>
    <p id="status">Processing authentication...</p>
    <div id="error" class="error" style="display: none;"></div>
  </div>
  <script>
    (function() {
      const supabaseUrl = '${supabaseUrl}';
      const anonKey = '${anonKey}';
      const redirectUri = ${redirectUri ? `decodeURIComponent('${encodedRedirectUri}')` : 'null'};
      
      const statusEl = document.getElementById('status');
      const errorEl = document.getElementById('error');
      
      console.log('🔍 Current URL:', window.location.href);
      console.log('🔍 Redirect URI:', redirectUri);
      
      // Extract tokens from URL hash
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const providerToken = hashParams.get('provider_token');
      const providerRefreshToken = hashParams.get('provider_refresh_token');
      const expiresAt = hashParams.get('expires_at');
      const expiresIn = hashParams.get('expires_in');
      const scope = hashParams.get('provider_token_scope') || hashParams.get('scope');
      
      console.log('📋 Hash params:', {
        hasAccessToken: !!accessToken,
        hasProviderToken: !!providerToken,
        hasProviderRefreshToken: !!providerRefreshToken,
        allHashParams: Object.fromEntries(hashParams.entries())
      });
      
      console.log('📋 Extracted tokens from hash:', {
        hasAccessToken: !!accessToken,
        hasProviderToken: !!providerToken,
        hasProviderRefreshToken: !!providerRefreshToken
      });
      
      // Check if we have required tokens
      if (!accessToken || !providerToken) {
        const errorMsg = 'Missing required tokens in OAuth callback';
        console.error('❌', errorMsg);
        statusEl.textContent = 'Error: Missing tokens';
        errorEl.textContent = errorMsg;
        errorEl.style.display = 'block';
        return;
      }
      
      // Extract user_id from access_token JWT
      let userId = null;
      try {
        const jwtParts = accessToken.split('.');
        if (jwtParts.length === 3) {
          const payload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
          userId = payload.sub;
          console.log('✅ User ID extracted:', userId);
        }
      } catch (e) {
        console.error('❌ Failed to extract user_id:', e);
        statusEl.textContent = 'Error: Invalid token';
        errorEl.textContent = 'Could not extract user ID from token';
        errorEl.style.display = 'block';
        return;
      }
      
      if (!userId) {
        const errorMsg = 'Could not extract user ID';
        console.error('❌', errorMsg);
        statusEl.textContent = 'Error: Invalid token';
        errorEl.textContent = errorMsg;
        errorEl.style.display = 'block';
        return;
      }
      
      // Update status
      statusEl.textContent = 'Saving tokens...';
      
      // Call store-google-calendar-tokens function to save to database
      // This function uses service role key, so no JWT needed in Authorization header
      fetch(supabaseUrl + '/functions/v1/store-google-calendar-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey
        },
        body: JSON.stringify({
          user_id: userId,
          provider_token: providerToken,
          provider_refresh_token: providerRefreshToken || null,
          expires_at: expiresAt ? parseInt(expiresAt) : null,
          expires_in: expiresIn ? parseInt(expiresIn) : 3600,
          scope: scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success || data.user_id) {
          console.log('✅ Tokens stored successfully:', data);
          statusEl.textContent = 'Success! Redirecting...';
          statusEl.className = 'success';
          
          // ✅ Tokens are now saved to database (including provider_refresh_token)
          // ✅ Now redirect to WeWeb WITH the original hash so WeWeb can process session
          // This gives us the best of both worlds:
          // 1. provider_refresh_token is safely stored in DB
          // 2. WeWeb gets the hash it needs for Supabase session
          if (redirectUri) {
            console.log('🔄 Tokens saved to database successfully');
            console.log('🔄 provider_refresh_token is now stored in google_calendar_tokens table');
            console.log('🔄 Redirecting to WeWeb WITH hash:', redirectUri);
            
            // Preserve the hash (tokens) when redirecting to WeWeb
            // WeWeb needs access_token, refresh_token for session
            // provider_refresh_token is already saved to DB, so it's OK if WeWeb loses it
            const currentHash = window.location.hash;
            let finalRedirectUrl = redirectUri;
            
            try {
              const redirectUrlObj = new URL(redirectUri);
              // Remove any existing hash and append current hash
              finalRedirectUrl = redirectUri.replace(redirectUrlObj.hash, '') + currentHash;
            } catch (e) {
              // If redirectUri is not a full URL, just append hash
              finalRedirectUrl = redirectUri + currentHash;
            }
            
            console.log('🔄 Final redirect URL with hash:', finalRedirectUrl.substring(0, 100) + '...');
            console.log('✅ KEY: provider_refresh_token is saved in DB, WeWeb session will work');
            
            setTimeout(() => {
              window.location.href = finalRedirectUrl;
            }, 1000);
          } else {
            statusEl.textContent = 'Success! Tokens saved.';
            statusEl.className = 'success';
            console.log('⚠️  No redirect URI provided - tokens saved to database');
          }
        } else {
          throw new Error(data.error || data.details || 'Failed to store tokens');
        }
      })
      .catch(error => {
        console.error('❌ Error storing tokens:', error);
        statusEl.textContent = 'Error saving tokens';
        errorEl.textContent = error.message || 'Failed to save tokens. Please try again.';
        errorEl.style.display = 'block';
        
        // Even if DB save fails, still redirect with hash so WeWeb can at least create session
        // provider_refresh_token won't be in DB but user can still use the app (until token expires)
        if (redirectUri) {
          console.log('⚠️  DB store failed, redirecting with hash anyway for session');
          const currentHash = window.location.hash;
          setTimeout(() => {
            window.location.href = redirectUri + currentHash;
          }, 2000);
        }
      });
    })();
  </script>
</body>
</html>`

    // Return loading page immediately (tokens will be processed client-side from hash)
    // NOTE: Since Supabase redirects with tokens in URL hash (client-side only),
    // we return HTML immediately that processes tokens client-side and redirects
    return new Response(loadingHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
      },
    })

  } catch (error) {
    console.error('❌ Unhandled error in google-oauth-callback:', error)
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

