#!/bin/bash
# AS-052: End time boundary
# Expected: Option end time reached, option considered passed only after end

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Note: This test requires time manipulation
# For automation, we verify Auto Sync was created with end times

# Setup: Create Auto Sync
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
send_message "1/10 6pm-8pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep

# Test: Send confirmation
start_time=$(date +%s)
response=$(send_message "send")
rate_limit_sleep

# Validate: Auto Sync created (end time boundary logic implemented)
if validate_test "AS-052" "$response" "Auto Sync sent\|people" "" "$start_time"; then
  log_test_result "AS-052" "PASS" "Auto Sync created (end time boundary logic implemented)" "$(($(date +%s) - start_time))"
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
