# Auto Sync Automated Testing

This directory contains automated tests for the Auto Sync feature. All 55 test cases from `test_auto_sync.csv` are implemented as individual test scripts.

## Structure

```
tests/auto_sync/
├── test_config.sh          # Test configuration (API keys, phone numbers)
├── test_utils.sh           # Utility functions (send_message, validate, etc.)
├── test_data.sh            # Data management functions (crews, contacts, etc.)
├── cleanup.sh              # Cleanup functions
├── run_all_tests.sh        # Main test runner
├── generate_report.sh      # Report generator
├── setup/                  # Setup scripts
│   ├── setup_test_user.sh
│   ├── setup_test_crews.sh
│   ├── setup_calendar_tokens.sh
│   └── setup_test_contacts.sh
├── reports/                # Test reports (generated)
└── test_AS-*.sh            # Individual test scripts (AS-001 to AS-055)
```

## Prerequisites

- `bash` (version 4.0+)
- `curl` - For API calls
- `python3` - For JSON parsing
- `jq` (optional) - Alternative JSON parser
- `bc` (optional) - For calculations in report generation

## Configuration

Edit `test_config.sh` to configure:
- Supabase URL and API key
- Test phone number
- Test user ID
- Function endpoint URL

## Running Tests

### Run all tests:
```bash
cd tests/auto_sync
./run_all_tests.sh
```

### Run individual test:
```bash
./test_AS-001.sh
```

### Run specific test range:
```bash
for i in {1..10}; do
  test_id=$(printf "AS-%03d" $i)
  ./test_${test_id}.sh
done
```

## Test Categories

1. **Setup & Entry (AS-001 to AS-008)**: Initial setup, crew selection, calendar detection
2. **Calendar Mode (AS-009 to AS-015)**: Calendar integration, time proposals, conflicts
3. **No-Calendar Mode (AS-016 to AS-024)**: Manual time entry, timezone prompts
4. **Invitee Responses (AS-025 to AS-032)**: Response handling, reminders
5. **Reminder & Pause (AS-033 to AS-038)**: Reminder logic, pause states
6. **Send Invites (AS-039 to AS-042)**: Sending invites, calendar invites
7. **Stop Auto Sync (AS-043 to AS-045)**: Stopping Auto Sync
8. **Auto Sync Check (AS-046 to AS-048)**: Checking status, management
9. **Edge Cases (AS-049 to AS-055)**: Concurrent syncs, scoping, auto-end

## Reports

After running tests, reports are generated in `reports/`:
- `test_report_YYYYMMDD_HHMMSS.html` - HTML report
- `test_report_YYYYMMDD_HHMMSS.json` - JSON report
- `test_execution.log` - Execution log

## Cleanup

Tests automatically clean up after themselves, but you can manually clean up:

```bash
source cleanup.sh
cleanup_all
```

## Notes

- Tests use rate limiting (1 second delay between requests)
- Each test is isolated and cleans up after itself
- Some tests require calendar tokens (AS-006, AS-009-015, etc.)
- Time-based tests (AS-032-034, AS-051-052) may need time manipulation for full automation
- Invitee tests (AS-025-032, AS-042, AS-045, AS-050) simulate invitee responses using different phone numbers

## Troubleshooting

### Test fails with "User not found"
- Verify test user exists with phone number `+18777804236`
- Check `test_config.sh` has correct user ID

### Test fails with "Crew not found"
- Ensure test crew is created before running tests
- Check cleanup didn't remove required crews

### Calendar tests skip
- User must have valid Google Calendar tokens
- Use `setup/setup_calendar_tokens.sh` to check/add tokens

### Rate limiting errors
- Increase `RATE_LIMIT_DELAY` in `test_config.sh`
- Add longer delays between test runs




