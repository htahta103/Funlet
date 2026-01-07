# Fix HTML Content-Type in Supabase Storage

## Problem
The HTML file is being served with `Content-Type: text/plain` instead of `Content-Type: text/html`, causing browsers to display the raw HTML code instead of rendering it.

## Solution: Re-upload with Correct Content-Type

### Option 1: Using Supabase Dashboard (Recommended)

1. **Delete the existing file**:
   - Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/storage/buckets/oauth-callback
   - Find `oauth-redirect.html`
   - Click the three dots (⋯) → Delete

2. **Re-upload with correct Content-Type**:
   - Click "Upload file"
   - Select `supabase/storage/oauth-callback/oauth-redirect.html`
   - **Important**: Before uploading, if there's a "Content-Type" or "MIME type" option, set it to `text/html`
   - If no option is available, the file extension `.html` should automatically set it, but you may need to verify

3. **Verify the Content-Type**:
   - Open browser DevTools (F12)
   - Go to Network tab
   - Visit: https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html
   - Check the response headers - `Content-Type` should be `text/html; charset=utf-8`

### Option 2: Using Supabase CLI

```bash
# Make sure you're logged in
supabase login

# Link to your project
supabase link --project-ref jjkduivjlzazcvdeeqde

# Upload with explicit content type
supabase storage upload oauth-callback oauth-redirect.html \
  --file supabase/storage/oauth-callback/oauth-redirect.html \
  --content-type text/html
```

### Option 3: Using JavaScript/TypeScript (Programmatic)

If you have access to the Supabase client with service role key:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://jjkduivjlzazcvdeeqde.supabase.co',
  'YOUR_SERVICE_ROLE_KEY'
)

// Read the HTML file
const htmlContent = await Deno.readTextFile('supabase/storage/oauth-callback/oauth-redirect.html')

// Upload with correct content type
const { data, error } = await supabase.storage
  .from('oauth-callback')
  .upload('oauth-redirect.html', htmlContent, {
    contentType: 'text/html',
    upsert: true // Replace existing file
  })
```

## Verification

After re-uploading, test the URL:
- https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html

The page should render with:
- Purple gradient background
- Spinning loader
- "Connecting Google Calendar..." heading
- "Processing authentication..." status message

If you still see raw HTML code, clear your browser cache or try in an incognito window.

## Alternative: Use Edge Function as Proxy

If Content-Type issues persist, you could create a simple Edge Function that serves the HTML with correct headers:

```typescript
// supabase/functions/serve-oauth-redirect/index.ts
Deno.serve(async (req) => {
  const html = await fetch('https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html')
    .then(r => r.text())
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    }
  })
})
```

But the storage solution should work once Content-Type is set correctly.




