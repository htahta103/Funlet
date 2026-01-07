#!/bin/bash
# Upload oauth-redirect.html to Supabase Storage with correct Content-Type
# Usage: ./upload-with-curl.sh YOUR_SERVICE_ROLE_KEY

if [ -z "$1" ]; then
  echo "❌ Error: SERVICE_ROLE_KEY is required"
  echo ""
  echo "Usage: ./upload-with-curl.sh YOUR_SERVICE_ROLE_KEY"
  echo ""
  echo "Get your service role key from:"
  echo "https://supabase.com/dashboard/project/jjkduivjlzazcvdeeqde/settings/api"
  exit 1
fi

SERVICE_ROLE_KEY="$1"
SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
BUCKET_NAME="oauth-callback"
FILE_NAME="oauth-redirect.html"
FILE_PATH="supabase/storage/oauth-callback/oauth-redirect.html"

echo "📤 Uploading $FILE_NAME to Supabase Storage..."
echo ""

# Upload with correct Content-Type
curl -X POST \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/${FILE_NAME}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: text/html" \
  -H "x-upsert: true" \
  --data-binary "@${FILE_PATH}" \
  -w "\n\nHTTP Status: %{http_code}\n"

echo ""
echo "✅ Upload complete!"
echo ""
echo "🔍 Verifying Content-Type..."
curl -I "${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FILE_NAME}" 2>&1 | grep -i "content-type"

echo ""
echo "🌐 Test URL:"
echo "${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FILE_NAME}"




