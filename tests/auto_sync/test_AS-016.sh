#!/bin/bash
# AS-016: Save two options
# Expected: Organizer saves second option, option saved; prompt shown

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

# Start Auto Sync, provide event name, provide first time option
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep

# Save first option
send_message "yes" > /dev/null
rate_limit_sleep

# Test: Save second option
start_time=$(date +%s)
response=$(send_message "1/11 7pm")
rate_limit_sleep

# Validate: Should accept second time and show prompt
if validate_test "AS-016" "$response" "What times work\|response goal" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




