#!/bin/bash
# Simple test report generator

source "$(dirname "$0")/test_config.sh"

LOG_FILE="$TEST_LOG_FILE"
REPORT_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).txt"
CSV_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).csv"

# Count results
total=$(grep -c "AS-" "$LOG_FILE" 2>/dev/null || echo "0")
passed=$(grep -c ": PASS" "$LOG_FILE" 2>/dev/null || echo "0")
failed=$(grep -c ": FAIL" "$LOG_FILE" 2>/dev/null || echo "0")
skipped=$(grep -c ": SKIP" "$LOG_FILE" 2>/dev/null || echo "0")
executed=$((passed + failed))

# Create CSV header
echo "Test ID,Status,Duration,Message" > "$CSV_FILE"

# Create text report
cat > "$REPORT_FILE" <<EOF
Auto Sync Test Report
Generated: $(date)
========================================

Summary:
  Total Tests: $total
  Executed: $executed
  Passed: $passed
  Failed: $failed
  Skipped: $skipped
  Pass Rate: $([ "$executed" -gt 0 ] && echo "$((passed * 100 / executed))%" || echo "N/A")

========================================
Test Results:
========================================

EOF

# Process each test
grep -E "AS-[0-9]+: (PASS|FAIL|SKIP)" "$LOG_FILE" | while IFS= read -r line; do
  test_id=$(echo "$line" | grep -o "AS-[0-9]\+" | head -1)
  status=$(echo "$line" | grep -oE "PASS|FAIL|SKIP" | head -1)
  duration=$(echo "$line" | grep -oE "\([0-9]+s\)" | grep -oE "[0-9]+" || echo "0")
  message=$(echo "$line" | sed -E 's/.*AS-[0-9]+: (PASS|FAIL|SKIP)[^:]*:? (.*)/\2/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  
  echo "$test_id,$status,${duration}s,\"$message\"" >> "$CSV_FILE"
  printf "%-8s %-6s %6s  %s\n" "$test_id" "$status" "${duration}s" "$message" >> "$REPORT_FILE"
done

echo ""
echo "Reports generated:"
echo "  Text: $REPORT_FILE"
echo "  CSV:  $CSV_FILE"
cat "$REPORT_FILE"




