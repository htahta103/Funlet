#!/bin/bash
# AS-014: Calendar access failure
# Expected: Calendar becomes unavailable mid-search, system shows error and discards Auto Sync

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create crew and temporarily remove calendar tokens to simulate failure
cleanup_crews_for_user
clear_conversation_state
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep

# Remove calendar tokens to simulate access failure
remove_calendar_tokens
rate_limit_sleep

# Test: Try to provide time window (should fail)
start_time=$(date +%s)
response=$(send_message "next week evenings")
rate_limit_sleep

# Validate: Should show error about calendar access
if validate_test "AS-014" "$response" "trouble accessing.*calendar\|calendar.*unavailable" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




