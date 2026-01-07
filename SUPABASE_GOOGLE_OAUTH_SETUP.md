# Supabase Google OAuth Setup Guide

## Overview

To enable Google OAuth login with your Supabase project (`jjkduivjlzazcvdeeqde.supabase.co`), you need to configure Google OAuth credentials in the Supabase Dashboard.

## Step 1: Get Google OAuth Credentials

### 1.1 Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/apis/credentials
2. Select your project (or create a new one)

### 1.2 Create OAuth 2.0 Client ID
1. Click **"Create Credentials"** → **"OAuth client ID"**
2. If prompted, configure OAuth consent screen first:
   - User Type: **External** (unless you have Google Workspace)
   - App name: **Funlet** (or your app name)
   - User support email: Your email
   - Developer contact: Your email
   - Click **Save and Continue**
   - Scopes: Add `https://www.googleapis.com/auth/calendar` and `https://www.googleapis.com/auth/calendar.events`
   - Click **Save and Continue**
   - Test users: Add your email (if in testing mode)
   - Click **Save and Continue**

### 1.3 Create OAuth Client
1. Application type: **Web application**
2. Name: **Funlet Web Client** (or any name)
3. **Authorized redirect URIs** - Add these:
   ```
   https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback
   https://www.funlet.ai/loading/
   https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/6de1155d-ce6c-4365-85dd-a339a745eb0c
   ```
4. Click **Create**
5. **Copy the Client ID and Client Secret** (you'll need these)

## Step 2: Configure Supabase Dashboard

### 2.1 Go to Supabase Dashboard
1. Visit: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde
2. Navigate to: **Authentication** → **Providers**

### 2.2 Enable Google Provider
1. Find **Google** in the providers list
2. Click **Enable** or toggle it on

### 2.3 Enter Google OAuth Credentials
1. **Client ID (for OAuth)**: Paste your Google OAuth Client ID
   - Example: `580740572048-n3f2gsrl5s9buhpettv0fqog3s02p02u.apps.googleusercontent.com`
2. **Client Secret (for OAuth)**: Paste your Google OAuth Client Secret
   - Example: `GOCSPX-xxxxxxxxxxxxxxxxxxxxx`
3. Click **Save**

### 2.4 Configure Redirect URLs
Supabase automatically uses: `https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback`

Make sure this URL is in your Google Cloud Console's **Authorized redirect URIs**.

## Step 3: Set Edge Function Secrets

The `get-google-oauth-url` function needs Google OAuth credentials:

### 3.1 Go to Edge Functions Secrets
1. In Supabase Dashboard: **Edge Functions** → **Secrets**
2. Or use CLI: `supabase secrets set GOOGLE_CLIENT_ID=your-client-id`

### 3.2 Set Required Secrets
```bash
supabase secrets set GOOGLE_CLIENT_ID=580740572048-n3f2gsrl5s9buhpettv0fqog3s02p02u.apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=your-client-secret-here
supabase secrets set SUPABASE_URL=https://jjkduivjlzazcvdeeqde.supabase.co
```

Or set them in Dashboard:
- **Edge Functions** → **Secrets** → **Add Secret**
- Key: `GOOGLE_CLIENT_ID`, Value: Your Google Client ID
- Key: `GOOGLE_CLIENT_SECRET`, Value: Your Google Client Secret
- Key: `SUPABASE_URL`, Value: `https://jjkduivjlzazcvdeeqde.supabase.co`

## Step 4: Test the Setup

### 4.1 Test OAuth URL Generation
```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uri": "https://www.funlet.ai/loading/"}'
```

### 4.2 Test OAuth Flow
1. Get the `authorization_url` from the response
2. Open it in a browser
3. Authorize with Google
4. Should redirect to: `https://www.funlet.ai/loading/#access_token=...&provider_token=...`

## Important Notes

### Redirect URI Configuration
- **Supabase callback**: `https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback`
  - This is automatically handled by Supabase
  - Must be in Google Cloud Console's authorized redirect URIs
  
- **Your app redirect**: `https://www.funlet.ai/loading/`
  - This is where users land after OAuth
  - Also add to Google Cloud Console if using direct OAuth

### OAuth Scopes
The function requests these scopes:
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.events`

Make sure these are added to your Google OAuth consent screen.

### Access Type = Offline
The function includes `access_type=offline` to get refresh tokens. This is critical for long-term calendar access.

## Troubleshooting

### Error: "redirect_uri_mismatch"
- **Solution**: Make sure all redirect URIs are added in Google Cloud Console
- Check exact match (including trailing slashes, https vs http)

### Error: "invalid_client"
- **Solution**: Verify Client ID and Client Secret are correct in Supabase Dashboard

### No Refresh Token
- **Solution**: Make sure `access_type=offline` is in the OAuth request
- User must see consent screen (use `prompt=consent`)

### Tokens Not in URL Hash
- **Solution**: Make sure you're using Supabase OAuth endpoint (`/auth/v1/authorize`)
- Not direct Google OAuth endpoint

## Reference Links

- Supabase Auth Docs: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google OAuth Setup: https://developers.google.com/identity/protocols/oauth2/web-server
- Supabase Dashboard: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde




