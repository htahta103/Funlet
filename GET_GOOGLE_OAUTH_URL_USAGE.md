# get-google-oauth-url Function Usage

## Overview

This function generates a Google OAuth authorization URL **without requiring user authentication**. Perfect for users who haven't logged in yet.

## Endpoint

```
POST https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url
```

## Authentication

**No Bearer Token Required!** Use `apikey` header instead:

```javascript
headers: {
  'apikey': 'YOUR_SUPABASE_ANON_KEY',
  'Content-Type': 'application/json'
}
```

## Request Body

```json
{
  "redirect_uri": "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback",  // optional
  "user_id": "5736b75d-ca02-48c3-9ccf-3c457cc831ed"  // optional
}
```

### Parameters

- **`redirect_uri`** (optional): Where Google should redirect after authorization
  - Default: `https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback`
  
- **`user_id`** (optional): User ID to include in state parameter
  - If provided, will be passed to callback function for token storage

## Response

```json
{
  "success": true,
  "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "redirect_uri": "...",
  "scope": "...",
  "parameters": {
    "client_id": "...",
    "redirect_uri": "...",
    "response_type": "code",
    "scope": "...",
    "access_type": "offline",
    "prompt": "consent",
    "state": "included (with user_id)" or "not included"
  },
  "instructions": {
    "step1": "Redirect user to authorization_url",
    "step2": "User authorizes with Google",
    "step3": "Google redirects to callback function",
    "step4": "Callback function handles and stores tokens"
  }
}
```

## Example Usage

### JavaScript/TypeScript

```javascript
// No authentication needed - use anon key
const response = await fetch(
  'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url',
  {
    method: 'POST',
    headers: {
      'apikey': 'YOUR_SUPABASE_ANON_KEY',  // ← Use apikey, not Bearer token!
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redirect_uri: 'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback',
      user_id: 'optional-user-id'  // Optional
    })
  }
)

const data = await response.json()

// Redirect user to Google OAuth
if (data.success) {
  window.location.href = data.authorization_url
}
```

### cURL

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uri": "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback",
    "user_id": "optional-user-id"
  }'
```

### Minimal Request (uses defaults)

```javascript
// Just get the URL with default redirect_uri
const response = await fetch(
  'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url',
  {
    method: 'POST',
    headers: {
      'apikey': 'YOUR_SUPABASE_ANON_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})  // Empty body uses defaults
  }
)
```

## Key Features

✅ **No Authentication Required** - Works before user logs in  
✅ **Includes `access_type=offline`** - Gets refresh token  
✅ **Includes `prompt=consent`** - Forces consent screen  
✅ **Automatic State Handling** - Includes user_id in state if provided  
✅ **Default Redirect URI** - Works without specifying redirect_uri  

## Complete Flow

1. **User clicks "Connect Google Calendar"** (not logged in yet)
2. **Frontend calls `get-google-oauth-url`** with `apikey` header
3. **Function returns `authorization_url`**
4. **Frontend redirects user** to `authorization_url`
5. **User authorizes** with Google
6. **Google redirects** to `google-oauth-callback` function
7. **Callback function** stores tokens in database
8. **User is now authenticated** with Google Calendar access

## Notes

- The function is **public** - no user authentication needed
- Use `apikey` header, not `Authorization: Bearer`
- `user_id` is optional - can be added later in the callback
- Default `redirect_uri` points to the callback function
- All parameters include `access_type=offline` for refresh tokens




