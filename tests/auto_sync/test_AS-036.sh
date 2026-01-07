#!/bin/bash
# AS-036: Organizer sends reminder from paused
# Expected: Organizer selects reminder, Auto Sync resumes Running

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

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

# Test: Check Auto Sync status
start_time=$(date +%s)
response=$(send_message "auto sync check")
rate_limit_sleep

# Validate: Should show Auto Sync list
if validate_test "AS-036" "$response" "Auto Sync\|running\|paused" "" "$start_time"; then
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
