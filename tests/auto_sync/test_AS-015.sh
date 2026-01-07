#!/bin/bash
# AS-015: Save one option
# Expected: Organizer saves first option, option saved; prompt to add/send/exit shown

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
  echo "AS-015: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, get proposal
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "next week evenings" > /dev/null
rate_limit_sleep

# Test: Save the option
start_time=$(date +%s)
response=$(send_message "yes")
rate_limit_sleep

# Validate: Should confirm save and ask to add/send/exit
if validate_test "AS-015" "$response" "Saved\|add another\|send\|exit" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




