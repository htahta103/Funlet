# Check Session for provider_refresh_token

## Test Result: Refreshing Supabase Session

**Result:** ❌ Refreshing Supabase session does NOT give us `provider_refresh_token`

When you refresh a Supabase session:
- ✅ Gets new Supabase `access_token` (JWT)
- ✅ Gets new Supabase `refresh_token`
- ❌ Does NOT include `provider_token`
- ❌ Does NOT include `provider_refresh_token`

## Why?

Supabase session refresh only refreshes **Supabase tokens**, not **Google provider tokens**. 

To refresh Google `provider_token`, you need:
- Google `provider_refresh_token` (50+ characters)
- Call Google's OAuth refresh endpoint directly

## Check Current Session

The `provider_refresh_token` might be in your **current session** (before refresh), but it's not visible in the session inspector UI.

### Check in Browser Console

```javascript
// Get current session
const { data: { session } } = await supabase.auth.getSession()

// Check for provider_refresh_token
console.log('provider_refresh_token:', session?.provider_refresh_token)
console.log('Length:', session?.provider_refresh_token?.length)

// Full session object (check all fields)
console.log('Full session:', session)
console.log('All session keys:', Object.keys(session || {}))
```

### If provider_refresh_token Exists

If `provider_refresh_token` exists (50+ characters), store it immediately:

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
      provider_refresh_token: providerRefreshToken, // ← This is what we need!
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      scope: session.provider_token_scope
    })
  })
}
```

### If provider_refresh_token Doesn't Exist

If `provider_refresh_token` is missing or too short:
1. Re-authenticate with Google OAuth
2. Make sure `access_type=offline` is in the OAuth request (already included in `get-google-oauth-url`)
3. Extract `provider_refresh_token` from the new session
4. Store it in the database

## Summary

- ❌ **Cannot** refresh Supabase session to get new `provider_token`
- ✅ **Can** extract `provider_refresh_token` from current session (if it exists)
- ✅ **Can** use `provider_refresh_token` to refresh `provider_token` via Google OAuth endpoint




