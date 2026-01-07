# Test Token Refresh - Current Status

## Current Database Tokens

**User ID:** `84174326-705e-4416-a756-416838cf4f26`
- **Access Token:** `ya29.A0Aa7pCA-MymouZjVB8spV9Ey...` ✅ (Google token - starts with ya29)
- **Refresh Token:** `zauy7aamyu6a` ❌ (12 chars - Supabase token, NOT Google!)
- **Expires At:** `2026-01-02 07:47:41+00`

## Test Result

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/test-refresh-token" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "zauy7aamyu6a",
    "user_id": "84174326-705e-4416-a756-416838cf4f26"
  }'
```

**Result:** ❌ `invalid_grant` error
- The refresh token is a Supabase token (12 characters)
- Google refresh tokens are 50+ characters
- Cannot refresh Google Calendar tokens with Supabase refresh token

## How to Fix

### Step 1: Re-authenticate with Google OAuth

Use the `get-google-oauth-url` function to get OAuth URL:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uri": "https://www.funlet.ai/loading/"
  }'
```

### Step 2: Extract provider_refresh_token from Session

After OAuth, the URL hash contains:
- `access_token` = Supabase JWT
- `provider_token` = Google access token ✅
- `refresh_token` = Supabase refresh token ❌ (don't use this!)
- `provider_refresh_token` = Google refresh token ✅ (use this!)

### Step 3: Store Correct Tokens

Extract `provider_refresh_token` (50+ characters) and store it:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens" \
  -H "Authorization: Bearer SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "84174326-705e-4416-a756-416838cf4f26",
    "provider_token": "ya29.A0Aa7pCA...",
    "provider_refresh_token": "1//0g...50+_characters...",
    "expires_at": 1767093859,
    "expires_in": 3600
  }'
```

### Step 4: Test Refresh Again

After storing the correct `provider_refresh_token`, test refresh:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/test-refresh-token" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "1//0g...50+_characters...",
    "user_id": "84174326-705e-4416-a756-416838cf4f26"
  }'
```

Should return: ✅ `success: true` with new access token

## Summary

**Current Issue:**
- Database has Supabase refresh tokens (12 chars) instead of Google refresh tokens (50+ chars)
- Cannot refresh Google Calendar tokens with Supabase tokens

**Solution:**
- Re-authenticate with Google OAuth
- Extract `provider_refresh_token` from Supabase session (NOT `refresh_token`)
- Store `provider_refresh_token` in database
- Then refresh will work correctly




