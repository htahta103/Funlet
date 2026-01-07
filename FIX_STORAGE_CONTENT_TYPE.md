# Fix Storage Content-Type Issue

## Problem
Supabase Storage is serving `oauth-redirect.html` with `Content-Type: text/plain` instead of `text/html`, causing browsers to display raw HTML instead of rendering it.

## Solution Options

### ✅ Option 1: Use Edge Function (Recommended - Already Working)

The `serve-oauth-redirect` Edge Function already serves the HTML with the correct `Content-Type: text/html`. This is the recommended solution and is already configured in `get-google-oauth-url`.

**Edge Function URL:**
```
https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/serve-oauth-redirect
```

**Status:** ✅ Already deployed and working

---

### Option 2: Fix Storage File Content-Type

If you want to use the storage file directly, try re-uploading it with the correct Content-Type:

1. **Get your Service Role Key:**
   - Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/settings/api
   - Copy the `service_role` key (⚠️ Keep this secret!)

2. **Run the fix script:**
   ```bash
   ./fix-storage-content-type.sh YOUR_SERVICE_ROLE_KEY
   ```

3. **Verify:**
   ```bash
   curl -I "https://jjkduivjlzazcvdeeqde.supabase.co/storage/v1/object/public/oauth-callback/oauth-redirect.html" | grep -i content-type
   ```

**Note:** Supabase Storage may still serve the file as `text/plain` even after re-uploading, as it uses file extension detection. The Edge Function is more reliable.

---

### Option 3: Manual Upload via Supabase Dashboard

1. Go to: https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/storage/buckets/oauth-callback
2. Delete the existing `oauth-redirect.html` file
3. Upload a new file with the same name
4. **Important:** After upload, you may need to use the Supabase API to update the Content-Type metadata

---

## Current Status

- ✅ Edge Function: Working correctly with `Content-Type: text/html`
- ❌ Storage File: Serving as `Content-Type: text/plain`

## Recommendation

**Use the Edge Function** (`serve-oauth-redirect`) instead of the storage file directly. It's already configured and working correctly.




