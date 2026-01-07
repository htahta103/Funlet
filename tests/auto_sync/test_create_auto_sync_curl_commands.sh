#!/bin/bash
# Curl commands for testing Auto Sync creation step by step
# Copy and run each command one at a time

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh

echo "=========================================="
echo "Auto Sync Creation - Curl Commands"
echo "=========================================="
echo ""
echo "Phone Number: $TEST_PHONE_NUMBER"
echo "Function URL: $FUNCTION_URL"
echo ""
echo "=========================================="
echo ""

echo "STEP 1: Exit any current auto sync setup"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "exit",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "STEP 2: Start Auto Sync with crew name"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "auto sync Friends",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "STEP 3: Provide event name"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test Event",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "STEP 4: Provide time (no calendar mode)"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "1/10 6pm",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "STEP 5: Select goal (1 = Everyone, 2 = Critical mass)"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "1",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "STEP 6: Send Auto Sync"
echo "----------------------------------------"
cat << 'EOF'
curl -s -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "send",
    "phone_number": "+18777804236",
    "is_host": true,
    "send_sms": false
  }' | python3 -m json.tool
EOF

echo ""
echo ""
echo "=========================================="
echo "All commands listed above"
echo "=========================================="

