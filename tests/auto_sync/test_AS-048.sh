#!/bin/bash
# AS-048: Auto Sync Check empty
# Expected: No active Auto Syncs, system reports none active

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Ensure no Auto Syncs exist
cleanup_crews_for_user
clear_conversation_state
cleanup_auto_syncs_for_user
rate_limit_sleep

# Test: Check Auto Sync
start_time=$(date +%s)
response=$(send_message "auto sync check")
rate_limit_sleep

# Validate: Should report no active Auto Syncs
if validate_test "AS-048" "$response" "no active\|none active\|No Auto Sync" "" "$start_time"; then
  exit 0
else
  exit 1
fi
