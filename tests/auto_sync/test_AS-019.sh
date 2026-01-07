#!/bin/bash
# AS-019: No-calendar multiple times
# Expected: Organizer enters 2–3 concrete times, all times accepted

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

# Start Auto Sync, provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Provide two concrete times
start_time=$(date +%s)
response=$(send_message "1/10 6pm, 1/11 7pm")
rate_limit_sleep

# Validate: Should accept both times and proceed
if validate_test "AS-019" "$response" "response goal\|What's the response goal" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




