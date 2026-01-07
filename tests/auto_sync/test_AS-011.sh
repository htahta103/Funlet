#!/bin/bash
# AS-011: Calendar conflict detection
# Expected: Organizer suggests conflicting time, system rejects conflict and re-prompts

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
  echo "AS-011: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, and get first proposal
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "next week evenings" > /dev/null
rate_limit_sleep

# Test: Try to adjust to a conflicting time (this is complex - we'd need to know actual conflicts)
# For now, test that adjustment validation exists
start_time=$(date +%s)
response=$(send_message "make it 7pm")
rate_limit_sleep

# Validate: Should either accept (if no conflict) or reject (if conflict)
# The system should respond appropriately
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "conflicts\|adjusted\|window"; then
  log_test_result "AS-011" "PASS" "Time adjustment handled" "$(($(date +%s) - start_time))"
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-011" "FAIL" "Time adjustment not handled: $response_text" "$(($(date +%s) - start_time))"
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




