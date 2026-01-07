#!/bin/bash
# Step 5: Provide time options

PHONE_NUMBER="+187778042361"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs"

echo "=========================================="
echo "STEP 5: Provide Time Options"
echo "=========================================="
echo ""
echo "Command:"
echo "curl -s -X POST \"$FUNCTION_URL\" \\"
echo "  -H \"Authorization: Bearer $API_KEY\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"message\": \"Thu 1/9, 2-4pm, Fri 1/10, 3-5pm\", \"phone_number\": \"$PHONE_NUMBER\", \"is_host\": true, \"send_sms\": false}' | python3 -m json.tool"
echo ""
echo "Response:"
echo "----------------------------------------"
RESPONSE5=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Thu 1/9, 2-4pm, Fri 1/10, 3-5pm\",
    \"phone_number\": \"$PHONE_NUMBER\",
    \"is_host\": true,
    \"send_sms\": false
  }" | python3 -m json.tool)

echo "$RESPONSE5"
echo "----------------------------------------"
echo ""
echo "✅ Step 5 Complete - Review response above"
echo ""
echo "This should create the Auto Sync. To verify event_location:"
echo ""
echo "1. Check the database:"
echo "   SELECT id, event_name, event_location FROM auto_syncs ORDER BY created_at DESC LIMIT 1;"
echo ""
echo "2. Note: event_location will be NULL unless you modify the conversation state"
echo "   to include event_location in extracted_data before initialization"
echo ""
exit 0

