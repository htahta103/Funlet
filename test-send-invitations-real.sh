#!/bin/bash

# Test script for send-invitations function with REAL DATA
# This script tests the send-invitations function with actual data from the database

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ3MzQ4NzEsImV4cCI6MjA1MDMxMDg3MX0.8Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q"

# Real data from database
EVENT_ID="79fcddcf-30a5-4293-a098-c8f0728a84e7"  # "Weekly Basketball Game"
USER_ID="7fee0a0c-e0e3-4ec4-a6d8-e6ee668f2f0f"   # Creator of the event
CREW_ID="1a52c32b-9421-4cd2-aa9a-2c1fdce3e859"   # "Basketball team"
MEMBER_IDS=("89d89f38-7f1b-48ce-9ed1-5c14db583bb9" "c3ae49d9-ffff-48f8-b8b3-d00ba0cf3d48" "57be30eb-d8d1-42df-9c31-0eaf63891819")

echo "🧪 Testing send-invitations function with REAL DATA"
echo "=================================================="
echo "Event: Weekly Basketball Game (${EVENT_ID})"
echo "User: ${USER_ID}"
echo "Crew: Basketball team (${CREW_ID})"
echo "Members: Alice, Bob, Tung, John, Jane"
echo ""

# Test 1: Send invitations to entire crew
echo -e "\n🧪 Test 1: Send invitations to entire crew"
echo "Expected: 200 success (if Twilio credentials are configured)"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"${EVENT_ID}\",
    \"inviting_user_id\": \"${USER_ID}\",
    \"crew_id\": \"${CREW_ID}\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 2

# Test 2: Send invitations to specific members
echo -e "\n🧪 Test 2: Send invitations to specific members"
echo "Expected: 200 success (if Twilio credentials are configured)"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"${EVENT_ID}\",
    \"inviting_user_id\": \"${USER_ID}\",
    \"selected_member_ids\": [\"${MEMBER_IDS[0]}\", \"${MEMBER_IDS[1]}\"]
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 2

# Test 3: Test with different event (should work if event exists)
echo -e "\n🧪 Test 3: Test with different event"
echo "Expected: 200 success (if Twilio credentials are configured)"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"6d3519bc-763c-4b09-9f4a-c9f2b2344e19\",
    \"inviting_user_id\": \"${USER_ID}\",
    \"crew_id\": \"${CREW_ID}\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 2

# Test 4: Test error handling with invalid event
echo -e "\n🧪 Test 4: Test error handling with invalid event"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"invalid-event-id\",
    \"inviting_user_id\": \"${USER_ID}\",
    \"crew_id\": \"${CREW_ID}\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 2

# Test 5: Test error handling with invalid user
echo -e "\n🧪 Test 5: Test error handling with invalid user"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"${EVENT_ID}\",
    \"inviting_user_id\": \"invalid-user-id\",
    \"crew_id\": \"${CREW_ID}\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 2

# Test 6: Test error handling with invalid crew
echo -e "\n🧪 Test 6: Test error handling with invalid crew"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"${EVENT_ID}\",
    \"inviting_user_id\": \"${USER_ID}\",
    \"crew_id\": \"invalid-crew-id\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n"
echo "✅ All tests completed!"
echo ""
echo "📝 Notes:"
echo "- Tests 1-3 should work if Twilio credentials are properly configured"
echo "- Tests 4-6 should return 500 errors (expected)"
echo "- Check the response for detailed error messages"
echo ""
echo "🔧 To check if SMS was actually sent:"
echo "1. Check the Twilio console for sent messages"
echo "2. Check the invitations table in the database"
echo "3. Look for SMS delivery status in the response"
