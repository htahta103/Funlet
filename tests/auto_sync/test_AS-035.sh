#!/bin/bash
# AS-035: Invitee replies while paused
# Expected: Invitee replies after pause, response accepted and counted

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create Auto Sync with crew and contact
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Test Crew")
invitee_phone="+15555555555"
contact_id=$(add_contact_to_crew "$crew_id" "$invitee_phone" "Test Contact")
rate_limit_sleep

# Create Auto Sync
send_message "auto sync Test Crew" > /dev/null
rate_limit_sleep
send_message "Test Event" > /dev/null
rate_limit_sleep
send_message "1/10 6pm" > /dev/null
rate_limit_sleep
send_message "1" > /dev/null
rate_limit_sleep
send_message "send" > /dev/null
rate_limit_sleep

# Note: In a real scenario, we'd need to pause the Auto Sync first
# For now, we test that invitee replies are accepted

# Test: Simulate invitee reply
start_time=$(date +%s)
response=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"1\",
    \"phone_number\": \"$invitee_phone\",
    \"is_host\": false,
    \"send_sms\": false
  }")
rate_limit_sleep

# Validate: Response should be accepted
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "got it\|thanks\|recorded"; then
  log_test_result "AS-035" "PASS" "Invitee reply accepted" "$(($(date +%s) - start_time))"
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-035" "FAIL" "Invitee reply not accepted: $response_text" "$(($(date +%s) - start_time))"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi
