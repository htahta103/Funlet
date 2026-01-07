# Upload OAuth Redirect HTML with Correct Content-Type

## Problem
The HTML file is either:
1. Not found (404 error)
2. Has wrong Content-Type (`text/plain` instead of `text/html`)

## Solution: Upload with Correct Content-Type

### Option 1: Using the Upload Script (Recommended)

1. **Set your service role key**:
   ```bash
   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```
   
   Get your service role key from: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/settings/api

2. **Run the upload script**:
   ```bash
   deno run --allow-net --allow-read upload-oauth-html.js
   ```

This will:
- Read the HTML file
- Upload it with `Content-Type: text/html`
- Replace any existing file
- Verify the upload

### Option 2: Using Supabase CLI

```bash
# Make sure you're logged in and linked
supabase login
supabase link --project-ref jjkduivjlzazcvdeeqde

# Upload with explicit content type
supabase storage upload oauth-callback oauth-redirect.html \
  --file supabase/storage/oauth-callback/oauth-redirect.html \
  --content-type text/html
```

### Option 3: Manual Upload via Dashboard

1. Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/storage/buckets/oauth-callback

2. **Delete any existing files** with similar names (check for spaces or duplicates)

3. **Upload the file**:
   - Click "Upload file"
   - Select: `supabase/storage/oauth-callback/oauth-redirect.html`
   - **Important**: The file must be named exactly `oauth-redirect.html` (no spaces, no `(1)`, etc.)

4. **Verify the file**:
   - Visit: https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html
   - Open DevTools (F12) → Network tab
   - Check response headers - `Content-Type` should be `text/html`

### Option 4: Using curl (if you have service role key)

```bash
curl -X POST \
  "https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/oauth-callback/oauth-redirect.html" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: text/html" \
  -H "x-upsert: true" \
  --data-binary "@supabase/storage/oauth-callback/oauth-redirect.html"
```

## Verify It's Working

After uploading:

1. **Check the URL**:
   ```
   https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html
   ```

2. **You should see**:
   - Purple gradient background
   - Spinning loader animation
   - "Connecting Google Calendar..." heading
   - NOT raw HTML code

3. **Check browser console** (F12):
   - Should see logs like "🔍 Current URL:", "📋 Hash params:", etc.
   - No JavaScript errors

4. **Check Network tab**:
   - Response header: `Content-Type: text/html; charset=utf-8`
   - Status: `200 OK` (not 404)

## Troubleshooting

- **Still seeing raw HTML?** Clear browser cache (Ctrl+Shift+Delete) or use incognito mode
- **404 error?** Check the file name in storage - must be exactly `oauth-redirect.html` (no spaces)
- **Wrong Content-Type?** Re-upload using one of the methods above that explicitly sets Content-Type




