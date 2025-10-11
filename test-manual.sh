#!/bin/bash

# Manual Step-by-Step Test Script
# Run each command individually and check the response

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ3MzQ4NzEsImV4cCI6MjA1MDMxMDg3MX0.8Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q"
TEST_PHONE="+18777804236"

echo "🧪 Manual Funlet SMS Handler Test"
echo "=================================="
echo "Test Phone: ${TEST_PHONE}"
echo ""

# Function to make SMS request
send_sms() {
    local message="$1"
    local description="$2"
    
    echo "📱 $description"
    echo "Message: \"$message\""
    echo ""
    
    curl -X POST "${SUPABASE_URL}/functions/v1/funlet-sms-handler" \
      -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"message\": \"$message\",
        \"phone_number\": \"${TEST_PHONE}\"
      }" \
      -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" \
      -s | jq '.' 2>/dev/null || echo "Response received (jq not available for formatting)"
    
    echo ""
    echo "Press ENTER to continue..."
    read -r
    echo ""
}

# Reset state first
echo "🧹 Step 0: Reset State"
echo "====================="
echo "Clearing conversation state and resetting onboarding..."

curl -X POST "${SUPABASE_URL}/functions/v1/clear-conversation-state" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"phone_number\": \"${TEST_PHONE}\"
  }" \
  -s | jq '.' 2>/dev/null || echo "State cleared"

echo ""
echo "Press ENTER to start testing..."
read -r
echo ""

# Test 1: Start Onboarding
send_sms "hi" "Test 1: Starting onboarding - should ask for crew name"

# Test 2: Provide Crew Name
send_sms "My crew is Basketball Team" "Test 2: Providing crew name - should ask for location"

# Test 3: Provide Location
send_sms "Central Park" "Test 3: Providing location - should ask for event name"

# Test 4: Provide Event Name
send_sms "Weekly Basketball Game" "Test 4: Providing event name - should ask for event date"

# Test 5: Provide Event Date
send_sms "Next Friday" "Test 5: Providing event date - should ask for event time"

# Test 6: Provide Event Time
send_sms "6:00 PM" "Test 6: Providing event time - should ask for crew members"

# Test 7: Provide Crew Members
send_sms "John Smith 555-1234, Jane Doe 555-5678" "Test 7: Providing crew members - should create crew and event, send invitations"

echo "✅ Onboarding flow completed!"
echo "Check your phone for SMS messages and database for created records."
