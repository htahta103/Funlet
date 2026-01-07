#!/bin/bash
# Auto Sync Test Data Management

source "$(dirname "$0")/test_config.sh"

# Get user ID from phone number (cached in config)
get_user_id() {
  echo "$TEST_USER_ID"
}

# Create a test crew
create_test_crew() {
  local crew_name="${1:-Test Crew}"
  
  # Use Supabase API to create crew
  local response=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/crews" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{
      \"creator_id\": \"$TEST_USER_ID\",
      \"name\": \"$crew_name\",
      \"description\": \"Test crew for automated testing\"
    }")
  
  # Extract crew ID
  local crew_id=$(echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data[0]['id'] if isinstance(data, list) and len(data) > 0 else data.get('id', ''))" 2>/dev/null || echo "")
  
  echo "$crew_id"
}

# Delete a test crew
delete_test_crew() {
  local crew_id="$1"
  
  if [[ -z "$crew_id" ]]; then
    return 1
  fi
  
  curl -s -X DELETE "${SUPABASE_URL}/rest/v1/crews?id=eq.$crew_id" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" > /dev/null 2>&1
  
  return 0
}

# Get all crews for test user
get_user_crews() {
  curl -s -X GET "${SUPABASE_URL}/rest/v1/crews?creator_id=eq.$TEST_USER_ID&select=id,name" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json"
}

# Delete all crews for test user
cleanup_crews_for_user() {
  local crews=$(get_user_crews)
  local crew_ids=$(echo "$crews" | python3 -c "import sys, json; data = json.load(sys.stdin); print(' '.join([str(c['id']) for c in data]))" 2>/dev/null || echo "")
  
  for crew_id in $crew_ids; do
    delete_test_crew "$crew_id"
  done
}

# Check if user has calendar tokens
has_calendar_tokens() {
  local response=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/google_calendar_tokens?user_id=eq.$TEST_USER_ID&select=id" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json")
  
  local count=$(echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data))" 2>/dev/null || echo "0")
  
  if [[ "$count" -gt 0 ]]; then
    return 0
  else
    return 1
  fi
}

# Remove calendar tokens for test user
remove_calendar_tokens() {
  curl -s -X DELETE "${SUPABASE_URL}/rest/v1/google_calendar_tokens?user_id=eq.$TEST_USER_ID" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" > /dev/null 2>&1
}

# Set user timezone
set_user_timezone() {
  local timezone="$1"
  
  curl -s -X PATCH "${SUPABASE_URL}/rest/v1/profiles?id=eq.$TEST_USER_ID" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"preferred_timezone\": \"$timezone\"}" > /dev/null 2>&1
}

# Clear user timezone
clear_user_timezone() {
  set_user_timezone "null"
}

# Get all Auto Syncs for test user
get_user_auto_syncs() {
  curl -s -X GET "${SUPABASE_URL}/rest/v1/auto_syncs?organizer_id=eq.$TEST_USER_ID&select=id" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json"
}

# Delete all Auto Syncs for test user
cleanup_auto_syncs_for_user() {
  local auto_syncs=$(get_user_auto_syncs)
  local sync_ids=$(echo "$auto_syncs" | python3 -c "import sys, json; data = json.load(sys.stdin); print(' '.join([str(s['id']) for s in data]))" 2>/dev/null || echo "")
  
  for sync_id in $sync_ids; do
    curl -s -X DELETE "${SUPABASE_URL}/rest/v1/auto_syncs?id=eq.$sync_id" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" > /dev/null 2>&1
  done
}

# Add contact to crew
add_contact_to_crew() {
  local crew_id="$1"
  local contact_phone="${2:-+15555555555}"
  local contact_name="${3:-Test Contact}"
  
  # First, get or create contact
  local contact_response=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/contacts" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{
      \"organizer_id\": \"$TEST_USER_ID\",
      \"phone_number\": \"$contact_phone\",
      \"first_name\": \"$contact_name\"
    }")
  
  local contact_id=$(echo "$contact_response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data[0]['id'] if isinstance(data, list) and len(data) > 0 else data.get('id', ''))" 2>/dev/null || echo "")
  
  if [[ -z "$contact_id" ]]; then
    # Try to get existing contact
    local existing=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/contacts?organizer_id=eq.$TEST_USER_ID&phone_number=eq.$contact_phone&select=id&limit=1" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY")
    contact_id=$(echo "$existing" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data[0]['id'] if isinstance(data, list) and len(data) > 0 else '')" 2>/dev/null || echo "")
  fi
  
  if [[ -n "$contact_id" && -n "$crew_id" ]]; then
    # Add to crew
    curl -s -X POST "${SUPABASE_URL}/rest/v1/crew_members" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      -d "{
        \"crew_id\": \"$crew_id\",
        \"contact_id\": \"$contact_id\"
      }" > /dev/null 2>&1
  fi
  
  echo "$contact_id"
}




