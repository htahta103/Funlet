#!/bin/bash
# AS-020: Send confirmation prompt
# Expected: Organizer finishes configuration, system asks to confirm send

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

# Start Auto Sync, provide event name, time options, response goal
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep

# Test: Should prompt for confirmation
start_time=$(date +%s)
response=$(send_message "dummy")  # Any message to see current state
rate_limit_sleep

# Actually, we should check the response from the previous step
# Let's get the response from response goal step
response=$(send_message "1")
rate_limit_sleep

# Validate: Should ask to confirm send
if validate_test "AS-020" "$response" "Ready to start\|Reply send\|confirm" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




