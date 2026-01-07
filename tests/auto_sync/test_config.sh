#!/bin/bash
# Auto Sync Test Configuration

# Supabase Configuration
export SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"
export FUNCTION_URL="${SUPABASE_URL}/functions/v1/funlet-sms-handler-beta"

# Test User Configuration
export TEST_PHONE_NUMBER="+18777804236"
export TEST_USER_ID="5736b75d-ca02-48c3-9ccf-3c457cc831ed"

# Test Crew Configuration (will be set dynamically)
export TEST_CREW_ID=""
export TEST_CREW_NAME="Test Crew"

# Test Results
export TEST_RESULTS_DIR="$(dirname "$0")/reports"
export TEST_LOG_FILE="${TEST_RESULTS_DIR}/test_execution.log"

# Create reports directory if it doesn't exist
mkdir -p "$TEST_RESULTS_DIR"

# Test timeout (seconds)
export TEST_TIMEOUT=30

# Rate limiting delay (seconds)
export RATE_LIMIT_DELAY=1




