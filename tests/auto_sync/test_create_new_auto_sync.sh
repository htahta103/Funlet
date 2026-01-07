#!/bin/bash
# Test: Exit first, then create new Auto Sync
# Expected: Exit clears state, then new Auto Sync is created successfully

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup: Create test crew
echo "Setting up test environment..."
cleanup_crews_for_user
clear_conversation_state
remove_calendar_tokens
set_user_timezone "America/Los_Angeles"
crew_id=$(create_test_crew "Friends")
rate_limit_sleep

# Debug: Verify crew was created
if [[ -z "$crew_id" ]]; then
  echo "❌ ERROR: Failed to create test crew"
  exit 1
fi
echo "✓ Created crew with ID: $crew_id"

# Debug: List all crews for user
echo "Verifying crews for user..."
crews=$(get_user_crews)
echo "Crews: $crews"
crew_names=$(echo "$crews" | python3 -c "import sys, json; data = json.load(sys.stdin); print(', '.join([c.get('name', '') for c in data]))" 2>/dev/null || echo "")
echo "Crew names: $crew_names"
rate_limit_sleep

# Step 1: Exit any current auto sync setup
echo ""
echo "Step 1: Exiting any current auto sync setup..."
start_time=$(date +%s)
exit_response=$(send_message "exit")
rate_limit_sleep

exit_response_text=$(extract_response "$exit_response")
echo "Exit response: $exit_response_text"

# Step 2: Create new Auto Sync
echo ""
echo "Step 2: Creating new Auto Sync..."
echo "  - Sending: auto sync Friends"
response1=$(send_message "auto sync Friends")
rate_limit_sleep
response1_text=$(extract_response "$response1")
echo "  - Response: $response1_text"

if ! echo "$response1_text" | grep -qi "event name"; then
  echo "❌ FAIL: Expected 'Event name' prompt after crew selection"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi

echo "  - Sending: Test Event"
response2=$(send_message "Test Event")
rate_limit_sleep
response2_text=$(extract_response "$response2")
echo "  - Response: $response2_text"

if ! echo "$response2_text" | grep -qiE "time|when|date"; then
  echo "❌ FAIL: Expected time/date prompt after event name"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi

echo "  - Sending: 1/10 6pm"
response3=$(send_message "1/10 6pm")
rate_limit_sleep
response3_text=$(extract_response "$response3")
echo "  - Response: $response3_text"

if ! echo "$response3_text" | grep -qiE "goal|everyone|critical|1|2"; then
  echo "❌ FAIL: Expected goal selection prompt after time"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi

echo "  - Sending: 1 (Everyone)"
response4=$(send_message "1")
rate_limit_sleep
response4_text=$(extract_response "$response4")
echo "  - Response: $response4_text"

if ! echo "$response4_text" | grep -qiE "send|ready|start"; then
  echo "❌ FAIL: Expected send confirmation prompt after goal selection"
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi

echo "  - Sending: send"
response5=$(send_message "send")
rate_limit_sleep
response5_text=$(extract_response "$response5")
echo "  - Response: $response5_text"

# Validate: Should have created Auto Sync
if echo "$response5_text" | grep -qiE "sent|people|auto sync"; then
  echo ""
  echo "✅ SUCCESS: Auto Sync created successfully!"
  echo "   Final response: $response5_text"
  
  # Verify Auto Sync exists in database
  auto_syncs=$(get_user_auto_syncs)
  sync_count=$(echo "$auto_syncs" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data))" 2>/dev/null || echo "0")
  
  if [[ "$sync_count" -gt 0 ]]; then
    echo "✅ Verified: Auto Sync exists in database (count: $sync_count)"
  else
    echo "⚠️  Warning: Auto Sync may not be in database yet"
  fi
  
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  echo ""
  echo "❌ FAIL: Auto Sync creation may have failed"
  echo "   Final response: $response5_text"
  
  # Cleanup
  cleanup_auto_syncs_for_user
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi

