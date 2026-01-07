// Edge Function to store Google Calendar tokens from OAuth callback
// Uses bearer token (service role key) for authentication, no JWT required
// Accepts user_id and tokens from request body

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('📥 Request received:', {
    method: req.method,
    url: req.url,
    headers: Object.fromEntries(req.headers.entries())
  })

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('✅ CORS preflight request handled')
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    let requestBody: any = null
    try {
      const bodyText = await req.text()
      console.log('📄 Request body received:', {
        bodyLength: bodyText.length,
        bodyPreview: bodyText.substring(0, 200)
      })
      
      if (!bodyText) {
        console.error('❌ Empty request body')
        return new Response(JSON.stringify({ error: 'Request body is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      requestBody = JSON.parse(bodyText)
      console.log('✅ Request body parsed successfully:', {
        hasUserId: !!requestBody.user_id,
        hasProviderToken: !!requestBody.provider_token,
        hasProviderRefreshToken: !!requestBody.provider_refresh_token,
        hasSupabaseRefreshToken: !!requestBody.refresh_token,
        hasExpiresAt: !!requestBody.expires_at,
        hasExpiresIn: !!requestBody.expires_in,
        hasScope: !!requestBody.scope,
        providerRefreshTokenPreview: requestBody.provider_refresh_token 
          ? `${requestBody.provider_refresh_token.substring(0, 20)}...` 
          : 'not provided',
        supabaseRefreshTokenPreview: requestBody.refresh_token 
          ? `${requestBody.refresh_token.substring(0, 20)}...` 
          : 'not provided'
      })
    } catch (e) {
      console.error('❌ Failed to parse request body:', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      })
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        details: e instanceof Error ? e.message : String(e)
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Extract required fields from request body (already parsed above)
    const userId = requestBody.user_id
    const providerToken = requestBody.provider_token
    // provider_refresh_token = Google OAuth provider refresh token (for Google Calendar API)
    const providerRefreshToken = requestBody.provider_refresh_token || null
    // refresh_token = Supabase auth refresh token (from Supabase Auth)
    const supabaseRefreshToken = requestBody.refresh_token || null
    let providerTokenScope = requestBody.provider_token_scope || requestBody.scope || ''
    
    console.log('🔍 Extracting fields from request:', {
      userId: userId ? `${userId.substring(0, 8)}...` : 'missing',
      providerToken: providerToken ? `${providerToken.substring(0, 20)}...` : 'missing',
      providerRefreshToken: providerRefreshToken 
        ? `${providerRefreshToken.substring(0, 20)}...` 
        : 'missing',
      providerRefreshTokenLength: providerRefreshToken ? providerRefreshToken.length : 0,
      supabaseRefreshToken: supabaseRefreshToken 
        ? `${supabaseRefreshToken.substring(0, 20)}...` 
        : 'missing',
      supabaseRefreshTokenLength: supabaseRefreshToken ? supabaseRefreshToken.length : 0,
      scope: providerTokenScope || 'not provided'
    })
    
    // Validate required fields
    if (!userId) {
      console.error('❌ Validation failed: user_id is missing')
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!providerToken) {
      console.error('❌ Validation failed: provider_token is missing')
      return new Response(JSON.stringify({ error: 'provider_token is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if calendar scopes are present
    const hasCalendarScope = providerTokenScope.includes('calendar') || 
                             providerTokenScope.includes('calendar.events')
    
    // If no scope provided, assume calendar scopes (for backward compatibility)
    if (!providerTokenScope) {
      console.log('⚠️ No scope provided, using default calendar scopes')
      providerTokenScope = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
    }

    if (!hasCalendarScope) {
      console.warn('⚠️ No calendar scope found in token, but proceeding with default scope')
    }

    console.log('📅 Calculating token expiration:', {
      hasExpiresAt: !!requestBody.expires_at,
      hasExpiresIn: !!requestBody.expires_in,
      expiresAtValue: requestBody.expires_at,
      expiresInValue: requestBody.expires_in
    })

    // Calculate expiration from request body or default to 1 hour
    let expiresAt: string
    if (requestBody.expires_at) {
      // If expires_at is provided as a timestamp, convert it
      const expiresAtNum = typeof requestBody.expires_at === 'number' 
        ? requestBody.expires_at 
        : parseInt(requestBody.expires_at)
      expiresAt = new Date(expiresAtNum * 1000).toISOString()
      console.log('✅ Using expires_at from request:', expiresAt)
    } else if (requestBody.expires_in) {
      // If expires_in is provided (seconds until expiration), calculate from now
      const expiresInSeconds = typeof requestBody.expires_in === 'number'
        ? requestBody.expires_in
        : parseInt(requestBody.expires_in)
      expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      console.log('✅ Using expires_in from request:', { expiresInSeconds, expiresAt })
    } else {
      // Default: 1 hour from now (Google OAuth tokens typically expire in 1 hour)
      expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
      console.log('✅ Using default expiration (1 hour):', expiresAt)
    }

    // Create service role client to store tokens
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    console.log('🔧 Creating Supabase client:', {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      url: supabaseUrl
    })

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('❌ Missing Supabase environment variables:', {
        hasUrl: !!supabaseUrl,
        hasServiceRoleKey: !!serviceRoleKey
      })
      return new Response(JSON.stringify({ 
        error: 'Server configuration error',
        details: 'Missing Supabase environment variables'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey)

    console.log('💾 Attempting to store tokens in database:', {
      userId,
      accessTokenPreview: `${providerToken.substring(0, 20)}...`,
      accessTokenLength: providerToken.length,
      providerRefreshToken: providerRefreshToken 
        ? `${providerRefreshToken.substring(0, 20)}...` 
        : 'not provided',
      providerRefreshTokenLength: providerRefreshToken ? providerRefreshToken.length : 0,
      supabaseRefreshToken: supabaseRefreshToken 
        ? `${supabaseRefreshToken.substring(0, 20)}...` 
        : 'not provided (Supabase auth token, not stored in google_calendar_tokens)',
      expiresAt,
      scope: providerTokenScope
    })

    // Store tokens in google_calendar_tokens table
    // Note: refresh_token column stores provider_refresh_token (Google OAuth refresh token)
    // The Supabase auth refresh_token is logged but not stored in this table
    const { data, error } = await serviceSupabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: userId,
        access_token: providerToken,
        refresh_token: providerRefreshToken, // Stores provider_refresh_token from request
        expires_at: expiresAt,
        token_type: 'Bearer',
        scope: providerTokenScope,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Database error storing tokens:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        userId
      })
      return new Response(JSON.stringify({ 
        error: 'Failed to store tokens', 
        details: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('✅ Google Calendar tokens stored successfully:', {
      userId,
      recordId: data?.id,
      expiresAt: data?.expires_at,
      hasProviderRefreshToken: !!data?.refresh_token,
      providerRefreshTokenStored: data?.refresh_token 
        ? `${data.refresh_token.substring(0, 20)}...` 
        : 'not stored',
      supabaseRefreshTokenProvided: !!supabaseRefreshToken,
      scope: data?.scope
    })

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Google Calendar tokens stored successfully',
      user_id: userId,
      has_provider_refresh_token: !!providerRefreshToken,
      has_supabase_refresh_token: !!supabaseRefreshToken,
      scope: providerTokenScope
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('❌ Unhandled error in store-google-calendar-tokens:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown'
    })
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

