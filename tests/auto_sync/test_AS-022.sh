#!/bin/bash
# AS-022: Time zone prompt (no calendar)
# Expected: No calendar + no TZ stored, system prompts for numbered TZ

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Remove calendar tokens, clear timezone, create crew
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
clear_user_timezone
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Start Auto Sync, provide event name, time options, response goal
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep

# Test: Send confirmation (should prompt for timezone)
start_time=$(date +%s)
response=$(send_message "send")
rate_limit_sleep

# Validate: Should prompt for timezone
if validate_test "AS-022" "$response" "timezone\|Timezone\|What timezone" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




