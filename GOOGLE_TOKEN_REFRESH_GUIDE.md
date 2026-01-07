# Google Calendar Token Refresh Guide

## Overview

After a new Google login session, you need to:
1. **Extract tokens from the session**
2. **Store them in the database**
3. **Use the refresh token to get new access tokens when they expire**

---

## 1. Information Needed from New Google Login Session

After Google OAuth login, the session object contains these fields:

### Required Fields:
- **`provider_token`** (Google access token) - Starts with `ya29.`
- **`refresh_token`** - Used to get new access tokens (e.g., `"zauy7aamyu6a"`)
- **`expires_at`** - Unix timestamp when token expires (e.g., `1767340061`)
- **`expires_in`** - Seconds until expiration (e.g., `3600` = 1 hour)
- **`user_id`** - Your Supabase user ID (extracted from `access_token` JWT)

### Optional Fields:
- **`provider_token_scope`** - Scopes granted (e.g., `"calendar calendar.events"`)
- **`token_type`** - Usually `"bearer"`

---

## 2. How to Store New Tokens

### Method 1: Using the Store Function (Recommended)

After login, call the `store-google-calendar-tokens` function:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens" \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "provider_token": "ya29.A0Aa7pCA-MymouZjVB8spV9Ey2Hk...",
    "refresh_token": "zauy7aamyu6a",
    "expires_at": 1767340061,
    "expires_in": 3600,
    "scope": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"
  }'
```

### Method 2: Extract from Session Object

If you have the session object (from the image), extract:

```javascript
const session = {
  provider_token: "ya29.A0Aa7pCA-MymouZjVB8spV9Ey2Hk...",
  refresh_token: "zauy7aamyu6a",
  expires_at: 1767340061,
  expires_in: 3600,
  token_type: "bearer"
};

// Extract user_id from access_token JWT
const jwtParts = session.access_token.split('.');
const payload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
const userId = payload.sub;

// Store tokens
await fetch('https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    'apikey': 'YOUR_ANON_KEY'
  },
  body: JSON.stringify({
    user_id: userId,
    provider_token: session.provider_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    scope: session.provider_token_scope || 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
  })
});
```

---

## 3. How Token Refresh Works

### What's Needed to Refresh:

1. **Refresh Token** - From your stored session (e.g., `"zauy7aamyu6a"`)
2. **GOOGLE_CLIENT_ID** - Set in Edge Function secrets
3. **GOOGLE_CLIENT_SECRET** - Set in Edge Function secrets

### Refresh Process:

The system automatically refreshes tokens when:
- Access token expires (typically after 1 hour)
- You call `getAccessToken()` function

**Refresh Request:**
```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&refresh_token=zauy7aamyu6a
&grant_type=refresh_token
```

**Refresh Response:**
```json
{
  "access_token": "ya29.NEW_ACCESS_TOKEN...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/calendar ..."
}
```

---

## 4. Testing Your New Refresh Token

Use the test function to verify your new refresh token works:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/test-refresh-token" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "zauy7aamyu6a",
    "user_id": "YOUR_USER_ID"
  }'
```

This will:
- ✅ Test if the refresh token is valid
- ✅ Show detailed logs of the refresh process
- ✅ Update the database if refresh succeeds

---

## 5. Quick Reference

### From Your New Session (Image):
```json
{
  "provider_token": "ya29.A0Aa7pCA-MymouZjVB8spV9Ey2Hk...",
  "refresh_token": "zauy7aamyu6a",  // ← Use this!
  "expires_at": 1767340061,
  "expires_in": 3600,
  "token_type": "bearer"
}
```

### To Store:
1. Extract `user_id` from `access_token` JWT
2. Call `store-google-calendar-tokens` with all fields
3. The refresh token will be saved for automatic refresh

### To Refresh (Automatic):
- System uses stored `refresh_token`
- Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Edge Function secrets
- Happens automatically when access token expires

---

## 6. Common Issues

### Issue: "invalid_grant" Error
**Cause:** Refresh token is invalid/expired  
**Solution:** Get a new refresh token by logging in again

### Issue: "No valid Google Calendar token found"
**Cause:** Refresh token missing or invalid  
**Solution:** Store new tokens from fresh login session

### Issue: Token Not Refreshing
**Cause:** `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` not set  
**Solution:** Add secrets to Edge Function environment

---

## 7. CRITICAL: access_type=offline Parameter

### ⚠️ This is likely the root cause of your issue!

**You MUST include `access_type=offline` in your Google OAuth request to get a refresh token.**

Without `access_type=offline`, Google will:
- ✅ Return an access token
- ❌ NOT return a refresh token
- ❌ Token cannot be refreshed after expiration

### How to Fix:

When calling `signInWithOAuth`, add `queryParams`:

```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
    redirectTo: `${window.location.origin}/auth/callback`,
    queryParams: {
      access_type: 'offline',  // ← REQUIRED for refresh token!
      prompt: 'consent'        // ← Force consent screen (ensures refresh token on first login)
    }
  }
})
```

### Why `prompt: 'consent'`?

- Google only returns a refresh token on the **first** authorization
- If the user has already authorized, Google won't return a refresh token again
- `prompt: 'consent'` forces the consent screen, ensuring you get a refresh token

### Verify It's Working:

After login with `access_type=offline`, check:
1. Session should have `refresh_token` field
2. Refresh token should be longer than 12 characters (typically 50+ characters)
3. Test the refresh token using the `test-refresh-token` function

---

## Summary

**To refresh Google Calendar tokens, you need:**
1. ✅ **Refresh Token** - From your login session (`refresh_token` field)
2. ✅ **GOOGLE_CLIENT_ID** - In Edge Function secrets
3. ✅ **GOOGLE_CLIENT_SECRET** - In Edge Function secrets
4. ✅ **`access_type=offline`** - In OAuth request (CRITICAL!)

**The refresh happens automatically** when the access token expires, as long as you have a valid refresh token stored in the database.

