# Extract provider_refresh_token from Supabase Session

## Problem

The session object shows:
- ✅ `provider_token`: Google access token (ya29...)
- ❌ `refresh_token`: "wsubremasm6e" (12 chars - Supabase token)
- ❓ `provider_refresh_token`: **NOT visible in session inspector**

## Solution

According to [Supabase docs](https://supabase.com/docs/guides/auth/social-login/auth-google), `provider_refresh_token` is in the session when OAuth is done with `access_type=offline`.

### Step 1: Check if provider_refresh_token exists

In your browser console or WeWeb, check the session object:

```javascript
// Get Supabase session
const { data: { session } } = await supabase.auth.getSession()

// Check for provider_refresh_token
console.log('provider_refresh_token:', session?.provider_refresh_token)
console.log('Length:', session?.provider_refresh_token?.length)

// Full session object
console.log('Full session:', session)
```

### Step 2: If provider_refresh_token exists, store it

If `provider_refresh_token` exists (50+ characters), store it:

```javascript
const providerRefreshToken = session.provider_refresh_token

if (providerRefreshToken && providerRefreshToken.length >= 20) {
  // Store via Edge Function
  await fetch('https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': 'YOUR_ANON_KEY'
    },
    body: JSON.stringify({
      user_id: session.user.id,
      provider_token: session.provider_token,
      provider_refresh_token: providerRefreshToken, // ← This is the Google refresh token!
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      scope: session.provider_token_scope
    })
  })
}
```

### Step 3: If provider_refresh_token doesn't exist

If `provider_refresh_token` is missing or too short, the OAuth flow didn't include `access_type=offline`. Re-authenticate:

1. Use `get-google-oauth-url` with `access_type=offline` (already included)
2. Re-authenticate with Google
3. Extract `provider_refresh_token` from the new session
4. Store it in the database

## Test Refresh After Storing

Once `provider_refresh_token` is stored:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/refresh-provider-token" \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "84174326-705e-4416-a756-416838cf4f26"}'
```

Should return: ✅ `success: true` with new provider_token




