#!/bin/bash
# Manual Curl Testing for AS-001 to AS-010
# Tests Auto Sync functionality using curl commands with MCP setup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configuration
PHONE_NUMBER="+11231232323"
USER_ID="84174326-705e-4416-a756-416838cf4f26"
FUNCTION_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

REPORT_DIR="reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/manual_test_report_${TIMESTAMP}.txt"
JSON_FILE="${REPORT_DIR}/manual_test_report_${TIMESTAMP}.json"

mkdir -p "$REPORT_DIR"

# Initialize reports
cat > "$REPORT_FILE" <<EOF
Auto Sync Manual Curl Test Report
Phone: $PHONE_NUMBER
User ID: $USER_ID
Generated: $(date)
========================================

EOF

echo "[]" > "$JSON_FILE"

# Function to send curl request and capture response
send_curl() {
  local message="$1"
  local response
  
  response=$(curl -s -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$message\",
      \"phone_number\": \"$PHONE_NUMBER\",
      \"is_host\": true,
      \"send_sms\": false
    }")
  
  echo "$response"
  sleep 1
}

# Function to log test result
log_test() {
  local test_id="$1"
  local test_name="$2"
  local expected="$3"
  local request="$4"
  local response="$5"
  local status="$6"
  local notes="$7"
  
  # Log to text file
  cat >> "$REPORT_FILE" <<EOF

=== $test_id: $test_name ===
Expected: $expected
Request: $request
Response: $response
Status: $status
Notes: $notes
----------------------------------------

EOF

  # Add to JSON file
  local temp_json=$(mktemp)
  python3 <<PYTHON
import json
import sys

with open("$JSON_FILE", "r") as f:
    data = json.load(f)

data.append({
    "test_id": "$test_id",
    "test_name": "$test_name",
    "expected": "$expected",
    "request": "$request",
    "response": json.loads('''$response''') if '$response' else None,
    "status": "$status",
    "notes": "$notes"
})

with open("$JSON_FILE", "w") as f:
    json.dump(data, f, indent=2)
PYTHON
  rm -f "$temp_json"
}

# Function to clear conversation state (using MCP would be ideal, but we'll use SQL)
clear_conversation_state() {
  echo "Clearing conversation state for user $USER_ID..."
  # This will be done via MCP in the actual test execution
}

echo "Starting manual curl tests for AS-001 to AS-010"
echo "Report will be saved to: $REPORT_FILE"
echo ""

# Test cases will be executed below
# Each test will be implemented with MCP setup, curl execution, and logging




