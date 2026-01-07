#!/bin/bash
# AS-025: Initial invitee messages sent
# Expected: Auto Sync starts, invitees receive availability SMS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create crew with contact, set timezone
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Test Crew")
contact_id=$(add_contact_to_crew "$crew_id" "+15555555555" "Test Contact")
rate_limit_sleep

# Create Auto Sync
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep

# Test: Send confirmation
start_time=$(date +%s)
response=$(send_message "send")
rate_limit_sleep

# Validate: Should start Auto Sync (messages sent to invitees)
if validate_test "AS-025" "$response" "Auto Sync sent\|people" "" "$start_time"; then
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




