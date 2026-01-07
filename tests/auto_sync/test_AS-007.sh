#!/bin/bash
# AS-007: Calendar not connected
# Expected: Auto Sync proceeds in no-calendar mode

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

# Test: Provide event name (should use no-calendar mode)
start_time=$(date +%s)
response=$(send_message "Test Event")
rate_limit_sleep

# Validate: Should ask for manual time entry, not time window
if validate_test "AS-007" "$response" "What times work\|1-3 options" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




