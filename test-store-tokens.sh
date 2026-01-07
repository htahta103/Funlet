#!/bin/bash
# Test script for store-google-calendar-tokens function
# Replace YOUR_SERVICE_ROLE_KEY with your actual Supabase service role key

SERVICE_ROLE_KEY="${1:-YOUR_SERVICE_ROLE_KEY_HERE}"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

curl -X POST "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/store-google-calendar-tokens" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"service_role_key\": \"${SERVICE_ROLE_KEY}\",
    \"user_id\": \"84174326-705e-4416-a756-416838cf4f26\",
    \"provider_token\": \"ya29.test_token_12345\",
    \"provider_refresh_token\": \"test_refresh_token\",
    \"expires_at\": $(date +%s),
    \"expires_in\": 3600,
    \"scope\": \"https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events\"
  }" | python3 -m json.tool
