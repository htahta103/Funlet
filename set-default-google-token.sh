#!/bin/bash
# Set default Google access token for a user
# Usage: ./set-default-google-token.sh USER_ID [REFRESH_TOKEN]

if [ -z "$1" ]; then
  echo "❌ Error: USER_ID is required"
  echo ""
  echo "Usage: ./set-default-google-token.sh USER_ID [REFRESH_TOKEN]"
  echo ""
  echo "Example:"
  echo "  ./set-default-google-token.sh 84174326-705e-4416-a756-416838cf4f26"
  echo ""
  exit 1
fi

USER_ID="$1"
REFRESH_TOKEN="$2"

# Default Google access token provided by user
# Set via environment variable or replace with your token
ACCESS_TOKEN="${GOOGLE_ACCESS_TOKEN:-YOUR_ACCESS_TOKEN_HERE}"

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

echo "📤 Setting default Google access token for user: $USER_ID"
echo ""

# Calculate expires_at (1 hour from now)
EXPIRES_AT=$(date -u -v+1H +%s 2>/dev/null || date -u -d "+1 hour" +%s 2>/dev/null || echo $(($(date +%s) + 3600)))

# Prepare request body
REQUEST_BODY=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "provider_token": "$ACCESS_TOKEN",
  "provider_refresh_token": "${REFRESH_TOKEN:-null}",
  "expires_at": $EXPIRES_AT,
  "expires_in": 3600,
  "scope": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"
}
EOF
)

echo "📋 Request details:"
echo "  User ID: $USER_ID"
echo "  Access Token: ${ACCESS_TOKEN:0:30}..."
echo "  Refresh Token: ${REFRESH_TOKEN:-'Not provided'}"
echo "  Expires At: $EXPIRES_AT ($(date -u -r $EXPIRES_AT 2>/dev/null || date -u -d "@$EXPIRES_AT" 2>/dev/null || echo 'N/A'))"
echo ""

# Call store-google-calendar-tokens function
echo "🔄 Calling store-google-calendar-tokens..."
RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/store-google-calendar-tokens" \
  -H "Content-Type: application/json" \
  -H "apikey: ${ANON_KEY}" \
  -d "$REQUEST_BODY")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "✅ Done!"




