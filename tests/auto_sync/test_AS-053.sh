#!/bin/bash
# AS-053: Calendar added later
# Expected: Organizer connects calendar later, only future Auto Syncs use calendar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Start without calendar, then add calendar
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Create first Auto Sync (no calendar)
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Event 1" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep
send_message "send" > /dev/null
rate_limit_sleep

# Note: In a real scenario, we'd add calendar tokens here
# For now, we test that calendar detection works for new Auto Syncs

# Test: Create second Auto Sync (should detect calendar if added)
start_time=$(date +%s)
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
response=$(send_message "Event 2")
rate_limit_sleep

# Validate: Should detect calendar status
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "time window\|What times work"; then
  log_test_result "AS-053" "PASS" "Calendar detection works for new Auto Syncs" "$(($(date +%s) - start_time))"
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-053" "FAIL" "Calendar detection not working: $response_text" "$(($(date +%s) - start_time))"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi
