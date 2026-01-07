# Fix: Refresh Token Issue - access_type=offline

## Problem

Refresh tokens are invalid or missing because `access_type=offline` is not included in the Google OAuth request.

## Root Cause

**Google OAuth requires `access_type=offline` to return a refresh token.**

Without this parameter:
- ✅ You get an access token
- ❌ You DON'T get a refresh token
- ❌ Tokens cannot be refreshed after expiration

## Solution

### Update Your OAuth Request

Add `queryParams` with `access_type=offline`:

```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
    redirectTo: `${window.location.origin}/auth/callback`,
    queryParams: {
      access_type: 'offline',  // ← REQUIRED for refresh token!
      prompt: 'consent'        // ← Force consent screen
    }
  }
})
```

### Why `prompt: 'consent'`?

- Google only returns refresh token on **first authorization**
- If user already authorized, Google won't return refresh token again
- `prompt: 'consent'` forces consent screen, ensuring refresh token

## Steps to Fix

1. **Update OAuth Request** - Add `access_type=offline` parameter
2. **Re-authenticate** - User needs to log in again with new parameters
3. **Store New Tokens** - Use `store-google-calendar-tokens` function
4. **Verify** - Test refresh token with `test-refresh-token` function

## Expected Result

After fixing:
- ✅ Refresh token will be 50+ characters (not 12)
- ✅ Refresh token will work with Google OAuth API
- ✅ Tokens will automatically refresh when expired

## Test

After re-authenticating with `access_type=offline`:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/test-refresh-token" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "YOUR_NEW_REFRESH_TOKEN",
    "user_id": "YOUR_USER_ID"
  }'
```

Should return `success: true` instead of `invalid_grant` error.




