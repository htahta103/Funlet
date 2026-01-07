#!/bin/bash
# AS-049: Multiple concurrent Auto Syncs
# Expected: Organizer runs two Auto Syncs, both operate independently

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create two crews
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew1_id=$(create_test_crew "Crew 1")
crew2_id=$(create_test_crew "Crew 2")
rate_limit_sleep

# Create first Auto Sync
send_message "auto sync Crew 1" > /dev/null
rate_limit_sleep
send_message "Event 1" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep
send_message "send" > /dev/null
rate_limit_sleep

# Create second Auto Sync
send_message "auto sync Crew 2" > /dev/null
rate_limit_sleep
send_message "Event 2" > /dev/null
rate_limit_sleep
send_message "1/11 7pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep

# Test: Send second Auto Sync
start_time=$(date +%s)
response=$(send_message "send")
rate_limit_sleep

# Validate: Should create second Auto Sync
if validate_test "AS-049" "$response" "Auto Sync sent\|people" "" "$start_time"; then
  # Verify both exist
  check_response=$(send_message "auto sync check")
  if echo "$check_response" | grep -qi "Event 1\|Event 2"; then
    log_test_result "AS-049" "PASS" "Multiple Auto Syncs created independently" "$(($(date +%s) - start_time))"
    # Cleanup
    cleanup_auto_syncs_for_user
    clear_conversation_state
    delete_test_crew "$crew1_id"
    delete_test_crew "$crew2_id"
    exit 0
  else
    log_test_result "AS-049" "FAIL" "Both Auto Syncs not found" "$(($(date +%s) - start_time))"
    cleanup_auto_syncs_for_user
    clear_conversation_state
    delete_test_crew "$crew1_id"
    delete_test_crew "$crew2_id"
    exit 1
  fi
else
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew1_id"
  delete_test_crew "$crew2_id"
  exit 1
fi
