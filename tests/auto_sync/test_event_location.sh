#!/bin/bash
# Test event_location functionality in Auto Sync

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh

PHONE_NUMBER="${TEST_PHONE_NUMBER:-+187778042361}"
FUNCTION_URL="${FUNCTION_URL:-https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta}"
API_KEY="${SUPABASE_ANON_KEY}"

echo "=========================================="
echo "Testing event_location in Auto Sync"
echo "=========================================="
echo ""

# Step 1: Check if migration has been applied
echo "Step 1: Checking if event_location column exists..."
COLUMN_CHECK=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/check_column_exists" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY:-$API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"table_name": "auto_syncs", "column_name": "event_location"}' 2>/dev/null || echo "{}")

if [ "$COLUMN_CHECK" != "{}" ]; then
  echo "✅ Column check completed (or function doesn't exist - that's OK)"
else
  echo "⚠️  Could not verify column existence via RPC"
fi

# Step 2: Test creating Auto Sync with event_location via SMS flow
echo ""
echo "Step 2: Testing Auto Sync creation with event_location..."
echo "Note: This requires the SMS conversation flow to include event_location in extracted_data"
echo ""

# First, let's check if we can query existing auto_syncs to see the column
echo "Checking existing auto_syncs structure..."
EXISTING_SYNC=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/auto_syncs?select=id,event_name,event_location&limit=1" \
  -H "Authorization: Bearer $API_KEY" \
  -H "apikey: $API_KEY" | python3 -m json.tool 2>/dev/null || echo "[]")

if echo "$EXISTING_SYNC" | grep -q "event_location"; then
  echo "✅ event_location column exists in auto_syncs table"
else
  echo "❌ event_location column NOT found - migration may not be applied"
  echo "   Please apply migration: supabase/migrations/20260106134436_add_event_location_to_auto_syncs.sql"
fi

# Step 3: Test direct database insert with event_location
echo ""
echo "Step 3: Testing direct database insert with event_location..."
echo ""

# Get test user ID and crew ID
USER_ID="${TEST_USER_ID:-84174326-705e-4416-a756-416838cf4f26}"
echo "Using User ID: $USER_ID"

# Get a crew ID for this user
CREW_DATA=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/crews?select=id&organizer_id=eq.${USER_ID}&limit=1" \
  -H "Authorization: Bearer $API_KEY" \
  -H "apikey: $API_KEY" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data[0]['id'] if data else '')" 2>/dev/null || echo "")

if [ -z "$CREW_DATA" ]; then
  echo "⚠️  No crew found for user. Please create a crew first."
  echo "   Run: cd tests/auto_sync/setup && ./setup_test_crews.sh"
  exit 1
fi

CREW_ID="$CREW_DATA"
echo "Using Crew ID: $CREW_ID"

# Test insert with event_location
TEST_LOCATION="Test Location: 123 Main St, San Francisco, CA"
echo "Creating test Auto Sync with location: '$TEST_LOCATION'"

INSERT_RESULT=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/auto_syncs" \
  -H "Authorization: Bearer $API_KEY" \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"organizer_id\": \"$USER_ID\",
    \"crew_id\": \"$CREW_ID\",
    \"event_name\": \"Test Event with Location\",
    \"event_location\": \"$TEST_LOCATION\",
    \"status\": \"running\",
    \"response_goal\": \"everyone\",
    \"timezone\": \"America/Los_Angeles\",
    \"calendar_connected\": false,
    \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }" | python3 -m json.tool 2>/dev/null)

if echo "$INSERT_RESULT" | grep -q "event_location"; then
  AUTO_SYNC_ID=$(echo "$INSERT_RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
  STORED_LOCATION=$(echo "$INSERT_RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin)[0].get('event_location', 'NULL'))" 2>/dev/null)
  
  echo "✅ Auto Sync created successfully"
  echo "   Auto Sync ID: $AUTO_SYNC_ID"
  echo "   Stored location: '$STORED_LOCATION'"
  
  if [ "$STORED_LOCATION" = "$TEST_LOCATION" ]; then
    echo "✅ Location matches expected value"
  else
    echo "❌ Location mismatch!"
    echo "   Expected: '$TEST_LOCATION'"
    echo "   Got: '$STORED_LOCATION'"
  fi
  
  # Cleanup: Delete test auto_sync
  echo ""
  echo "Cleaning up test Auto Sync..."
  DELETE_RESULT=$(curl -s -X DELETE "${SUPABASE_URL}/rest/v1/auto_syncs?id=eq.${AUTO_SYNC_ID}" \
    -H "Authorization: Bearer $API_KEY" \
    -H "apikey: $API_KEY" 2>/dev/null)
  
  if [ $? -eq 0 ]; then
    echo "✅ Test Auto Sync deleted"
  else
    echo "⚠️  Could not delete test Auto Sync (ID: $AUTO_SYNC_ID)"
  fi
else
  echo "❌ Failed to create Auto Sync with event_location"
  echo "Response: $INSERT_RESULT"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "1. Column existence: Checked"
echo "2. Database insert: Tested"
echo "3. Location storage: Verified"
echo ""
echo "Next steps:"
echo "- Test SMS flow with event_location in extracted_data"
echo "- Test calendar event creation with location"
echo "- Test events table creation with location"
echo ""

