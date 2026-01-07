#!/bin/bash
# Fix Content-Type for oauth-redirect.html in Supabase Storage
# This script re-uploads the file with explicit Content-Type: text/html

if [ -z "$1" ]; then
  echo "❌ Error: SERVICE_ROLE_KEY is required"
  echo ""
  echo "Usage: ./fix-storage-content-type.sh YOUR_SERVICE_ROLE_KEY"
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

if [ ! -f "$FILE_PATH" ]; then
  echo "❌ Error: File not found: $FILE_PATH"
  exit 1
fi

echo "📤 Re-uploading $FILE_NAME with Content-Type: text/html..."
echo ""

# Delete existing file first (optional, but ensures clean upload)
echo "🗑️  Deleting existing file..."
curl -X DELETE \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/${FILE_NAME}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"

echo ""
echo "📤 Uploading with correct Content-Type..."

# Upload with explicit Content-Type header
RESPONSE=$(curl -X POST \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/${FILE_NAME}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "x-upsert: true" \
  --data-binary "@${FILE_PATH}" \
  -w "\nHTTP_STATUS:%{http_code}" \
  -s)

HTTP_STATUS=$(echo "$RESPONSE" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/HTTP_STATUS:[0-9]*$//')

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "✅ Upload successful! (HTTP $HTTP_STATUS)"
  echo ""
  echo "🔍 Verifying Content-Type..."
  sleep 2  # Wait a moment for CDN to update
  
  CONTENT_TYPE=$(curl -sI "${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FILE_NAME}" | grep -i "content-type" | cut -d: -f2 | tr -d ' \r\n')
  
  if [ "$CONTENT_TYPE" = "text/html" ] || [ "$CONTENT_TYPE" = "text/html; charset=utf-8" ]; then
    echo "✅ Content-Type is correct: $CONTENT_TYPE"
  else
    echo "⚠️  Content-Type is still: $CONTENT_TYPE"
    echo "   (Supabase Storage may override this based on file extension)"
    echo ""
    echo "💡 Recommendation: Use the Edge Function instead:"
    echo "   ${SUPABASE_URL}/functions/v1/serve-oauth-redirect"
  fi
else
  echo "❌ Upload failed! (HTTP $HTTP_STATUS)"
  echo "Response: $BODY"
  exit 1
fi

echo ""
echo "🌐 Test URL:"
echo "${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FILE_NAME}"




