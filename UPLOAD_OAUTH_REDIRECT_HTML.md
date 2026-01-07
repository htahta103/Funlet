# Upload OAuth Redirect HTML to Supabase Storage

## Steps to Upload HTML File

1. **Verify Storage Bucket Exists**:
   - Go to Supabase Dashboard: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/storage/buckets
   - Look for bucket: `oauth-callback`
   - If it doesn't exist, create it:
     - Click "New bucket"
     - Name: `oauth-callback`
     - Make it **Public** (so the HTML page can be accessed)
     - Click "Create bucket"

2. **Upload HTML File**:
   - Go to the `oauth-callback` bucket
   - Click "Upload file"
   - Select: `supabase/storage/oauth-callback/oauth-redirect.html`
   - Upload path: `oauth-redirect.html` (root of bucket)
   - Click "Upload"

3. **Verify Public Access**:
   - The file should be accessible at:
     ```
     https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html
     ```
   - Open this URL in a browser to verify it loads correctly
   - Check browser console for any JavaScript errors

4. **Register URL in Supabase Dashboard**:
   - Go to: Authentication → URL Configuration → Redirect URLs
   - Add the storage HTML URL:
     ```
     https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html
     ```
   - This ensures Supabase allows redirects to this URL

## Alternative: Using Supabase CLI

```bash
# Create bucket (if needed)
supabase storage create oauth-callback --public

# Upload file
supabase storage upload oauth-callback oauth-redirect.html --file supabase/storage/oauth-callback/oauth-redirect.html
```

## How It Works

1. User calls `get-google-oauth-url` with `redirect_uri` parameter
2. Function generates OAuth URL with `redirect_to` pointing to storage HTML page
3. User authorizes with Google
4. Supabase redirects to storage HTML page with:
   - Tokens in URL hash: `#access_token=...&provider_token=...`
   - `redirect_uri` in query params: `?redirect_uri=...`
5. HTML page:
   - Extracts tokens from hash
   - Extracts `redirect_uri` from query params
   - Calls `store-google-calendar-tokens` to save tokens
   - Redirects to `redirect_uri` with hash preserved

## Benefits

- ✅ Easy to update HTML without redeploying function
- ✅ Can version control HTML separately
- ✅ Better caching (browser can cache the HTML file)
- ✅ Simpler architecture (no Edge Function needed for redirect)

## Troubleshooting

- **404 Error**: Ensure bucket is public and file is uploaded correctly
- **CORS Error**: Ensure storage bucket allows public access
- **Tokens not saving**: Check browser console for API call errors
- **Redirect not working**: Verify `redirect_uri` is correctly passed in query params




