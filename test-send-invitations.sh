#!/bin/bash

# Test script for send-invitations function
# This script tests the send-invitations function with various scenarios

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ3MzQ4NzEsImV4cCI6MjA1MDMxMDg3MX0.8Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q"

echo "🧪 Testing send-invitations function..."
echo "======================================"

# Test 1: Missing event_id (should fail)
echo -e "\n🧪 Test 1: Missing event_id (Error case)"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "inviting_user_id": "test-user-123",
    "crew_id": "test-crew-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 2: Missing inviting_user_id (should fail)
echo -e "\n🧪 Test 2: Missing inviting_user_id (Error case)"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event-123",
    "crew_id": "test-crew-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 3: Missing both crew_id and selected_member_ids (should fail)
echo -e "\n🧪 Test 3: Missing both crew_id and selected_member_ids (Error case)"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event-123",
    "inviting_user_id": "test-user-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 4: Invalid event_id (should fail)
echo -e "\n🧪 Test 4: Invalid event_id (Error case)"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "non-existent-event-id",
    "inviting_user_id": "test-user-123",
    "crew_id": "test-crew-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 5: Invalid inviting_user_id (should fail)
echo -e "\n🧪 Test 5: Invalid inviting_user_id (Error case)"
echo "Expected: 500 error"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event-123",
    "inviting_user_id": "non-existent-user-id",
    "crew_id": "test-crew-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 6: Valid request with crew_id (will fail due to non-existent data, but tests structure)
echo -e "\n🧪 Test 6: Valid request structure with crew_id"
echo "Expected: 500 error (due to non-existent data), but tests request structure"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event-123",
    "inviting_user_id": "test-user-123",
    "crew_id": "test-crew-123"
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 7: Valid request with selected_member_ids (will fail due to non-existent data, but tests structure)
echo -e "\n🧪 Test 7: Valid request structure with selected_member_ids"
echo "Expected: 500 error (due to non-existent data), but tests request structure"
curl -X POST "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event-123",
    "inviting_user_id": "test-user-123",
    "selected_member_ids": ["member-1", "member-2", "member-3"]
  }' \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 8: OPTIONS request (CORS preflight)
echo -e "\n🧪 Test 8: OPTIONS request (CORS preflight)"
echo "Expected: 200 with CORS headers"
curl -X OPTIONS "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n" && sleep 1

# Test 9: GET request (should fail)
echo -e "\n🧪 Test 9: GET request (should fail)"
echo "Expected: 405 Method Not Allowed"
curl -X GET "${SUPABASE_URL}/functions/v1/send-invitations" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo -e "\n"
echo "✅ All tests completed!"
echo ""
echo "📝 Notes:"
echo "- Tests 1-5 should return 500 errors (expected)"
echo "- Tests 6-7 will fail due to non-existent data (expected)"
echo "- Test 8 should return 200 with CORS headers"
echo "- Test 9 should return 405 Method Not Allowed"
echo ""
echo "🔧 To test with real data:"
echo "1. Create actual test data in your database"
echo "2. Replace the test IDs with real ones"
echo "3. Run the tests again"
