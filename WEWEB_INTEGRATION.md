# WeWeb Integration for Google Calendar Tokens

Since WeWeb doesn't provide direct access to the Supabase session object, we need to extract tokens from the OAuth callback URL and call the Edge Function.

## Solution: Extract Tokens from OAuth Callback URL

When Google OAuth redirects back to your app, the tokens are in the URL hash fragment. The callback URL looks like:

```
https://www.funlet.ai/#access_token=eyJ...&expires_at=1767093859&expires_in=3600&provider_token=ya29...&refresh_token=pmgihztyocn7&token_type=bearer
```

## Quick Setup for WeWeb

### Option 1: Use the JavaScript Script (Recommended)

1. **Add the script to your OAuth callback page in WeWeb:**
   - Copy the contents of `weweb-oauth-callback-script.js`
   - In WeWeb, go to your homepage (or the page that receives OAuth callbacks)
   - Add a **Custom Code** component or **Script** component
   - Paste the script code
   - Make sure it runs on page load

2. **The script will automatically:**
   - Extract tokens from the URL hash (`#access_token=...&provider_token=...`)
   - Call the Edge Function to store them in the database
   - Log success/error messages to browser console

3. **Verify it's working:**
   - After logging in with Google, check the browser console (F12)
   - You should see: `✅ Google Calendar tokens stored successfully`
   - Or check the database: `SELECT * FROM google_calendar_tokens WHERE user_id = 'your-user-id'`

### Option 2: Use WeWeb API Request Component

If you prefer using WeWeb's built-in API component:

1. **Add an API Request component** to your OAuth callback page
2. **Configure it:**
   - **URL**: `https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens`
   - **Method**: POST
   - **Headers**:
     - `Authorization`: `Bearer {{extracted_access_token}}`
     - `Content-Type`: `application/json`
     - `apikey`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs`
   - **Body**:
     ```json
     {
       "provider_token": "{{extracted_provider_token}}",
       "provider_refresh_token": "{{extracted_refresh_token}}",
       "expires_at": {{extracted_expires_at}},
       "expires_in": {{extracted_expires_in}},
       "scope": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"
     }
     ```
3. **Trigger**: Set it to run on page load or after OAuth redirect

### Step 1: Configure WeWeb OAuth Redirect

In WeWeb, configure your Google OAuth to redirect to a page where you can extract the tokens.

### Step 2: Extract Tokens from URL Hash

The OAuth callback URL looks like:
```
https://yourapp.com/auth/callback#access_token=eyJ...&provider_token=ya29...&expires_at=1767093543&expires_in=3600&provider_token_scope=calendar%20calendar.events
```

### Step 3: Call Edge Function from WeWeb

In WeWeb, after OAuth login, use a **Custom Action** or **API Request** to call our function:

**WeWeb API Request Configuration:**
- **Method**: POST
- **URL**: `https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens`
- **Headers**:
  - `Authorization`: `Bearer {{user.access_token}}` (WeWeb should have access to the user's access token)
  - `Content-Type`: `application/json`
  - `apikey`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs`
- **Body** (if WeWeb can extract from URL):
```json
{
  "provider_token": "{{extracted_provider_token}}",
  "expires_at": {{extracted_expires_at}},
  "expires_in": {{extracted_expires_in}},
  "scope": "{{extracted_scope}}"
}
```

### Alternative: Use WeWeb JavaScript Action

If WeWeb supports custom JavaScript, you can extract tokens from the URL:

```javascript
// Extract from URL hash
const hashParams = new URLSearchParams(window.location.hash.substring(1));
const providerToken = hashParams.get('provider_token');
const expiresAt = hashParams.get('expires_at');
const expiresIn = hashParams.get('expires_in');
const scope = decodeURIComponent(hashParams.get('provider_token_scope') || '');

// Call the Edge Function
fetch('https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${hashParams.get('access_token')}`,
    'Content-Type': 'application/json',
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs'
  },
  body: JSON.stringify({
    provider_token: providerToken,
    expires_at: parseInt(expiresAt || '0'),
    expires_in: parseInt(expiresIn || '3600'),
    scope: scope
  })
})
.then(response => response.json())
.then(data => console.log('Tokens stored:', data))
.catch(error => console.error('Error:', error));
```

## Important Notes

1. **Timing**: Call the function immediately after OAuth login, before the user navigates away
2. **Scopes**: Make sure your Google OAuth request includes calendar scopes:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
3. **Access Token**: WeWeb should provide access to the user's Supabase access token for the Authorization header

## If WeWeb Can't Access URL Hash

If WeWeb can't access the URL hash parameters, you'll need to:
1. Use a Supabase Auth Hook (if available)
2. Or create a custom OAuth callback handler that stores tokens server-side

Let me know which approach works best for your WeWeb setup!

