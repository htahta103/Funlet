// Edge Function to refresh Google provider_token using provider_refresh_token from session
// This function extracts provider_refresh_token from the Supabase session and refreshes the Google token

import { createClient } from 'npm:@supabase/supabase-js@2'
import { refreshAccessToken } from '../funlet-sms-handler-beta/google_calendar.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('📥 Refresh Provider Token - Request received')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Supabase credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jjkduivjlzazcvdeeqde.supabase.co'
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ 
        error: 'Missing SUPABASE_SERVICE_ROLE_KEY',
        details: 'SUPABASE_SERVICE_ROLE_KEY must be set in Edge Function secrets'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get user_id from request or extract from Authorization header
    let userId: string | null = null
    
    // Try to get from request body
    let requestBody: any = {}
    try {
      const bodyText = await req.text()
      if (bodyText) {
        requestBody = JSON.parse(bodyText)
        userId = requestBody.user_id || requestBody.userId
      }
    } catch (e) {
      // No body or invalid JSON
    }

    // If no user_id in body, try to extract from Authorization header (Supabase JWT)
    if (!userId) {
      const authHeader = req.headers.get('Authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7)
        try {
          // Decode JWT to get user_id
          const parts = token.split('.')
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
            userId = payload.sub
            console.log('✅ User ID extracted from JWT:', userId)
          }
        } catch (e) {
          console.error('Failed to extract user_id from JWT:', e)
        }
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ 
        error: 'Missing user_id',
        details: 'user_id must be provided in request body or Authorization header'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('🔍 Refreshing provider_token for user:', userId)

    const logs: string[] = []
    logs.push('=== Refresh Provider Token ===')
    logs.push(`User ID: ${userId}`)
    logs.push('')

    // Create Supabase client
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Step 1: Check current tokens in database
    logs.push('📋 Step 1: Checking current tokens in database...')
    const { data: tokens, error: tokensError } = await supabase
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .single()

    if (tokensError || !tokens) {
      logs.push('❌ No tokens found in database')
      logs.push(`Error: ${tokensError?.message || 'No records found'}`)
      logs.push('')
      logs.push('💡 User needs to authenticate with Google OAuth first')
      
      return new Response(JSON.stringify({ 
        success: false,
        message: 'No tokens found in database',
        logs
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    logs.push('✅ Tokens found in database')
    logs.push(`Access Token: ${tokens.access_token.substring(0, 30)}...`)
    logs.push(`Refresh Token: ${tokens.refresh_token ? tokens.refresh_token.substring(0, 30) + '...' : 'NULL'}`)
    logs.push(`Refresh Token Length: ${tokens.refresh_token?.length || 0} characters`)
    logs.push(`Expires At: ${tokens.expires_at}`)
    logs.push('')

    // Step 2: Check if refresh token is valid (Google tokens are 50+ chars)
    if (!tokens.refresh_token) {
      logs.push('❌ No refresh token in database')
      logs.push('   User needs to re-authenticate with access_type=offline')
      
      return new Response(JSON.stringify({ 
        success: false,
        message: 'No refresh token found',
        logs
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (tokens.refresh_token.length < 20) {
      logs.push('⚠️  WARNING: Refresh token appears to be a Supabase token (too short)')
      logs.push(`   Length: ${tokens.refresh_token.length} characters`)
      logs.push('   Expected: Google token (50+ characters)')
      logs.push('')
      logs.push('❌ Cannot refresh - invalid refresh token type')
      logs.push('   User needs to re-authenticate and store provider_refresh_token')
      
      return new Response(JSON.stringify({ 
        success: false,
        message: 'Invalid refresh token (Supabase token, not Google token)',
        logs,
        solution: 'Re-authenticate with Google OAuth using access_type=offline to get provider_refresh_token'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Refresh the token
    logs.push('🔄 Step 2: Refreshing provider_token...')
    logs.push(`Using refresh token: ${tokens.refresh_token.substring(0, 30)}...`)
    logs.push('')

    const refreshedToken = await refreshAccessToken(supabase, userId, tokens.refresh_token)

    if (refreshedToken) {
      logs.push('✅ Token refreshed successfully!')
      logs.push(`New Provider Token: ${refreshedToken.substring(0, 30)}...`)
      logs.push('')

      // Get updated token info
      const { data: updatedToken } = await supabase
        .from('google_calendar_tokens')
        .select('access_token, expires_at, updated_at')
        .eq('user_id', userId)
        .single()

      if (updatedToken) {
        logs.push('📊 Updated Token Info:')
        logs.push(`New Access Token: ${updatedToken.access_token.substring(0, 30)}...`)
        logs.push(`Expires At: ${updatedToken.expires_at}`)
        logs.push(`Updated At: ${updatedToken.updated_at}`)
      }

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Provider token refreshed successfully',
        new_provider_token: refreshedToken.substring(0, 30) + '...',
        expires_at: updatedToken?.expires_at,
        logs
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      logs.push('❌ Token refresh failed')
      logs.push('   Check logs above for details')
      
      return new Response(JSON.stringify({ 
        success: false,
        message: 'Token refresh failed',
        logs
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

  } catch (error) {
    console.error('❌ Error:', error)
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error),
      logs: ['Error: ' + (error instanceof Error ? error.message : String(error))]
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})




