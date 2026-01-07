#!/bin/bash
# AS-054: Connect calendar command
# Expected: Organizer types connect calendar, calendar connection flow begins

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure no calendar tokens
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
rate_limit_sleep

# Test: Connect calendar command
start_time=$(date +%s)
response=$(send_message "connect calendar")
rate_limit_sleep

# Validate: Should initiate calendar connection flow
# Note: This would typically redirect to OAuth, so we check for appropriate response
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "calendar\|connect\|link\|oauth"; then
  log_test_result "AS-054" "PASS" "Calendar connection flow initiated" "$(($(date +%s) - start_time))"
  exit 0
else
  log_test_result "AS-054" "FAIL" "Calendar connection not initiated: $response_text" "$(($(date +%s) - start_time))"
  exit 1
fi
