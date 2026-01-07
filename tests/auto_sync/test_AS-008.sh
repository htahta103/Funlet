#!/bin/bash
# AS-008: No calendar prompt shown
# Expected: System does not prompt to connect calendar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Remove calendar tokens and create crew
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep

# Test: Provide event name
start_time=$(date +%s)
response=$(send_message "Test Event")
rate_limit_sleep

# Validate: Should NOT mention connecting calendar
response_text=$(extract_response "$response")
if ! echo "$response_text" | grep -qi "connect.*calendar\|calendar.*connect"; then
  log_test_result "AS-008" "PASS" "No calendar prompt shown" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-008" "FAIL" "Calendar prompt was shown: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




