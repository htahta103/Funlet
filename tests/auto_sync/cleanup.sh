#!/bin/bash
# Auto Sync Test Cleanup Functions

source "$(dirname "$0")/test_config.sh"
source "$(dirname "$0")/test_data.sh"

# Cleanup all Auto Syncs for test user
cleanup_all_auto_syncs() {
  echo "Cleaning up Auto Syncs..."
  cleanup_auto_syncs_for_user
}

# Cleanup conversation states
cleanup_conversation_states() {
  echo "Cleaning up conversation states..."
  clear_conversation_state
}

# Cleanup test crews
cleanup_test_crews() {
  echo "Cleaning up test crews..."
  cleanup_crews_for_user
}

# Reset user profile settings
reset_user_profile() {
  echo "Resetting user profile..."
  clear_user_timezone
}

# Cleanup calendar tokens
cleanup_calendar_tokens() {
  echo "Cleaning up calendar tokens..."
  remove_calendar_tokens
}

# Full cleanup
cleanup_all() {
  echo "Performing full cleanup..."
  cleanup_all_auto_syncs
  cleanup_conversation_states
  cleanup_test_crews
  reset_user_profile
  # Note: We don't cleanup calendar tokens by default as they may be needed for other tests
  echo "Cleanup complete."
}

# Cleanup specific Auto Sync by ID
cleanup_auto_sync() {
  local sync_id="$1"
  
  if [[ -z "$sync_id" ]]; then
    return 1
  fi
  
  curl -s -X DELETE "${SUPABASE_URL}/rest/v1/auto_syncs?id=eq.$sync_id" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" > /dev/null 2>&1
  
  return 0
}




