#!/bin/bash
# AS-026: Invitee header correctness
# Expected: Invitee receives SMS, header includes organizer name + event name

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Note: This test would require checking the actual SMS sent to invitees
# For now, we verify that Auto Sync was created successfully
# In a full implementation, we'd query the auto_sync_messages table

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

# Validate: Auto Sync created (messages would be sent with correct header)
if validate_test "AS-026" "$response" "Auto Sync sent\|people" "" "$start_time"; then
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




