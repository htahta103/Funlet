# Google OAuth Redirect URI Setup Guide

## Problem: `redirect_uri_mismatch` Error

When you get a `400: redirect_uri_mismatch` error from Google, it means the redirect URI you're using is not registered in Google Cloud Console.

## Solution: Register Redirect URI in Google Cloud Console

### Step 1: Access Google Cloud Console
1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your project (the one with OAuth client ID: `580740572048-n3f2gsrl5s9buhpettv0fqog3s02p02u`)

### Step 2: Edit OAuth Client
1. Find your OAuth 2.0 Client ID
2. Click **Edit** (pencil icon)

### Step 3: Add Authorized Redirect URI
1. Scroll to **"Authorized redirect URIs"** section
2. Click **"Add URI"**
3. Enter your redirect URI exactly as used in the function:
   ```
   https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/6de1155d-ce6c-4365-85dd-a339a745eb0c
   ```
4. Click **Save**

### Step 4: Test Again
After saving, wait a few seconds for Google to update, then try the OAuth flow again.

## Important Notes

### Exact Match Required
- The redirect URI must match **exactly** (including trailing slashes, query parameters, etc.)
- Case-sensitive
- Protocol must match (`https://` vs `http://`)

### Multiple Redirect URIs
You can add multiple redirect URIs if you have:
- Different WeWeb pages
- Development vs production URLs
- Local testing URLs (e.g., `http://localhost:3000/callback`)

### Common Redirect URIs
If you're using different redirect URIs, add all of them:

```
# WeWeb Editor (your current one)
https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/6de1155d-ce6c-4365-85dd-a339a745eb0c

# Supabase Auth Callback (if using Supabase OAuth)
https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback

# Custom Callback Function (if using google-oauth-callback)
https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/google-oauth-callback

# Local Development (if testing locally)
http://localhost:3000/callback
http://localhost:5173/callback
```

## Testing the Function

The function correctly accepts `redirect_uri` from the request:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uri": "https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/6de1155d-ce6c-4365-85dd-a339a745eb0c"
  }'
```

The function will:
- ✅ Use the provided `redirect_uri` in the authorization URL
- ✅ Include `access_type=offline` to get refresh token
- ✅ Include `prompt=consent` to force consent screen

## Troubleshooting

### Still Getting 400 Error?
1. **Wait a few seconds** - Google may take 1-2 minutes to update
2. **Check exact match** - Copy-paste the exact URI from the error message
3. **Clear browser cache** - Sometimes cached OAuth config causes issues
4. **Check OAuth client** - Make sure you're editing the correct client ID

### Error: "Invalid redirect_uri"
- Make sure the URI starts with `https://` (or `http://` for localhost)
- No trailing slash unless your callback expects it
- No query parameters in the registered URI (they're added by Google)

### Error: "redirect_uri_mismatch" After Adding
- Double-check the URI is saved correctly
- Try in an incognito/private browser window
- Check if you have multiple OAuth clients and edited the wrong one

## Reference

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred)
- [OAuth 2.0 Redirect URI Best Practices](https://www.oauth.com/oauth2-servers/redirect-uris/redirect-uri-registration/)




