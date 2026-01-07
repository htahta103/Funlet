#!/bin/bash
# Step 4: Provide response goal

PHONE_NUMBER="+187778042361"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs"

echo "=========================================="
echo "STEP 4: Provide Response Goal (1 = Everyone)"
echo "=========================================="
echo ""
echo "Command:"
echo "curl -s -X POST \"$FUNCTION_URL\" \\"
echo "  -H \"Authorization: Bearer $API_KEY\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"message\": \"1\", \"phone_number\": \"$PHONE_NUMBER\", \"is_host\": true, \"send_sms\": false}' | python3 -m json.tool"
echo ""
echo "Response:"
echo "----------------------------------------"
RESPONSE4=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"1\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }" | python3 -m json.tool)

echo "$RESPONSE4"
echo "----------------------------------------"
echo ""
echo "✅ Step 4 Complete - Review response above"
echo ""
echo "To continue, run:"
echo "  ./test_event_location_step5.sh"
echo ""
exit 0

