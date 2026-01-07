#!/bin/bash
# AS-013: Calendar closest-option fallback
# Expected: No fully open window exists, system proposes closest available time

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
  echo "AS-013: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Provide time window (system should find closest option if no fully open window)
start_time=$(date +%s)
response=$(send_message "next week evenings")
rate_limit_sleep

# Validate: Should show proposal (even if not fully open)
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "window that works\|closest option\|couldn't find.*fully open"; then
  log_test_result "AS-013" "PASS" "Closest option fallback working" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-013" "FAIL" "Closest option not shown: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




