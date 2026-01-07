#!/bin/bash

# Test Full Auto Sync Workflow
# Tests both calendar-connected and no-calendar hosts
# Step-by-step with response review

SUPABASE_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
AUTH_HEADER="apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVXMtaz-DSEKZaTrs"

echo "=========================================="
echo "TEST 1: Host with Calendar (+11231232323)"
echo "=========================================="
echo ""

# Step 1: Exit conversation
echo "Step 1: Exit conversation..."
echo "Expected: Should clear state"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "exit", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 2: Start Auto Sync
echo "Step 2: Start Auto Sync..."
echo "Expected: Should show crew selection"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "auto sync", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 3: Select crew
echo "Step 3: Select crew (1)..."
echo "Expected: Should prompt for event name"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 4: Provide event name
echo "Step 4: Provide event name..."
echo "Expected: Should prompt for time window (calendar mode)"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "Team Meeting", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 5: MISSING - Event location step (not currently implemented)
echo "Step 5: MISSING - Event location step"
echo "Note: Location field exists but no prompt in workflow"
echo ""
read -p "Press Enter to continue..."

# Step 6: Provide time window
echo "Step 6: Provide time window (next week evenings)..."
echo "Expected: Should show calendar proposal with week view"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "next week evenings", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 7: Accept proposal
echo "Step 7: Accept proposal (yes)..."
echo "Expected: Should save option and ask to add another or send"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 8: Add another option
echo "Step 8: Add another option (add another option)..."
echo "Expected: Should show next proposal"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "add another option", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 9: Accept second proposal
echo "Step 9: Accept second proposal (yes)..."
echo "Expected: Should save and show 'Send Auto Sync, add another option, or exit?'"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "yes", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 10: Send Auto Sync
echo "Step 10: Send Auto Sync (send)..."
echo "Expected: Should prompt for response goal"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "send", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 11: Set response goal
echo "Step 11: Set response goal (1 - Everyone)..."
echo "Expected: Should prompt 'Ready to start Auto Sync? Reply send or exit.'"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 12: Confirm send
echo "Step 12: Confirm send (send)..."
echo "Expected: Should show 'Auto Sync sent to X people.'"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "send", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 13: Check Auto Sync
echo "Step 13: Check Auto Sync (auto sync check)..."
echo "Expected: Should show Auto Sync with status"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "auto sync check", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 14: Select Auto Sync
echo "Step 14: Select Auto Sync (1)..."
echo "Expected: Should show 'Reply 1 to send invites, 2 to stop, or exit.'"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 15: Send invites
echo "Step 15: Send invites (1)..."
echo "Expected: Should show numbered list of options (NEW FEATURE)"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 16: Select option
echo "Step 16: Select option (1)..."
echo "Expected: Should show 'You're invited to [Event] on [Date] at [Time]. Calendar invite sent.'"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+11231232323", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 17: Verify in database
echo "Step 17: Verify in database..."
echo "Expected: Event created with correct time, Auto Sync marked as completed, Google Calendar event link saved"
echo "Note: Manual database verification required"
echo ""

echo "=========================================="
echo "TEST 2: Host without Calendar (+187778042361)"
echo "=========================================="
echo ""

# Step 1: Exit conversation
echo "Step 1: Exit conversation..."
echo "Expected: Should clear state"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "exit", "phone_number": "+187778042361", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 2: Start Auto Sync
echo "Step 2: Start Auto Sync..."
echo "Expected: Should show crew selection"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "auto sync", "phone_number": "+187778042361", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 3: Select crew
echo "Step 3: Select crew (1)..."
echo "Expected: Should prompt for event name"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+187778042361", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 4: Provide event name
echo "Step 4: Provide event name..."
echo "Expected: Should prompt for time options (no-calendar mode)"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "Test Event No Calendar", "phone_number": "+187778042361", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

# Step 5: MISSING - Event location step
echo "Step 5: MISSING - Event location step"
echo "Note: Location field exists but no prompt in workflow"
echo ""
read -p "Press Enter to continue..."

# Step 6: Provide time options
echo "Step 6: Provide time options..."
echo "Expected: Should parse and ask for more or send"
echo "Note: Time parsing may require specific format - test with actual format"
curl -s -X POST "$SUPABASE_URL" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"message": "Thu 1/15, 6-8pm, Sat 1/17, 2-4pm", "phone_number": "+187778042361", "is_host": true, "send_sms": false}' | python3 -m json.tool
echo ""
read -p "Press Enter to continue..."

echo "Test script completed. Review responses above."

