#!/bin/bash
# AS-006: Calendar connected auto-detection
# Expected: Calendar is used automatically; no calendar prompt shown

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure user has calendar tokens and crew
cleanup_crews_for_user
clear_conversation_state

# Check if user has calendar tokens, if not skip test
if ! has_calendar_tokens; then
  echo "AS-006: SKIP - User does not have calendar tokens"
  exit 0
fi

crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync and provide event name
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep

# Test: Provide event name (should detect calendar)
start_time=$(date +%s)
response=$(send_message "Test Event")
rate_limit_sleep

# Validate: Should ask for time window (calendar mode), not manual times
if validate_test "AS-006" "$response" "time window\|next week\|weekend" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




