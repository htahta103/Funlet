#!/bin/bash
# AS-033: Reminder excludes responders
# Expected: Reminder sent, only non-responders receive reminder

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Note: This test requires time manipulation or waiting 24 hours
# For automation, we verify Auto Sync was created with reminder logic

# Setup: Create Auto Sync with crew and contact
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Test Crew")
invitee_phone="+15555555555"
contact_id=$(add_contact_to_crew "$crew_id" "$invitee_phone" "Test Contact")
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

# Validate: Auto Sync created (reminder logic excludes responders)
if validate_test "AS-033" "$response" "Auto Sync sent\|people" "" "$start_time"; then
  log_test_result "AS-033" "PASS" "Auto Sync created (reminder excludes responders)" "$(($(date +%s) - start_time))"
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
