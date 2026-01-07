#!/bin/bash
# AS-001: Start Auto Sync with no crews
# Expected: System responds that no crews exist and exits

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure user has no crews
cleanup_crews_for_user
clear_conversation_state

# Test
start_time=$(date +%s)
response=$(send_message "auto sync")
rate_limit_sleep

# Validate
if validate_test "AS-001" "$response" "You don't have any crews yet" "" "$start_time"; then
  exit 0
else
  exit 1
fi




