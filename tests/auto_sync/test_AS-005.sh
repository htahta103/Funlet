#!/bin/bash
# AS-005: Exit during setup
# Expected: Auto Sync is discarded; normal chat resumes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create crew and start Auto Sync
cleanup_crews_for_user
clear_conversation_state
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Exit
start_time=$(date +%s)
response=$(send_message "exit")
rate_limit_sleep

# Validate
if validate_test "AS-005" "$response" "cancelled\|discarded" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




