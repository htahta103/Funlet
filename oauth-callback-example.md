# How to Get Google OAuth Tokens

After a user logs in with Google OAuth, Supabase returns a session object that contains the provider tokens. Here's how to extract and use them:

## Method 1: Extract from Session (Recommended)

After OAuth login, the session object contains:
- `session.provider_token` - Google access token
- `session.provider_refresh_token` - Google refresh token  
- `session.provider_token_scope` - Scopes granted (e.g., "calendar calendar.events")
- Session expiration info

### Client-Side Code Example (React/Next.js)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// 1. Sign in with Google OAuth
// CRITICAL: Include access_type=offline to get a refresh token!
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
    redirectTo: `${window.location.origin}/auth/callback',
    queryParams: {
      access_type: 'offline',  // ← REQUIRED for refresh token!
      prompt: 'consent'        // ← Force consent screen to ensure refresh token
    }
  }
})

// 2. In your OAuth callback page (/auth/callback)
useEffect(() => {
  const handleAuthCallback = async () => {
    // Get the session after OAuth redirect
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (session && session.provider_token) {
      // Extract tokens from session
      const providerToken = session.provider_token
      const providerRefreshToken = session.provider_refresh_token
      const providerTokenScope = session.provider_token_scope || ''
      
      // Calculate expiration
      const expiresAt = session.expires_at ? session.expires_at : Math.floor(Date.now() / 1000) + 3600
      const expiresIn = session.expires_in || 3600
      
      // Call the Edge Function to store tokens
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-google-calendar-tokens`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          },
          // Option 1: Let function extract from session (preferred)
          // No body needed - function will get from session
          
          // Option 2: Pass tokens explicitly (fallback)
          body: JSON.stringify({
            provider_token: providerToken,
            provider_refresh_token: providerRefreshToken,
            expires_at: expiresAt,
            expires_in: expiresIn,
            scope: providerTokenScope
          })
        }
      )
      
      const result = await response.json()
      console.log('Tokens stored:', result)
    }
  }
  
  handleAuthCallback()
}, [])
```

## Method 2: Extract from OAuth Callback URL

If you're handling the OAuth callback manually, you can extract tokens from the URL hash:

```typescript
// OAuth callback URL format:
// https://yourapp.com/auth/callback#access_token=...&provider_token=ya29...&expires_at=1767093543&expires_in=3600&provider_token_scope=calendar%20calendar.events

const hashParams = new URLSearchParams(window.location.hash.substring(1))
const providerToken = hashParams.get('provider_token')
const expiresAt = hashParams.get('expires_at')
const expiresIn = hashParams.get('expires_in')
const scope = decodeURIComponent(hashParams.get('provider_token_scope') || '')

// Then call the function
await fetch('/functions/v1/store-google-calendar-tokens', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${hashParams.get('access_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    provider_token: providerToken,
    expires_at: parseInt(expiresAt || '0'),
    expires_in: parseInt(expiresIn || '3600'),
    scope: scope
  })
})
```

## Method 3: Automatic Storage via Auth Hook (Future)

You could also set up a database trigger or auth hook to automatically store tokens when a user authenticates, but the Edge Function approach is simpler and more flexible.

## Important Notes

1. **Timing**: The `provider_token` is only available in the session **immediately after OAuth login**. It's not persisted in the database by default.

2. **Scopes**: Make sure your OAuth request includes calendar scopes:
   ```typescript
   scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
   ```

3. **Expiration**: Google access tokens typically expire in 1 hour. The refresh token can be used to get new access tokens.

4. **Best Practice**: Call `store-google-calendar-tokens` immediately after OAuth login, before the user navigates away from the callback page.

