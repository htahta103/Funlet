#!/bin/bash
# Run Auto Sync tests, skipping automation tests (24h/48h)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source test_config.sh
source test_utils.sh

# Initialize log file
echo "Auto Sync Test Execution - $(date)" > "$TEST_LOG_FILE"
echo "========================================" >> "$TEST_LOG_FILE"
echo "Skipping automation tests: AS-032, AS-033, AS-034, AS-037, AS-051, AS-052" >> "$TEST_LOG_FILE"
echo "" >> "$TEST_LOG_FILE"

# Tests to skip (24h/48h automation tests)
SKIP_TESTS=("AS-032" "AS-033" "AS-034" "AS-037" "AS-051" "AS-052")

# Test results tracking
declare -a TEST_RESULTS
TOTAL_TESTS=55
SKIPPED=0
PASSED=0
FAILED=0

echo "Starting Auto Sync automated tests..."
echo "Test phone: $TEST_PHONE_NUMBER"
echo "Test user: $TEST_USER_ID"
echo "Skipping automation tests: ${SKIP_TESTS[*]}"
echo ""

# Function to check if test should be skipped
should_skip() {
  local test_id="$1"
  for skip in "${SKIP_TESTS[@]}"; do
    if [[ "$test_id" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

# Run each test case
for i in {1..55}; do
  test_id=$(printf "AS-%03d" $i)
  test_file="test_${test_id}.sh"
  
  # Check if should skip
  if should_skip "$test_id"; then
    echo -e "${YELLOW}⊘${NC} $test_id: SKIP - Automation test (24h/48h)"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $test_id: SKIP - Automation test (24h/48h)" >> "$TEST_LOG_FILE"
    TEST_RESULTS+=("$test_id: SKIP (automation)")
    ((SKIPPED++))
    continue
  fi
  
  if [[ ! -f "$test_file" ]]; then
    echo -e "${YELLOW}⚠${NC} $test_id: SKIP - Test file not found"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $test_id: SKIP - Test file not found" >> "$TEST_LOG_FILE"
    TEST_RESULTS+=("$test_id: SKIP (file missing)")
    ((SKIPPED++))
    continue
  fi
  
  echo "Running $test_id..."
  start_time=$(date +%s)
  
  # Clear conversation state before each test
  mcp_supabase_execute_sql --project_id jjkduivjlzazcvdeeqde --query "UPDATE conversation_state SET current_state = 'normal', waiting_for = NULL, extracted_data = '[]'::jsonb WHERE user_id = '5736b75d-ca02-48c3-9ccf-3c457cc831ed';" > /dev/null 2>&1 || true
  
  # Run test (timeout optional, skip if not available)
  if command -v timeout >/dev/null 2>&1; then
    test_cmd="timeout $TEST_TIMEOUT bash $test_file"
  else
    test_cmd="bash $test_file"
  fi
  
  if $test_cmd >> "$TEST_LOG_FILE" 2>&1; then
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
echo "Total: $TOTAL_TESTS | Passed: $PASSED | Failed: $FAILED | Skipped: $SKIPPED"
echo ""

# Generate report
if [[ -f "generate_detailed_report.sh" ]]; then
  source generate_detailed_report.sh
  generate_report
elif [[ -f "generate_report.sh" ]]; then
  source generate_report.sh
  generate_report
fi

# Exit with error if any tests failed
if [[ $FAILED -gt 0 ]]; then
  exit 1
else
  exit 0
fi

