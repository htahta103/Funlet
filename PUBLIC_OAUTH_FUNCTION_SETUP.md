# Making get-google-oauth-url Function Public

## Issue

Supabase Edge Functions require authentication by default. To make `get-google-oauth-url` truly public (no auth needed), you need to configure it in the Supabase Dashboard.

## Solution: Configure Function as Public

### Option 1: Supabase Dashboard (Recommended)

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/functions
2. Find `get-google-oauth-url` function
3. Click on it to open settings
4. Look for **"Verify JWT"** or **"Authentication"** setting
5. **Disable JWT verification** or set to **"Public"**
6. Save changes

### Option 2: Function Configuration

Some Supabase setups allow configuring functions in `config.toml`:

```toml
[functions.get-google-oauth-url]
verify_jwt = false  # Make function public
```

### Option 3: Use Service Role Key (Server-Side Only)

If you're calling from a server, you can use the service role key:

```javascript
const response = await fetch(
  'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,  // Server-side only!
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redirect_uri: 'https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback'
      // No user_id needed - works before login
    })
  }
)
```

## Current Status

✅ **Function code is ready** - Works without user_id  
⚠️ **Gateway requires auth** - Needs to be configured as public in dashboard  

## Usage (Once Public)

```javascript
// No authentication needed - works before user logs in!
const response = await fetch(
  'https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redirect_uri: 'https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback'
      // user_id is optional - not needed before login
    })
  }
)

const { authorization_url } = await response.json()
window.location.href = authorization_url
```

## Testing

Once configured as public, test with:

```bash
curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/get-google-oauth-url" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uri": "https://jjkduivjlzazcvdeeqde.supabase.co/auth/v1/callback"}'
```

Should return `authorization_url` without any authentication.




