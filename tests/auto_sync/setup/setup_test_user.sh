#!/bin/bash
# Setup test user - verify user exists with phone number

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

source test_config.sh

echo "Verifying test user exists..."
echo "Phone: $TEST_PHONE_NUMBER"
echo "User ID: $TEST_USER_ID"

# Verify user exists
response=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/profiles?id=eq.$TEST_USER_ID&select=id,phone_number" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY")

user_exists=$(echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print('true' if len(data) > 0 else 'false')" 2>/dev/null || echo "false")

if [[ "$user_exists" == "true" ]]; then
  echo "✓ Test user exists"
  exit 0
else
  echo "✗ Test user not found"
  exit 1
fi




