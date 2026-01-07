// Edge Function to generate Supabase Google OAuth authorization URL
// Input: redirect_uri (required)
// Output: Supabase OAuth URL that returns Supabase access_token + provider_token in URL hash
// 
// NOTE: This function is PUBLIC - no authentication required
// Users can call it before logging in to get the OAuth URL
// Use 'apikey' header instead of 'Authorization: Bearer'
//
// The returned URL will redirect to your redirect_uri with:
// #access_token=SUPABASE_JWT&provider_token=GOOGLE_TOKEN&refresh_token=SUPABASE_REFRESH_TOKEN&...
//
// Documentation: https://supabase.com/docs/guides/auth/social-login/auth-google
// 
// To get provider_refresh_token, this function includes:
// - queryParams: { access_type: 'offline', prompt: 'consent' }
// Reference: https://supabase.com/docs/guides/auth/social-login/auth-google#saving-google-tokens

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('📥 Get Google OAuth URL - Request received')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // This function doesn't require authentication - it's public
  // Users can call it before logging in to get the OAuth URL

  try {
    // Parse request body
    let requestBody: any = {}
    try {
      const bodyText = await req.text()
      if (bodyText) {
        requestBody = JSON.parse(bodyText)
      }
    } catch (e) {
      // No body or invalid JSON, continue
    }

    // Get parameters
    const redirectUri = requestBody.redirect_uri || requestBody.redirectUri
    const userId = requestBody.user_id || requestBody.userId
    const scope = requestBody.scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'

    console.log('📋 Request parameters:', {
      hasRedirectUri: !!redirectUri,
      redirectUri: redirectUri || 'not provided',
      hasUserId: !!userId,
      userId: userId || 'not provided',
      scope: scope
    })

    // Get Supabase URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jjkduivjlzazcvdeeqde.supabase.co'

    // Require redirect_uri
    if (!redirectUri) {
      return new Response(JSON.stringify({
        error: 'Missing redirect_uri',
        details: 'redirect_uri must be provided in request body'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use Cloudflare Pages to handle OAuth response
    // Cloudflare Pages extracts tokens from hash and saves them to database
    // Then redirects to final destination (WeWeb/app) with hash preserved
    const cloudflarePagesUrl = 'https://funlet-redirect.pages.dev'
    const callbackUrl = new URL(cloudflarePagesUrl)
    
    // Pass final redirect_uri as query param so Cloudflare Pages knows where to redirect
    if (redirectUri) {
      callbackUrl.searchParams.set('redirect_uri', redirectUri)
    }
    if (userId) {
      callbackUrl.searchParams.set('user_id', userId)
    }
    const callbackUrlString = callbackUrl.toString()

    console.log('🔥 Using Cloudflare Pages callback:', callbackUrlString)

    console.log('🔗 Building Supabase OAuth URL:', {
      supabaseUrl: supabaseUrl,
      cloudflarePagesUrl: callbackUrlString,
      redirectUri: redirectUri,
      hasUserId: !!userId,
      scope
    })

    // Build Supabase OAuth authorization URL
    // Following Supabase documentation: https://supabase.com/docs/guides/auth/social-login/auth-google
    // This will return Supabase access_token + provider_token in URL hash
    const authUrl = new URL(`${supabaseUrl}/auth/v1/authorize`)

    // Required parameters for Supabase OAuth
    // Redirect to Cloudflare Pages, which will save tokens and redirect to the final redirect_uri
    authUrl.searchParams.set('provider', 'google')
    authUrl.searchParams.set('redirect_to', callbackUrlString)

    // Add scopes for Google Calendar
    // Supabase expects space-separated scopes
    // Default scopes: openid, .../auth/userinfo.email, .../auth/userinfo.profile
    // Additional scopes for Calendar API
    const scopes = scope.split(',').map(s => s.trim()).join(' ')
    if (scopes) {
      authUrl.searchParams.set('scopes', scopes)
    }

    // CRITICAL: access_type=offline to get refresh token from Google
    // ✅ CORRECT - Pass Google OAuth params directly to the URL
    // These get forwarded to Google's OAuth endpoint
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    // NOTE: We don't set a custom state parameter
    // Supabase manages state internally for CSRF protection
    // The redirect_uri is encoded in the Cloudflare Pages URL query params
    console.log('✅ Cloudflare Pages URL includes redirect_uri as query parameter')

    const authorizationUrl = authUrl.toString()

    console.log('✅ Authorization URL generated:', {
      urlLength: authorizationUrl.length,
      hasState: !!userId
    })

    // 🔍 DETAILED LOGGING FOR DEBUGGING
    console.log('='.repeat(60))
    console.log('🔍 DEBUGGING - FULL URL DETAILS:')
    console.log('='.repeat(60))
    console.log('📌 Supabase URL:', supabaseUrl)
    console.log('📌 Cloudflare Pages Callback (redirect_to):', callbackUrlString)
    console.log('📌 Final Destination URL (redirect_uri param):', redirectUri)
    console.log('📌 Full Authorization URL:', authorizationUrl)
    console.log('='.repeat(60))
    console.log('🔑 After Google auth, Supabase SHOULD redirect to:')
    console.log(`   ${callbackUrlString}#access_token=...&provider_token=...`)
    console.log('🔑 Then Cloudflare Pages will:')
    console.log('   1. Extract tokens from hash')
    console.log('   2. Save tokens to database via store-google-calendar-tokens')
    console.log('   3. Redirect to:', `${redirectUri}#access_token=...`)
    console.log('='.repeat(60))

    return new Response(JSON.stringify({
      success: true,
      authorization_url: authorizationUrl,
      redirect_uri: redirectUri,
      callback_url: callbackUrlString,
      scope: scopes,
      flow_type: 'supabase_oauth_with_cloudflare_pages',
      parameters: {
        provider: 'google',
        redirect_to: callbackUrlString,
        scopes: scopes,
        access_type: 'offline',
        prompt: 'consent',
        note: 'redirect_uri is encoded in Cloudflare Pages URL query params, not in state'
      },
      instructions: {
        step1: 'Redirect user to authorization_url',
        step2: 'User authorizes with Google via Supabase',
        step3: `Supabase redirects to Cloudflare Pages: ${callbackUrlString}#access_token=...&provider_token=...`,
        step4: 'Cloudflare Pages extracts tokens from hash and saves to database via store-google-calendar-tokens',
        step5: `Cloudflare Pages redirects to: ${redirectUri} with tokens in hash preserved`
      },
      tokens_explained: {
        access_token: 'Supabase JWT token - use for Supabase API authentication',
        provider_token: 'Google OAuth access token - use for Google Calendar API',
        provider_refresh_token: 'Google OAuth refresh token - stored in database for token refresh',
        refresh_token: 'Supabase refresh token - use to refresh Supabase session',
        expires_at: 'Unix timestamp when access_token expires',
        expires_in: 'Seconds until access_token expires (typically 3600)'
      },
      note: `✅ Using Supabase OAuth with Cloudflare Pages redirect: OAuth redirects to Cloudflare Pages which automatically saves tokens, then redirects to ${redirectUri}. Make sure Google OAuth is configured in Supabase Dashboard (Authentication → Providers → Google) and the Cloudflare Pages URL is added to Supabase redirect URLs. Reference: https://supabase.com/docs/guides/auth/social-login/auth-google`,
      documentation: {
        setup: 'https://supabase.com/docs/guides/auth/social-login/auth-google#project-setup',
        saving_tokens: 'https://supabase.com/docs/guides/auth/social-login/auth-google#saving-google-tokens',
        redirect_uri: 'Add Cloudflare Pages URL to Supabase Dashboard: Authentication → URL Configuration → Redirect URLs',
        cloudflare_pages: 'Cloudflare Pages site: https://funlet-redirect.pages.dev'
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('❌ Error:', error)
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})



