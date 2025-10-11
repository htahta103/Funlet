#!/bin/bash

# Test SEND_INVITATIONS flow using curl
# Make sure to replace with your actual Supabase URL and service role key

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
SERVICE_ROLE_KEY="your_service_role_key_here"

echo "🧪 Testing SEND_INVITATIONS Flow with curl"
echo "=========================================="

# Test 1: Initial "create event" request
echo -e "\n1️⃣ Testing: User says 'create event'"
echo "Expected: Ask for all event details at once"

curl -X POST "${SUPABASE_URL}/functions/v1/funlet-sms-handler" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "create event",
    "phone_number": "+1234567890",
    "user_id": "test-user-123"
  }' \
  --silent --show-error

echo -e "\n\n2️⃣ Testing: User provides complete event details"
echo "Expected: Show confirmation and ask to send invites"

curl -X POST "${SUPABASE_URL}/functions/v1/funlet-sms-handler" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Basketball Game, tomorrow, 6pm, Community Center, Bring your own ball",
    "phone_number": "+1234567890",
    "user_id": "test-user-123"
  }' \
  --silent --show-error

echo -e "\n\n3️⃣ Testing: User provides partial details"
echo "Expected: Ask for missing fields"

curl -X POST "${SUPABASE_URL}/functions/v1/funlet-sms-handler" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Basketball Game, tomorrow",
    "phone_number": "+1234567890",
    "user_id": "test-user-123"
  }' \
  --silent --show-error

echo -e "\n\n4️⃣ Testing: User confirms with 'yes'"
echo "Expected: Create event and send invitations"

curl -X POST "${SUPABASE_URL}/functions/v1/funlet-sms-handler" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "yes",
    "phone_number": "+1234567890",
    "user_id": "test-user-123"
  }' \
  --silent --show-error

echo -e "\n\n✅ Test completed!"
echo "Note: Replace SERVICE_ROLE_KEY with your actual Supabase service role key"
