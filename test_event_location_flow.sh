#!/bin/bash
# Test event_location flow in Auto Sync

PHONE_NUMBER="+187778042361"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs"

echo "=========================================="
echo "Testing event_location in Auto Sync Flow"
echo "=========================================="
echo ""

# Step 1: Start Auto Sync
echo "Step 1: Starting Auto Sync..."
RESPONSE1=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"auto sync\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }")

echo "Response: $(echo $RESPONSE1 | python3 -c "import sys, json; print(json.load(sys.stdin).get('response', ''))" 2>/dev/null)"
sleep 1

# Step 2: Select crew (assuming option 1)
echo ""
echo "Step 2: Selecting crew (option 1)..."
RESPONSE2=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"1\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }")

echo "Response: $(echo $RESPONSE2 | python3 -c "import sys, json; print(json.load(sys.stdin).get('response', ''))" 2>/dev/null)"
sleep 1

# Step 3: Provide event name
echo ""
echo "Step 3: Providing event name..."
RESPONSE3=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Team Meeting\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }")

echo "Response: $(echo $RESPONSE3 | python3 -c "import sys, json; print(json.load(sys.stdin).get('response', ''))" 2>/dev/null)"
sleep 1

# Step 4: Check conversation state to see if we can add location
echo ""
echo "Step 4: Checking conversation state..."
echo "Note: To test event_location, we need to modify the conversation state"
echo "      to include event_location in extracted_data before initialization"
echo ""

# Step 5: Provide time options (if in no-calendar mode)
echo ""
echo "Step 5: Providing time options..."
RESPONSE4=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Thu 1/9, 2-4pm, Fri 1/10, 3-5pm\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }")

RESPONSE_TEXT=$(echo $RESPONSE4 | python3 -c "import sys, json; print(json.load(sys.stdin).get('response', ''))" 2>/dev/null)
echo "Response: $RESPONSE_TEXT"

# Check if Auto Sync was created
if echo "$RESPONSE_TEXT" | grep -qi "invitations\|sent\|created"; then
  echo ""
  echo "✅ Auto Sync appears to have been created!"
  echo ""
  echo "To verify event_location was stored:"
  echo "1. Check the database: SELECT id, event_name, event_location FROM auto_syncs ORDER BY created_at DESC LIMIT 1;"
  echo "2. Or check via Supabase dashboard"
else
  echo ""
  echo "⚠️  Auto Sync may not have completed. Check the response above."
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "To fully test event_location:"
echo "1. The SMS conversation flow needs to collect location"
echo "2. Location should be added to extracted_data before initializeAutoSync is called"
echo "3. Check that event_location is stored in the database"
echo "4. Verify location is used when creating calendar events and regular events"
echo ""

