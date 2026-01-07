#!/bin/bash
# AS-002: Start Auto Sync with crew selection
# Expected: Crew selected, system prompts for event name

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create test crew
cleanup_crews_for_user
clear_conversation_state
crew_id=$(create_test_crew "Friends")
rate_limit_sleep

# Test
start_time=$(date +%s)
response=$(send_message "auto sync Friends")
rate_limit_sleep

# Validate
if validate_test "AS-002" "$response" "Event name" "" "$start_time"; then
  # Cleanup
  delete_test_crew "$crew_id"
  exit 0
else
  delete_test_crew "$crew_id"
  exit 1
fi




