# Upload OAuth Callback HTML to Supabase Storage

## Steps to Upload HTML File

1. **Create Storage Bucket** (if not exists):
   - Go to Supabase Dashboard: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/storage/buckets
   - Click "New bucket"
   - Name: `oauth-callback`
   - Make it **Public** (so the Edge Function can read it)
   - Click "Create bucket"

2. **Upload HTML File**:
   - Go to the `oauth-callback` bucket
   - Click "Upload file"
   - Select: `supabase/storage/oauth-callback/loading.html`
   - Upload path: `loading.html` (root of bucket)
   - Click "Upload"

3. **Verify Public Access**:
   - The file should be accessible at:
     ```
     https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/loading.html
     ```

## Alternative: Using Supabase CLI

```bash
# Create bucket (if needed)
supabase storage create oauth-callback --public

# Upload file
supabase storage upload oauth-callback loading.html --file supabase/storage/oauth-callback/loading.html
```

## How It Works

1. Edge Function tries to load HTML from storage bucket `oauth-callback`, file `loading.html`
2. If found, uses that HTML
3. If not found, falls back to embedded HTML in the function
4. Replaces placeholders `{{SUPABASE_URL}}`, `{{ANON_KEY}}`, `{{REDIRECT_URI}}` with actual values
5. Returns HTML to browser

## Benefits

- ✅ Easy to update HTML without redeploying function
- ✅ Can version control HTML separately
- ✅ Better caching (browser can cache the HTML file)
- ✅ Fallback to embedded HTML if storage fails




