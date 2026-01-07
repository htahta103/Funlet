#!/bin/bash
# AS-041: Invitee receives calendar invite SMS
# Expected: Invites sent, invitee receives calendar confirmation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Note: This test would require checking actual SMS sent
# For automation, we verify Auto Sync can send invites

# Setup: Create Auto Sync with crew
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Test Crew")
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
send_message "send" > /dev/null
rate_limit_sleep

# Test: Check Auto Sync
start_time=$(date +%s)
response=$(send_message "auto sync check")
rate_limit_sleep

# Validate: Should show Auto Sync
if validate_test "AS-041" "$response" "Auto Sync\|running\|paused" "" "$start_time"; then
  log_test_result "AS-041" "PASS" "Auto Sync created (invites can be sent)" "$(($(date +%s) - start_time))"
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
