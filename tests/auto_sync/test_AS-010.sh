#!/bin/bash
# AS-010: Calendar search produces option
# Expected: System proposes first option with calendar view

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
  echo "AS-010: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Provide natural language time window
start_time=$(date +%s)
response=$(send_message "next week evenings")
rate_limit_sleep

# Validate: Should show proposal with calendar view
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "window that works" && \
   echo "$response_text" | grep -qi "Week view\|Mon\|Tue\|Wed"; then
  log_test_result "AS-010" "PASS" "Calendar proposal shown with week view" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-010" "FAIL" "Calendar proposal not shown correctly: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




