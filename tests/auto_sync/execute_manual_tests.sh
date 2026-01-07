#!/bin/bash
# Execute manual curl tests for AS-001 to AS-010 with MCP setup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PHONE_NUMBER="+11231232323"
USER_ID="84174326-705e-4416-a756-416838cf4f26"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="reports/manual_test_report_${TIMESTAMP}.txt"
JSON_FILE="reports/manual_test_report_${TIMESTAMP}.json"

mkdir -p reports

# Initialize reports
cat > "$REPORT_FILE" <<EOF
Auto Sync Manual Curl Test Report
Phone: $PHONE_NUMBER
User ID: $USER_ID
Generated: $(date)
========================================

EOF

echo "[]" > "$JSON_FILE"

# Function to send curl
send_curl() {
  local message="$1"
  curl -s -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$message\",
      \"phone_number\": \"$PHONE_NUMBER\",
      \"is_host\": true,
      \"send_sms\": false
    }"
  sleep 1
}

# Function to log test
log_test() {
  local test_id="$1"
  local test_name="$2"
  local expected="$3"
  local request="$4"
  local response="$5"
  local status="$6"
  local notes="$7"
  
  cat >> "$REPORT_FILE" <<EOF

=== $test_id: $test_name ===
Expected: $expected
Request: $request
Response: $response
Status: $status
Notes: $notes
----------------------------------------

EOF

  # Update JSON
  python3 <<PYTHON
import json
import sys

with open("$JSON_FILE", "r") as f:
    data = json.load(f)

try:
    resp_json = json.loads('''$response''')
except:
    resp_json = {"raw": "$response"}

data.append({
    "test_id": "$test_id",
    "test_name": "$test_name",
    "expected": "$expected",
    "request": "$request",
    "response": resp_json,
    "status": "$status",
    "notes": "$notes"
})

with open("$JSON_FILE", "w") as f:
    json.dump(data, f, indent=2)
PYTHON

  echo "[$test_id] $status - $test_name"
}

echo "Starting manual curl tests for AS-001 to AS-010"
echo "Report: $REPORT_FILE"
echo ""

# AS-001: Start Auto Sync with no crews
echo "Testing AS-001..."
response=$(send_curl "auto sync")
if echo "$response" | grep -qi "don't have any crews\|no crews"; then
  log_test "AS-001" "Start Auto Sync with no crews" "System responds that no crews exist and exits" "auto sync" "$response" "PASS" "Correctly detected no crews"
else
  log_test "AS-001" "Start Auto Sync with no crews" "System responds that no crews exist and exits" "auto sync" "$response" "FAIL" "Did not detect no crews state"
fi

# Continue with other tests...
echo ""
echo "Test execution complete. See $REPORT_FILE for details."




