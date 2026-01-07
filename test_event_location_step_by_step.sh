#!/bin/bash
# Step-by-step test for event_location - exits after each step for review

PHONE_NUMBER="+187778042361"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs"

echo "=========================================="
echo "Step-by-Step Auto Sync Test with event_location"
echo "=========================================="
echo ""
echo "Each step will execute and show the response."
echo "Review the response, then run the next step."
echo ""
echo "Press Ctrl+C to exit at any time"
echo ""

# Step 1: Start Auto Sync
echo "=========================================="
echo "STEP 1: Start Auto Sync"
echo "=========================================="
echo ""
echo "Command:"
echo "curl -s -X POST \"$FUNCTION_URL\" \\"
echo "  -H \"Authorization: Bearer $API_KEY\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"message\": \"auto sync\", \"phone_number\": \"$PHONE_NUMBER\", \"is_host\": true, \"send_sms\": false}' | python3 -m json.tool"
echo ""
echo "Response:"
echo "----------------------------------------"
RESPONSE1=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"auto sync\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }" | python3 -m json.tool)

echo "$RESPONSE1"
echo "----------------------------------------"
echo ""
echo "✅ Step 1 Complete - Review response above"
echo ""
echo "To continue, run:"
echo "  ./test_event_location_step_by_step.sh step2"
echo ""
exit 0

