#!/bin/bash
# AS-009: Calendar mode time window input
# Expected: System evaluates calendar

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure calendar tokens exist and create crew
cleanup_crews_for_user
clear_conversation_state

if ! has_calendar_tokens; then
  echo "AS-009: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep

# Test: Provide natural language time window
start_time=$(date +%s)
response=$(send_message "next week evenings")
rate_limit_sleep

# Validate: Should show calendar proposal
if validate_test "AS-009" "$response" "window that works\|Week view" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




