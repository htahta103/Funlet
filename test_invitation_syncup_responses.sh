#!/bin/bash

# Test Cases for Invitation and Sync-Up Response Logic
# Tests that invitees always respond to the latest invitation or sync-up

# Configuration
HOST_PHONE="+19999999999"
INVITEE_PHONE="+18777804236"
API_URL="https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-v2"
AUTH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function to send SMS
send_sms() {
    local phone="$1"
    local message="$2"
    local description="$3"
    
    echo -e "${BLUE}→ Sending:${NC} $description"
    echo -e "  Phone: $phone"
    echo -e "  Message: \"$message\""
    
    local response=$(curl -s -X POST "$API_URL" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\", \"phone_number\": \"$phone\", \"send_sms\": false}")
    
    local action=$(echo "$response" | jq -r '.action // "N/A"')
    local response_text=$(echo "$response" | jq -r '.response // .message // "N/A"')
    
    echo -e "${GREEN}← Response:${NC} action=$action"
    if [ "$response_text" != "N/A" ] && [ "$response_text" != "null" ]; then
        echo -e "  Response text: ${response_text:0:100}..."
    fi
    echo ""
    
    echo "$response"
}

# Helper function to wait a bit between actions
wait_between() {
    echo -e "${YELLOW}⏳ Waiting 2 seconds...${NC}\n"
    sleep 2
}

# Test Case 1: Multiple Invitations - Latest One Used
test_case_1() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 1: Multiple Invitations - Latest One Used${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee receives Invitation A, then Invitation B."
    echo "Expected: Response should go to Invitation B (most recent)\n"
    
    # Step 1: Host creates Event A
    echo -e "${BLUE}Step 1:${NC} Host creates Event A"
    send_sms "$HOST_PHONE" "create event" "Create event (will prompt for details)"
    wait_between
    
    # Provide event details for Event A
    send_sms "$HOST_PHONE" "Test Event A" "Event A name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location A" "Event A location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/15/2025 6pm" "Event A date/time"
    wait_between
    
    # Send invitations for Event A
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event A"
    wait_between
    
    # Step 2: Host creates Event B
    echo -e "${BLUE}Step 2:${NC} Host creates Event B"
    send_sms "$HOST_PHONE" "create event" "Create event (will prompt for details)"
    wait_between
    
    # Provide event details for Event B
    send_sms "$HOST_PHONE" "Test Event B" "Event B name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location B" "Event B location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/16/2025 7pm" "Event B date/time"
    wait_between
    
    # Send invitations for Event B
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event B"
    wait_between
    
    # Step 3: Invitee responds with "1"
    echo -e "${BLUE}Step 3:${NC} Invitee responds with '1'"
    local result=$(send_sms "$INVITEE_PHONE" "1" "Invitee RSVP response")
    wait_between
    
    # Verify response
    local action=$(echo "$result" | jq -r '.action // "N/A"')
    local response_text=$(echo "$result" | jq -r '.response // .message // "N/A"')
    
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$response_text" == *"Event B"* ]] || [[ "$response_text" == *"Test Event B"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Response correctly goes to Event B"
    else
        echo -e "${RED}✗ FAIL${NC} - Response does not mention Event B"
        echo "  Response: $response_text"
    fi
    echo ""
}

# Test Case 2: Invitation Then Sync-Up - Sync-Up Used
test_case_2() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 2: Invitation Then Sync-Up - Sync-Up Used${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee receives Invitation A, then Sync-Up A."
    echo "Expected: Response should go to Sync-Up A (more recent)\n"
    
    # Step 1: Host creates Event A
    echo -e "${BLUE}Step 1:${NC} Host creates Event A"
    send_sms "$HOST_PHONE" "create event" "Create event"
    wait_between
    
    send_sms "$HOST_PHONE" "Test Event A" "Event A name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location A" "Event A location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/17/2025 6pm" "Event A date/time"
    wait_between
    
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event A"
    wait_between
    
    # Step 2: Host creates Sync-Up A
    echo -e "${BLUE}Step 2:${NC} Host creates Sync-Up A"
    send_sms "$HOST_PHONE" "sync up" "Create sync-up"
    wait_between
    
    # Provide sync-up details
    send_sms "$HOST_PHONE" "Dinner Sync" "Sync-up name"
    wait_between
    
    send_sms "$HOST_PHONE" "Restaurant" "Sync-up location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/18/2025 6pm, 12/18/2025 7pm, 12/19/2025 6pm" "Sync-up time options"
    wait_between
    
    # Step 3: Invitee responds with "1" or "1 2"
    echo -e "${BLUE}Step 3:${NC} Invitee responds with '1'"
    local result=$(send_sms "$INVITEE_PHONE" "1" "Invitee sync-up response")
    wait_between
    
    # Verify response
    local action=$(echo "$result" | jq -r '.action // "N/A"')
    local response_text=$(echo "$result" | jq -r '.response // .message // "N/A"')
    
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$action" == *"SYNC_UP"* ]] || [[ "$response_text" == *"sync"* ]] || [[ "$response_text" == *"Dinner"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Response correctly goes to Sync-Up A"
    else
        echo -e "${RED}✗ FAIL${NC} - Response does not go to sync-up"
        echo "  Action: $action"
        echo "  Response: $response_text"
    fi
    echo ""
}

# Test Case 3: Sync-Up Then Invitation - Invitation Used
test_case_3() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 3: Sync-Up Then Invitation - Invitation Used${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee receives Sync-Up A, then Invitation B."
    echo "Expected: Response should go to Invitation B (more recent)\n"
    
    # Step 1: Host creates Sync-Up A
    echo -e "${BLUE}Step 1:${NC} Host creates Sync-Up A"
    send_sms "$HOST_PHONE" "sync up" "Create sync-up"
    wait_between
    
    send_sms "$HOST_PHONE" "Lunch Sync" "Sync-up name"
    wait_between
    
    send_sms "$HOST_PHONE" "Cafe" "Sync-up location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/20/2025 12pm, 12/20/2025 1pm, 12/21/2025 12pm" "Sync-up time options"
    wait_between
    
    # Step 2: Host creates Event B
    echo -e "${BLUE}Step 2:${NC} Host creates Event B"
    send_sms "$HOST_PHONE" "create event" "Create event"
    wait_between
    
    send_sms "$HOST_PHONE" "Test Event B" "Event B name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location B" "Event B location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/22/2025 7pm" "Event B date/time"
    wait_between
    
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event B"
    wait_between
    
    # Step 3: Invitee responds with "1"
    echo -e "${BLUE}Step 3:${NC} Invitee responds with '1'"
    local result=$(send_sms "$INVITEE_PHONE" "1" "Invitee RSVP response")
    wait_between
    
    # Verify response
    local action=$(echo "$result" | jq -r '.action // "N/A"')
    local response_text=$(echo "$result" | jq -r '.response // .message // "N/A"')
    
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$response_text" == *"Event B"* ]] || [[ "$response_text" == *"Test Event B"* ]] || [[ "$action" == *"RSVP"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Response correctly goes to Invitation B"
    else
        echo -e "${RED}✗ FAIL${NC} - Response does not go to invitation"
        echo "  Action: $action"
        echo "  Response: $response_text"
    fi
    echo ""
}

# Test Case 4: Multiple Responses to Same Invitation
test_case_4() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 4: Multiple Responses to Same Invitation${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee responds '1' (in), then '2' (out) to same invitation."
    echo "Expected: Both responses update same invitation, latest wins\n"
    
    # Step 1: Host creates Event A
    echo -e "${BLUE}Step 1:${NC} Host creates Event A"
    send_sms "$HOST_PHONE" "create event" "Create event"
    wait_between
    
    send_sms "$HOST_PHONE" "Test Event Multi" "Event name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location Multi" "Event location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/23/2025 6pm" "Event date/time"
    wait_between
    
    send_sms "$HOST_PHONE" "send invites" "Send invitations"
    wait_between
    
    # Step 2: Invitee responds with "1" (in)
    echo -e "${BLUE}Step 2:${NC} Invitee responds with '1' (in)"
    local result1=$(send_sms "$INVITEE_PHONE" "1" "First RSVP: in")
    wait_between
    
    local response1=$(echo "$result1" | jq -r '.response // .message // "N/A"')
    echo -e "${YELLOW}First Response:${NC} $response1"
    echo ""
    
    # Step 3: Invitee responds with "2" (out)
    echo -e "${BLUE}Step 3:${NC} Invitee responds with '2' (out)"
    local result2=$(send_sms "$INVITEE_PHONE" "2" "Second RSVP: out")
    wait_between
    
    local response2=$(echo "$result2" | jq -r '.response // .message // "N/A"')
    echo -e "${YELLOW}Second Response:${NC} $response2"
    echo ""
    
    # Verify both responses work
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$response1" == *"in"* ]] && [[ "$response2" == *"out"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Both responses processed (1=in, 2=out)"
    else
        echo -e "${RED}✗ FAIL${NC} - Responses not processed correctly"
        echo "  Response 1: $response1"
        echo "  Response 2: $response2"
    fi
    echo ""
}

# Test Case 5: Multiple Responses to Same Sync-Up
test_case_5() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 5: Multiple Responses to Same Sync-Up${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee responds '1' then '2' to same sync-up."
    echo "Expected: Both responses update same sync-up response record\n"
    
    # Step 1: Host creates Sync-Up A
    echo -e "${BLUE}Step 1:${NC} Host creates Sync-Up A"
    send_sms "$HOST_PHONE" "sync up" "Create sync-up"
    wait_between
    
    send_sms "$HOST_PHONE" "Multi Sync" "Sync-up name"
    wait_between
    
    send_sms "$HOST_PHONE" "Office" "Sync-up location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/24/2025 2pm, 12/24/2025 3pm, 12/24/2025 4pm" "Sync-up time options"
    wait_between
    
    # Step 2: Invitee responds with "1"
    echo -e "${BLUE}Step 2:${NC} Invitee responds with '1'"
    local result1=$(send_sms "$INVITEE_PHONE" "1" "First sync-up response: option 1")
    wait_between
    
    local action1=$(echo "$result1" | jq -r '.action // "N/A"')
    local response1=$(echo "$result1" | jq -r '.response // .message // "N/A"')
    echo -e "${YELLOW}First Response:${NC} action=$action1"
    echo ""
    
    # Step 3: Invitee responds with "2"
    echo -e "${BLUE}Step 3:${NC} Invitee responds with '2'"
    local result2=$(send_sms "$INVITEE_PHONE" "2" "Second sync-up response: option 2")
    wait_between
    
    local action2=$(echo "$result2" | jq -r '.action // "N/A"')
    local response2=$(echo "$result2" | jq -r '.response // .message // "N/A"')
    echo -e "${YELLOW}Second Response:${NC} action=$action2"
    echo ""
    
    # Verify both responses work
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$action1" == *"SYNC_UP"* ]] && [[ "$action2" == *"SYNC_UP"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Both responses processed for sync-up"
    else
        echo -e "${RED}✗ FAIL${NC} - Responses not processed correctly"
        echo "  Action 1: $action1"
        echo "  Action 2: $action2"
    fi
    echo ""
}

# Test Case 6: Response to Latest After Multiple Items
test_case_6() {
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}TEST CASE 6: Response to Latest After Multiple Items${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Scenario: Invitee receives Invitation A, Sync-Up B, Invitation C."
    echo "Expected: Response should go to Invitation C (most recent)\n"
    
    # Step 1: Host creates Event A
    echo -e "${BLUE}Step 1:${NC} Host creates Event A"
    send_sms "$HOST_PHONE" "create event" "Create event"
    wait_between
    
    send_sms "$HOST_PHONE" "Test Event A" "Event A name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location A" "Event A location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/25/2025 6pm" "Event A date/time"
    wait_between
    
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event A"
    wait_between
    
    # Step 2: Host creates Sync-Up B
    echo -e "${BLUE}Step 2:${NC} Host creates Sync-Up B"
    send_sms "$HOST_PHONE" "sync up" "Create sync-up"
    wait_between
    
    send_sms "$HOST_PHONE" "Sync B" "Sync-up name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location B" "Sync-up location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/26/2025 2pm, 12/26/2025 3pm, 12/26/2025 4pm" "Sync-up time options"
    wait_between
    
    # Step 3: Host creates Event C
    echo -e "${BLUE}Step 3:${NC} Host creates Event C"
    send_sms "$HOST_PHONE" "create event" "Create event"
    wait_between
    
    send_sms "$HOST_PHONE" "Test Event C" "Event C name"
    wait_between
    
    send_sms "$HOST_PHONE" "Location C" "Event C location"
    wait_between
    
    send_sms "$HOST_PHONE" "12/27/2025 7pm" "Event C date/time"
    wait_between
    
    send_sms "$HOST_PHONE" "send invites" "Send invitations for Event C"
    wait_between
    
    # Step 4: Invitee responds with "1"
    echo -e "${BLUE}Step 4:${NC} Invitee responds with '1'"
    local result=$(send_sms "$INVITEE_PHONE" "1" "Invitee RSVP response")
    wait_between
    
    # Verify response
    local action=$(echo "$result" | jq -r '.action // "N/A"')
    local response_text=$(echo "$result" | jq -r '.response // .message // "N/A"')
    
    echo -e "${YELLOW}Verification:${NC}"
    if [[ "$response_text" == *"Event C"* ]] || [[ "$response_text" == *"Test Event C"* ]]; then
        echo -e "${GREEN}✓ PASS${NC} - Response correctly goes to Event C (most recent)"
    else
        echo -e "${RED}✗ FAIL${NC} - Response does not go to Event C"
        echo "  Action: $action"
        echo "  Response: $response_text"
    fi
    echo ""
}

# Main execution
main() {
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Invitation and Sync-Up Response Logic Test Suite${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}\n"
    echo "Host Phone: $HOST_PHONE"
    echo "Invitee Phone: $INVITEE_PHONE"
    echo ""
    
    # Run all test cases
    test_case_1
    test_case_2
    test_case_3
    test_case_4
    test_case_5
    test_case_6
    
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  All Test Cases Completed${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}\n"
}

# Run main function
main











