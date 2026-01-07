#!/bin/bash
# Auto Sync Test Runner - Execute all 55 test cases

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh

# Initialize log file
echo "Auto Sync Test Execution - $(date)" > "$TEST_LOG_FILE"
echo "========================================" >> "$TEST_LOG_FILE"

# Test results tracking
declare -a TEST_RESULTS
TOTAL_TESTS=55
PASSED=0
FAILED=0

echo "Starting Auto Sync automated tests..."
echo "Test phone: $TEST_PHONE_NUMBER"
echo "Test user: $TEST_USER_ID"
echo ""

# Run each test case
for i in {1..55}; do
  test_id=$(printf "AS-%03d" $i)
  test_file="test_${test_id}.sh"
  
  if [[ ! -f "$test_file" ]]; then
    echo -e "${YELLOW}⚠${NC} $test_id: SKIP - Test file not found"
    continue
  fi
  
  echo "Running $test_id..."
  start_time=$(date +%s)
  
  # Run test with timeout
  if timeout "$TEST_TIMEOUT" bash "$test_file" >> "$TEST_LOG_FILE" 2>&1; then
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    TEST_RESULTS+=("$test_id: PASS ($duration)s")
    ((PASSED++))
    echo -e "${GREEN}✓${NC} $test_id: PASS (${duration}s)"
  else
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    TEST_RESULTS+=("$test_id: FAIL ($duration)s")
    ((FAILED++))
    echo -e "${RED}✗${NC} $test_id: FAIL (${duration}s)"
  fi
  
  # Rate limiting
  if [[ $i -lt 55 ]]; then
    rate_limit_sleep
  fi
done

echo ""
echo "========================================"
echo "Test Execution Complete"
echo "Total: $TOTAL_TESTS | Passed: $PASSED | Failed: $FAILED"
echo ""

# Generate report
if [[ -f "generate_report.sh" ]]; then
  source generate_report.sh
  generate_report
fi

# Exit with error if any tests failed
if [[ $FAILED -gt 0 ]]; then
  exit 1
else
  exit 0
fi




