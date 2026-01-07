// Edge Function to refresh Supabase session and check if we can get provider_refresh_token
// This tests if refreshing Supabase session gives us access to provider tokens

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('📥 Refresh Supabase Session - Request received')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get user_id from request
    let requestBody: any = {}
    try {
      const bodyText = await req.text()
      if (bodyText) {
        requestBody = JSON.parse(bodyText)
      }
    } catch (e) {
      // No body or invalid JSON
    }

    const userId = requestBody.user_id || requestBody.userId || '84174326-705e-4416-a756-416838cf4f26'
    const refreshToken = requestBody.refresh_token || requestBody.refreshToken

    console.log('🔍 Testing Supabase session refresh for user:', userId)

    const logs: string[] = []
    logs.push('=== Refresh Supabase Session Test ===')
    logs.push(`User ID: ${userId}`)
    logs.push('')

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jjkduivjlzazcvdeeqde.supabase.co'
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs'

    // Create Supabase client
    const supabase = createClient(supabaseUrl, anonKey)

    // Step 1: Get current session (if refresh_token provided)
    if (refreshToken) {
      logs.push('🔄 Step 1: Refreshing Supabase session with refresh_token...')
      logs.push(`Refresh Token: ${refreshToken.substring(0, 20)}...`)
      logs.push('')

      const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: refreshToken
      })

      if (refreshError) {
        logs.push('❌ Failed to refresh Supabase session')
        logs.push(`Error: ${refreshError.message}`)
        logs.push('')

        return new Response(JSON.stringify({ 
          success: false,
          message: 'Failed to refresh Supabase session',
          error: refreshError.message,
          logs
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (sessionData.session) {
        logs.push('✅ Supabase session refreshed successfully!')
        logs.push('')
        logs.push('📋 Session Tokens:')
        logs.push(`  access_token: ${sessionData.session.access_token.substring(0, 30)}...`)
        logs.push(`  refresh_token: ${sessionData.session.refresh_token?.substring(0, 20) || 'NULL'}...`)
        logs.push(`  expires_at: ${sessionData.session.expires_at}`)
        logs.push(`  expires_in: ${sessionData.session.expires_in}`)
        logs.push('')
        logs.push('📋 Provider Tokens:')
        logs.push(`  provider_token: ${(sessionData.session as any).provider_token ? (sessionData.session as any).provider_token.substring(0, 30) + '...' : 'NULL'}`)
        logs.push(`  provider_refresh_token: ${(sessionData.session as any).provider_refresh_token ? (sessionData.session as any).provider_refresh_token.substring(0, 30) + '...' : 'NULL'}`)
        logs.push(`  provider_refresh_token length: ${(sessionData.session as any).provider_refresh_token?.length || 0}`)
        logs.push(`  provider_token_scope: ${(sessionData.session as any).provider_token_scope || 'NULL'}`)
        logs.push('')

        const providerRefreshToken = (sessionData.session as any).provider_refresh_token

        if (providerRefreshToken && providerRefreshToken.length >= 20) {
          logs.push('✅ Found provider_refresh_token in refreshed session!')
          logs.push('   Can use this to refresh Google provider_token')
          logs.push('')

          // Try to store it in database
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
          if (serviceRoleKey) {
            const serviceSupabase = createClient(supabaseUrl, serviceRoleKey)
            
            const { error: storeError } = await serviceSupabase
              .from('google_calendar_tokens')
              .upsert({
                user_id: userId,
                access_token: (sessionData.session as any).provider_token,
                refresh_token: providerRefreshToken,
                expires_at: new Date((sessionData.session.expires_at || Date.now() / 1000 + 3600) * 1000).toISOString(),
                token_type: 'Bearer',
                scope: (sessionData.session as any).provider_token_scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'user_id',
              })

            if (storeError) {
              logs.push('⚠️  Failed to store tokens:', storeError.message)
            } else {
              logs.push('✅ Stored provider_refresh_token in database!')
            }
          }
        } else {
          logs.push('❌ No provider_refresh_token in refreshed session')
          logs.push('   Refreshing Supabase session does NOT refresh provider tokens')
          logs.push('   Need to use Google provider_refresh_token to refresh provider_token')
        }

        return new Response(JSON.stringify({ 
          success: !!providerRefreshToken && providerRefreshToken.length >= 20,
          message: providerRefreshToken && providerRefreshToken.length >= 20 
            ? 'Found provider_refresh_token in refreshed session' 
            : 'No provider_refresh_token in refreshed session',
          session: {
            has_provider_token: !!(sessionData.session as any).provider_token,
            has_provider_refresh_token: !!providerRefreshToken,
            provider_refresh_token_length: providerRefreshToken?.length || 0
          },
          logs
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    } else {
      // No refresh token provided, just get current session
      logs.push('📋 Getting current session (no refresh token provided)...')
      logs.push('   Provide refresh_token in request body to test session refresh')
      logs.push('')

      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session) {
        logs.push('❌ No active session found')
        logs.push('   Need to provide refresh_token to test session refresh')
        
        return new Response(JSON.stringify({ 
          success: false,
          message: 'No active session. Provide refresh_token to test session refresh.',
          logs
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      logs.push('✅ Current session found')
      logs.push(`  provider_token: ${(session as any).provider_token ? 'EXISTS' : 'NULL'}`)
      logs.push(`  provider_refresh_token: ${(session as any).provider_refresh_token ? 'EXISTS' : 'NULL'}`)
      logs.push(`  provider_refresh_token length: ${(session as any).provider_refresh_token?.length || 0}`)

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Current session info',
        has_provider_refresh_token: !!(session as any).provider_refresh_token,
        provider_refresh_token_length: (session as any).provider_refresh_token?.length || 0,
        logs
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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




