#!/bin/bash
# AS-023: Valid time zone selection
# Expected: Organizer selects valid number, TZ stored; Auto Sync starts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Remove calendar tokens, clear timezone, create crew with contact
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
clear_user_timezone
crew_id=$(create_test_crew "Test Crew")
add_contact_to_crew "$crew_id" "+15555555555" "Test Contact" > /dev/null
rate_limit_sleep

# Start Auto Sync, provide event name, time options, response goal, send
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep
send_message "send" > /dev/null
rate_limit_sleep

# Test: Provide timezone
start_time=$(date +%s)
response=$(send_message "America/Los_Angeles")
rate_limit_sleep

# Validate: Should start Auto Sync
if validate_test "AS-023" "$response" "Auto Sync sent\|people" "" "$start_time"; then
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




