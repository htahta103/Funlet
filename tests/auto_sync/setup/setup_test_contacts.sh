#!/bin/bash
# Setup test contacts - create test contacts and add to crews

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

source test_config.sh
source test_data.sh

CREW_ID="${1:-}"
CONTACT_PHONE="${2:-+15555555555}"
CONTACT_NAME="${3:-Test Contact}"

if [[ -z "$CREW_ID" ]]; then
  echo "Usage: $0 <crew_id> [phone] [name]"
  exit 1
fi

echo "Adding contact to crew..."
contact_id=$(add_contact_to_crew "$CREW_ID" "$CONTACT_PHONE" "$CONTACT_NAME")

if [[ -n "$contact_id" ]]; then
  echo "✓ Added contact: $contact_id"
  exit 0
else
  echo "✗ Failed to add contact"
  exit 1
fi




