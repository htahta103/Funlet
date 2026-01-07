#!/bin/bash
# AS-003: Invalid crew name
# Expected: System responds crew not found

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create a different crew (not "FakeCrew")
cleanup_crews_for_user
clear_conversation_state
crew_id=$(create_test_crew "RealCrew")
rate_limit_sleep

# Test
start_time=$(date +%s)
response=$(send_message "auto sync FakeCrew")
rate_limit_sleep

# Validate
if validate_test "AS-003" "$response" "I couldn't find that crew" "" "$start_time"; then
  # Cleanup
  delete_test_crew "$crew_id"
  exit 0
else
  delete_test_crew "$crew_id"
  exit 1
fi




