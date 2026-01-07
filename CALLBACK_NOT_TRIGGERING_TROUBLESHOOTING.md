# Troubleshooting: Callback Function Not Triggering

## Problem
The `google-oauth-callback` function is not being triggered when Supabase redirects after OAuth.

## Most Common Causes

### 1. Callback URL Not Registered in Supabase Dashboard

**Solution**: Register the callback URL in Supabase Dashboard

1. Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/auth/url-configuration
2. Under "Redirect URLs", add:
   ```
   https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback
   ```
3. Click "Save"
4. Wait a few seconds for changes to propagate

### 2. Supabase Redirects with Tokens in Hash (Not Query Params)

**Problem**: Supabase's OAuth flow typically redirects with tokens in the URL hash (`#access_token=...`), which is client-side only. Servers cannot read URL hashes.

**Solution**: We need to handle this differently. The callback function now has enhanced logging to see what's actually being received.

### 3. Check Function Logs

Check the callback function logs to see if it's being called:

1. Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/functions/google-oauth-callback/logs
2. Look for:
   - `📥 Google OAuth Callback - Request received` - Function was called
   - `📋 Request details` - Shows the full request
   - `🔍 Full URL` - Shows what URL was received
   - `❌ OAuth error received` - Shows any errors from Supabase

## Debugging Steps

### Step 1: Verify Callback URL is Correct

Test the callback function directly:

```bash
curl "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback?redirect_uri=https://www.funlet.ai/loading&test=true"
```

You should see a response (even if it's an error about missing access_token).

### Step 2: Check the Generated OAuth URL

Call `get-google-oauth-url` and verify the `redirect_to` parameter:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uri": "https://www.funlet.ai/loading"}' | jq '.authorization_url'
```

Check that the `redirect_to` parameter in the authorization URL points to the callback function.

### Step 3: Check Supabase Logs

After attempting OAuth, check:
1. Supabase Auth logs: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/logs/auth
2. Edge Function logs: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/functions/google-oauth-callback/logs

Look for:
- Redirect errors
- State validation errors
- URL mismatch errors

## Alternative Approach: Handle Hash on Client Side

If Supabase always redirects with tokens in the hash, we might need to:

1. Redirect to a client-side page (WeWeb) that can read the hash
2. Extract tokens from hash
3. Call the callback function via POST with tokens

This would require updating the flow to:
- Set `redirect_to` to WeWeb page (not callback function)
- WeWeb page extracts tokens from hash
- WeWeb page calls callback function via POST

## Current Implementation Notes

The callback function now:
- ✅ Logs all request details
- ✅ Checks for OAuth errors from Supabase
- ✅ Handles tokens in query params, Authorization header, or request body
- ✅ Extracts `redirect_uri` from callback URL query params

## Next Steps

1. **Register callback URL** in Supabase Dashboard (most important!)
2. **Check function logs** after attempting OAuth
3. **Share the logs** to see what's actually happening




