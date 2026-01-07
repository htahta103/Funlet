#!/bin/bash
# AS-055: Critical Mass selection
# Expected: Organizer selects Critical Mass, behavior identical to Everyone

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create crew
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, time options
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep

# Test: Select Critical Mass (response goal 2)
start_time=$(date +%s)
response=$(send_message "2")
rate_limit_sleep

# Validate: Should proceed to confirmation (same as Everyone)
if validate_test "AS-055" "$response" "Ready to start\|Reply send\|confirm" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi
