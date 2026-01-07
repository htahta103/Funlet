#!/bin/bash
# AS-030: Invitee invalid reply
# Expected: Invitee replies invalid text, corrective instruction sent

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

# Test: Simulate invitee invalid reply
start_time=$(date +%s)
response=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"invalid text\",
    \"phone_number\": \"$invitee_phone\",
    \"is_host\": false,
    \"send_sms\": false
  }")
rate_limit_sleep

# Validate: Should send corrective instruction
response_text=$(extract_response "$response")
if echo "$response_text" | grep -qi "reply with\|1\|2\|3\|none\|invalid"; then
  log_test_result "AS-030" "PASS" "Corrective instruction sent" "$(($(date +%s) - start_time))"
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  log_test_result "AS-030" "FAIL" "Corrective instruction not sent: $response_text" "$(($(date +%s) - start_time))"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi




