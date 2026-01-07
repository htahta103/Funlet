#!/bin/bash
# AS-012: Calendar week navigation
# Expected: Organizer suggests time in different week, new week calendar loads; time highlighted

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure calendar tokens exist and create crew
cleanup_crews_for_user
clear_conversation_state

if ! has_calendar_tokens; then
  echo "AS-012: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, and get first proposal
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "next week evenings" > /dev/null
rate_limit_sleep

# Test: Suggest a different week (e.g., "Friday" which might be in a different week)
start_time=$(date +%s)
response=$(send_message "Friday")
rate_limit_sleep

# Validate: Should show adjusted proposal
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "Friday\|adjusted\|window"; then
  log_test_result "AS-012" "PASS" "Week navigation handled" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-012" "FAIL" "Week navigation not handled: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




