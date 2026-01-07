# Google OAuth Callback Function Usage

## Overview

The `google-oauth-callback` Edge Function automatically extracts and saves Google OAuth tokens (`provider_token` and `provider_refresh_token`) to the `google_calendar_tokens` table. This solves the problem where WeWeb cannot extract tokens from the URL hash.

## How It Works

1. **Set callback as redirect_to**: When generating the OAuth URL, use `callback_url` parameter to set the callback function as the redirect destination
2. **Automatic token extraction**: When Supabase redirects after OAuth, the callback function:
   - Extracts `access_token` from URL query params or Authorization header
   - Uses `access_token` to create Supabase client and get session
   - Extracts `provider_token` and `provider_refresh_token` from session
   - Saves tokens to `google_calendar_tokens` table
3. **Redirect to WeWeb**: After saving tokens, redirects to the final WeWeb page

## Usage

### Step 1: Get OAuth URL with Callback

Call `get-google-oauth-url` with `callback_url` and `final_redirect_uri`:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "callback_url": "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback",
    "final_redirect_uri": "https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/6de1155d-ce6c-4365-85dd-a339a745eb0c/loading",
    "user_id": "optional-user-id"
  }'
```

Response:
```json
{
  "success": true,
  "authorization_url": "https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/authorize?...",
  "callback_url": "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback",
  "final_redirect_uri": "https://editor.weweb.io/.../loading",
  "flow_type": "supabase_oauth_with_callback"
}
```

### Step 2: Redirect User to Authorization URL

Redirect the user to the `authorization_url` from Step 1.

### Step 3: OAuth Flow

1. User authorizes with Google via Supabase
2. Supabase redirects to `callback_url` (the callback function)
3. Callback function automatically:
   - Extracts tokens from session
   - Saves to `google_calendar_tokens` table
   - Redirects to `final_redirect_uri` (WeWeb page)

### Step 4: User Lands on WeWeb Page

User is redirected to the WeWeb page. Tokens are already saved in the database.

## Parameters

### `get-google-oauth-url` Parameters

- `callback_url` (optional): Edge Function callback URL. If provided, OAuth will redirect here first.
- `final_redirect_uri` (optional): Final destination after callback saves tokens. Required if `callback_url` is provided.
- `redirect_uri` (required if no callback_url): Direct redirect destination (without callback).
- `user_id` (optional): User ID to include in state parameter.
- `scope` (optional): OAuth scopes. Defaults to calendar scopes.

### `google-oauth-callback` Parameters

The callback function accepts:
- `access_token` (query param or Authorization header): Supabase JWT token
- `state` (query param): JSON string containing `final_redirect_uri` and optionally `user_id`

## Important Notes

1. **URL Hash Limitation**: Servers cannot read URL hash (`#`). The callback function relies on:
   - `access_token` in query params: `?access_token=...`
   - Or `access_token` in Authorization header: `Authorization: Bearer ...`
   - Then uses the session to get `provider_token` and `provider_refresh_token`

2. **Supabase Redirect Behavior**: When Supabase redirects after OAuth:
   - For client-side redirects: Tokens are in URL hash (not accessible server-side)
   - For server-side redirects: May put `access_token` in query params
   - **If `access_token` is not in query params**, the callback will try Authorization header or request body

3. **Session Required**: The callback needs an active Supabase session to extract `provider_token` and `provider_refresh_token`. This is available immediately after OAuth.

4. **Redirect URI Registration**: Make sure to register the callback URL in:
   - Supabase Dashboard: Authentication → URL Configuration → Redirect URLs
   - Google Cloud Console: Authorized redirect URIs (if using custom OAuth)

## Testing

Test the callback function:

```bash
# 1. Get OAuth URL with callback
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "callback_url": "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback",
    "final_redirect_uri": "https://editor.weweb.io/.../loading"
  }'

# 2. Complete OAuth flow in browser (redirect to authorization_url)

# 3. Verify tokens saved in database
# Check google_calendar_tokens table for the user_id
```

## Troubleshooting

### Issue: `access_token` not found in request

**Solution**: Supabase may not be putting `access_token` in query params. Try:
1. Check if Supabase redirects with tokens in hash (client-side only)
2. Use Authorization header: `Authorization: Bearer <access_token>`
3. Or pass `access_token` in request body (POST request)

### Issue: No session found

**Solution**: 
- Ensure OAuth flow completed successfully
- Check that `access_token` is valid and not expired
- Verify Supabase OAuth is configured correctly

### Issue: No `provider_refresh_token` in session

**Solution**:
- Ensure OAuth request includes `access_type=offline` (already included in `get-google-oauth-url`)
- Ensure OAuth request includes `prompt=consent` (already included)
- User may need to re-authenticate to get refresh token

## Alternative: Direct Redirect (Without Callback)

If you prefer to handle token extraction client-side:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uri": "https://editor.weweb.io/.../loading"
  }'
```

Then extract tokens from URL hash in WeWeb (if possible) and call `store-google-calendar-tokens` function.




