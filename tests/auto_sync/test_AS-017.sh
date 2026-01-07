#!/bin/bash
# AS-017: Save three options
# Expected: Organizer saves third option, system enforces max of three options

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Remove calendar tokens, create crew
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, provide three time options at once
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Provide three time options
start_time=$(date +%s)
response=$(send_message "1/10 6pm, 1/11 7pm, 1/12 8pm")
rate_limit_sleep

# Validate: Should accept all three and show max options message or proceed
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "maximum\|3 options\|response goal"; then
  log_test_result "AS-017" "PASS" "Three options handled correctly" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-017" "FAIL" "Three options not handled: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




