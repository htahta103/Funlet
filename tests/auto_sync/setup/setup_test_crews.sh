#!/bin/bash
# Setup test crews - create test crews for testing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

source test_config.sh
source test_data.sh

echo "Setting up test crews..."

# Create a default test crew
crew_id=$(create_test_crew "Test Crew")
if [[ -n "$crew_id" ]]; then
  echo "✓ Created test crew: $crew_id"
  export TEST_CREW_ID="$crew_id"
  exit 0
else
  echo "✗ Failed to create test crew"
  exit 1
fi




