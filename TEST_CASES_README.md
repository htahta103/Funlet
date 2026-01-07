# Test Cases for Invitation and Sync-Up Response Logic

This document describes the test cases for verifying that invitees always respond to the latest invitation or sync-up, and can respond multiple times to the same item.

## Test Setup

- **Host Phone**: +19999999999 (used to create events and sync-ups)
- **Invitee Phone**: +18777804236 (is_host = false)
- **API Endpoint**: `https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-v2`

## Running the Tests

Execute the test script:

```bash
./test_invitation_syncup_responses.sh
```

Or run individual test cases by modifying the `main()` function in the script.

## Test Cases

### Test Case 1: Multiple Invitations - Latest One Used

**Scenario**: Invitee receives Invitation A, then Invitation B. Response should go to Invitation B.

**Steps**:
1. Host creates Event A (via host phone)
2. Host creates Event B (via host phone) 
3. Invitee responds with "1" - should respond to Event B

**Expected**: Response goes to the most recent invitation (Event B)

**Verification**: Response text should mention "Event B" or "Test Event B"

---

### Test Case 2: Invitation Then Sync-Up - Sync-Up Used

**Scenario**: Invitee receives Invitation A, then Sync-Up A. Response should go to Sync-Up A.

**Steps**:
1. Host creates Event A (via host phone)
2. Host creates Sync-Up A for same crew (via host phone)
3. Invitee responds with "1" or "1 2" - should respond to Sync-Up A

**Expected**: Response goes to Sync-Up A (more recent than invitation)

**Verification**: Action should be "SYNC_UP_RESPONSE" or response should mention sync-up details

---

### Test Case 3: Sync-Up Then Invitation - Invitation Used

**Scenario**: Invitee receives Sync-Up A, then Invitation B. Response should go to Invitation B.

**Steps**:
1. Host creates Sync-Up A (via host phone)
2. Host creates Event B (via host phone)
3. Invitee responds with "1" - should respond to Invitation B

**Expected**: Response goes to Invitation B (more recent than sync-up)

**Verification**: Response text should mention "Event B" or "Test Event B", or action should be "RSVP_RESPONSE"

---

### Test Case 4: Multiple Responses to Same Invitation

**Scenario**: Invitee responds "1" (in), then "2" (out) to the same invitation.

**Steps**:
1. Host creates Event A (via host phone)
2. Invitee responds with "1" - should say "in" and provide calendar link
3. Invitee responds with "2" - should say "out" for same event

**Expected**: Both responses update the same invitation, latest response wins

**Verification**: 
- First response should contain "in" or "Great! You're in"
- Second response should contain "out" or "you're out"

---

### Test Case 5: Multiple Responses to Same Sync-Up

**Scenario**: Invitee responds "1" then "2" to the same sync-up.

**Steps**:
1. Host creates Sync-Up A (via host phone)
2. Invitee responds with "1" - should record option 1
3. Invitee responds with "2" - should record option 2 (or update to include both)

**Expected**: Both responses update the same sync-up response record

**Verification**: Both responses should have action "SYNC_UP_RESPONSE"

---

### Test Case 6: Response to Latest After Multiple Items

**Scenario**: Invitee receives Invitation A, Sync-Up B, Invitation C. Response should go to Invitation C.

**Steps**:
1. Host creates Event A
2. Host creates Sync-Up B
3. Host creates Event C
4. Invitee responds with "1" - should respond to Event C

**Expected**: Response goes to most recent item (Event C)

**Verification**: Response text should mention "Event C" or "Test Event C"

## Manual Testing

You can also test manually using curl:

```bash
# Send a message as invitee
curl -X POST https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-v2 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs" \
  -H "Content-Type: application/json" \
  -d '{"message": "1", "phone_number": "+18777804236", "send_sms": false}' | jq '{action, response}'
```

## Notes

- The script includes 2-second delays between actions to allow the system to process each step
- All test cases verify that responses go to the latest invitation/sync-up based on `created_at` timestamp
- Multiple responses to the same item should be allowed and update the same record
- The script uses colored output for better readability (green=pass, red=fail, yellow=info, blue=action)

## Troubleshooting

If tests fail:
1. Check that the host phone (+19999999999) has a crew with the invitee (+18777804236) as a member
2. Verify that events and sync-ups are being created successfully
3. Check the function logs in Supabase Dashboard for detailed error messages
4. Ensure the invitee contact exists and `is_host = false`











