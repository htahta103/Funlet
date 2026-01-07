#!/bin/bash
# Auto Sync Test Utilities

source "$(dirname "$0")/test_config.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Send message to Auto Sync function
send_message() {
  local message="$1"
  local response
  
  response=$(curl -s -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$message\",
      \"phone_number\": \"$TEST_PHONE_NUMBER\",
      \"is_host\": true,
      \"send_sms\": false
    }" 2>&1)
  
  echo "$response"
}

# Extract response text from JSON
extract_response() {
  local json="$1"
  echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('response', ''))" 2>/dev/null || echo ""
}

# Extract action from JSON
extract_action() {
  local json="$1"
  echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('action', ''))" 2>/dev/null || echo ""
}

# Extract success status from JSON
extract_success() {
  local json="$1"
  echo "$json" | python3 -c "import sys, json; data = json.load(sys.stdin); print(str(data.get('success', False)).lower())" 2>/dev/null || echo "false"
}

# Check if response contains text (case-insensitive)
check_response_contains() {
  local response="$1"
  local expected="$2"
  local response_lower=$(echo "$response" | tr '[:upper:]' '[:lower:]')
  local expected_lower=$(echo "$expected" | tr '[:upper:]' '[:lower:]')
  
  if [[ "$response_lower" == *"$expected_lower"* ]]; then
    return 0
  else
    return 1
  fi
}

# Check if action matches expected
check_action() {
  local json="$1"
  local expected_action="$2"
  local actual_action=$(extract_action "$json")
  
  if [[ "$actual_action" == "$expected_action" ]]; then
    return 0
  else
    return 1
  fi
}

# Clear conversation state for test user
clear_conversation_state() {
  curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/clear_conversation_state" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\": \"$TEST_USER_ID\"}" > /dev/null 2>&1 || true
  
  # Alternative: Direct SQL update via Supabase MCP or direct API call
  # For now, we'll use a simple approach - the state will be cleared by starting new workflows
}

# Wait for a specific state (with timeout)
wait_for_state() {
  local expected_state="$1"
  local timeout="${2:-10}"
  local elapsed=0
  
  while [ $elapsed -lt $timeout ]; do
    # Check conversation state (would need to query database)
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

# Log test result
log_test_result() {
  local test_id="$1"
  local status="$2"
  local message="$3"
  local duration="${4:-0}"
  
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $test_id: $status (${duration}s) - $message" >> "$TEST_LOG_FILE"
  
  if [[ "$status" == "PASS" ]]; then
    echo -e "${GREEN}✓${NC} $test_id: PASS"
  else
    echo -e "${RED}✗${NC} $test_id: FAIL - $message"
  fi
}

# Validate response and log result
validate_test() {
  local test_id="$1"
  local response_json="$2"
  local expected_text="$3"
  local expected_action="${4:-}"
  local start_time="$5"
  
  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  
  local response_text=$(extract_response "$response_json")
  local success=$(extract_success "$response_json")
  
  # Check if request was successful
  if [[ "$success" != "true" ]]; then
    log_test_result "$test_id" "FAIL" "Request failed: $response_json" "$duration"
    return 1
  fi
  
  # Check response text if expected text provided
  if [[ -n "$expected_text" ]]; then
    if ! check_response_contains "$response_text" "$expected_text"; then
      log_test_result "$test_id" "FAIL" "Response doesn't contain '$expected_text'. Got: '$response_text'" "$duration"
      return 1
    fi
  fi
  
  # Check action if expected action provided
  if [[ -n "$expected_action" ]]; then
    if ! check_action "$response_json" "$expected_action"; then
      local actual_action=$(extract_action "$response_json")
      log_test_result "$test_id" "FAIL" "Action mismatch. Expected: '$expected_action', Got: '$actual_action'" "$duration"
      return 1
    fi
  fi
  
  log_test_result "$test_id" "PASS" "Test passed" "$duration"
  return 0
}

# Sleep with rate limiting
rate_limit_sleep() {
  sleep "$RATE_LIMIT_DELAY"
}

