#!/bin/bash
# Setup calendar tokens - add/remove calendar tokens for testing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

source test_config.sh
source test_data.sh

ACTION="${1:-check}"

if [[ "$ACTION" == "add" ]]; then
  echo "Adding calendar tokens..."
  echo "Note: This requires valid OAuth tokens from Google Calendar"
  echo "Use the store-google-calendar-tokens Edge Function to add tokens"
  exit 0
elif [[ "$ACTION" == "remove" ]]; then
  echo "Removing calendar tokens..."
  remove_calendar_tokens
  echo "✓ Calendar tokens removed"
  exit 0
else
  echo "Checking calendar tokens..."
  if has_calendar_tokens; then
    echo "✓ Calendar tokens exist"
    exit 0
  else
    echo "✗ No calendar tokens found"
    exit 1
  fi
fi




