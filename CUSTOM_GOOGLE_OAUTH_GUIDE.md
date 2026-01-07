# Custom Google OAuth Implementation Guide

## Problem with Supabase OAuth

When using Supabase's `signInWithOAuth`, the refresh tokens returned are **Supabase's internal tokens**, not Google's actual refresh tokens. These are short (12-13 characters) and cannot be used to refresh Google Calendar tokens.

## Solution: Custom Google OAuth Flow

We need to implement a **direct Google OAuth flow** that bypasses Supabase's OAuth wrapper to get the real Google refresh tokens.

---

## Implementation Steps

### 1. Create Google OAuth Authorization URL

Instead of using `supabase.auth.signInWithOAuth`, create a custom authorization URL:

```typescript
// Get your credentials
const GOOGLE_CLIENT_ID = 'your-client-id'
const REDIRECT_URI = 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback'
const SCOPE = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
const STATE = JSON.stringify({ user_id: 'your-user-id' }) // Optional: pass user_id

// Create authorization URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPE)
authUrl.searchParams.set('access_type', 'offline')  // ← CRITICAL for refresh token!
authUrl.searchParams.set('prompt', 'consent')        // ← Force consent screen
authUrl.searchParams.set('state', STATE)            // Optional: pass user_id

// Redirect user to this URL
window.location.href = authUrl.toString()
```

### 2. Google Redirects to Callback Function

After user authorizes, Google redirects to:
```
https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback?code=AUTHORIZATION_CODE&state=USER_ID
```

### 3. Callback Function Exchanges Code for Tokens

The `google-oauth-callback` function:
1. Receives authorization code from Google
2. Exchanges it for access token + **refresh token** (real Google tokens!)
3. Stores tokens in database
4. Returns success response

### 4. Store Tokens

The callback function automatically stores tokens if `state` contains `user_id`:

```typescript
// State can be JSON: { user_id: "..." }
// Or just the user_id string
const state = JSON.stringify({ user_id: userId })
```

---

## Complete Example

### Frontend (React/Next.js)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function loginWithGoogle() {
  // 1. Get current user (or create one)
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    // Create anonymous user first, or use existing auth
    const { data: { user: newUser } } = await supabase.auth.signInAnonymously()
    if (!newUser) throw new Error('Failed to create user')
    user = newUser
  }

  // 2. Create Google OAuth URL
  const GOOGLE_CLIENT_ID = '580740572048-n3f2gsr...' // Your Google Client ID
  const REDIRECT_URI = 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback'
  const SCOPE = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
  const STATE = JSON.stringify({ user_id: user.id })

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('access_type', 'offline')  // ← REQUIRED!
  authUrl.searchParams.set('prompt', 'consent')       // ← Force consent
  authUrl.searchParams.set('state', STATE)

  // 3. Redirect to Google
  window.location.href = authUrl.toString()
}
```

### Backend: Callback Function

The `google-oauth-callback` function is already created at:
- `/supabase/functions/google-oauth-callback/index.ts`

It handles:
- ✅ Receiving authorization code
- ✅ Exchanging for tokens (with real refresh token!)
- ✅ Storing in database
- ✅ Returning success response

---

## Environment Variables Needed

Set these in Supabase Edge Function secrets:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback
```

---

## Google Cloud Console Setup

1. **Go to Google Cloud Console**
2. **APIs & Services > Credentials**
3. **Edit your OAuth 2.0 Client**
4. **Authorized redirect URIs** - Add:
   ```
   https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback
   ```

---

## Testing

### 1. Deploy the Function

```bash
supabase functions deploy google-oauth-callback --project-ref jjkduivjlzazcvdeeqde
```

### 2. Test Authorization URL

Create the authorization URL and open in browser:

```bash
# Replace with your actual values
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback&response_type=code&scope=https://www.googleapis.com/auth/calendar%20https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent&state=YOUR_USER_ID
```

### 3. Verify Tokens

After authorization, check the database:

```sql
SELECT id, user_id, 
       LENGTH(refresh_token) as refresh_token_length,
       expires_at, 
       created_at 
FROM google_calendar_tokens 
WHERE user_id = 'YOUR_USER_ID';
```

**Expected:**
- `refresh_token_length` should be **50+ characters** (not 12!)
- Refresh token should work with `test-refresh-token` function

---

## Key Differences

### Supabase OAuth (Current - Broken)
```typescript
supabase.auth.signInWithOAuth({ provider: 'google' })
// Returns: Supabase internal tokens (short, invalid)
```

### Custom Google OAuth (Fixed)
```typescript
// Direct Google OAuth flow
window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?...'
// Returns: Real Google refresh tokens (50+ chars, valid)
```

---

## Benefits

✅ **Real Google Refresh Tokens** - 50+ characters, actually work  
✅ **Full Control** - Direct Google OAuth flow  
✅ **Proper Token Storage** - Stored correctly in database  
✅ **Automatic Refresh** - Works with existing refresh logic  

---

## Next Steps

1. ✅ Deploy `google-oauth-callback` function
2. ✅ Set environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
3. ✅ Update Google Cloud Console redirect URI
4. ✅ Update frontend to use custom OAuth flow
5. ✅ Test and verify refresh tokens work




