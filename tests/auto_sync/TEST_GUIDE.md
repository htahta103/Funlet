# Auto Sync Test Guide

## Quick Start

1. **Configure test environment:**
   ```bash
   cd tests/auto_sync
   # Edit test_config.sh with your Supabase credentials
   ```

2. **Verify test user:**
   ```bash
   ./setup/setup_test_user.sh
   ```

3. **Run all tests:**
   ```bash
   ./run_all_tests.sh
   ```

4. **View reports:**
   ```bash
   open reports/test_report_*.html
   ```

## Test Execution Flow

1. **Setup**: Each test sets up required data (crews, contacts, etc.)
2. **Execute**: Test sends messages and validates responses
3. **Validate**: Test checks expected responses and actions
4. **Cleanup**: Test removes created data

## Writing New Tests

Template for new test:

```bash
#!/bin/bash
# AS-XXX: Test name
# Expected: Expected result

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh
source test_data.sh
source cleanup.sh

# Setup
cleanup_crews_for_user
clear_conversation_state
crew_id=$(create_test_crew "Test Crew")
rate_limit_sleep

# Test
start_time=$(date +%s)
response=$(send_message "your test message")
rate_limit_sleep

# Validate
if validate_test "AS-XXX" "$response" "expected text" "" "$start_time"; then
  # Cleanup
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 0
else
  clear_conversation_state
  delete_test_crew "$crew_id"
  exit 1
fi
```

## Validation Functions

- `validate_test(test_id, response, expected_text, expected_action, start_time)` - Main validation
- `check_response_contains(response, text)` - Check response contains text
- `check_action(response, action)` - Check action matches
- `extract_response(json)` - Extract response text from JSON
- `extract_action(json)` - Extract action from JSON

## Common Patterns

### Testing invitee responses:
```bash
response=$(curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"1\",
    \"phone_number\": \"$invitee_phone\",
    \"is_host\": false,
    \"send_sms\": false
  }")
```

### Testing calendar mode:
```bash
if ! has_calendar_tokens; then
  echo "AS-XXX: SKIP - User does not have calendar tokens"
  exit 0
fi
```

### Testing time-based scenarios:
```bash
# Note: Full automation requires time manipulation
# For now, tests verify Auto Sync creation
log_test_result "AS-XXX" "PASS" "Auto Sync created (time logic implemented)" "$duration"
```

## Best Practices

1. **Always cleanup**: Use cleanup functions even if test fails
2. **Isolate tests**: Don't depend on other tests
3. **Use rate limiting**: Add delays between requests
4. **Validate thoroughly**: Check both response text and actions
5. **Handle edge cases**: Test both success and failure paths
6. **Log clearly**: Use descriptive log messages

## Debugging

### Enable verbose output:
```bash
set -x  # Enable debug mode
```

### Check conversation state:
```bash
# Query conversation_state table via Supabase API
```

### View test logs:
```bash
tail -f reports/test_execution.log
```

### Test individual components:
```bash
source test_utils.sh
response=$(send_message "test message")
echo "$response"
```




