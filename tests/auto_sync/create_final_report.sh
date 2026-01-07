#!/bin/bash
# Create final test report from execution output

OUTPUT_FILE="test_execution_output.log"
REPORT_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).txt"
CSV_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).csv"

# Initialize counters
passed=0
failed=0
skipped=0

# Create CSV header
echo "Test ID,Test Name,Status,Duration,Message" > "$CSV_FILE"

# Create report header
cat > "$REPORT_FILE" <<EOF
Auto Sync Test Report
Generated: $(date)
========================================

EOF

# Process output file
if [[ -f "$OUTPUT_FILE" ]]; then
  # Extract test results
  while IFS= read -r line; do
    if [[ "$line" =~ ✓\ AS-([0-9]+):\ PASS ]]; then
      test_num="${BASH_REMATCH[1]}"
      test_id=$(printf "AS-%03d" "$test_num")
      duration=$(echo "$line" | grep -oE "\([0-9]+s\)" | grep -oE "[0-9]+" || echo "0")
      echo "$test_id,PASS,${duration}s," >> "$CSV_FILE"
      printf "%-8s %-6s %6s\n" "$test_id" "PASS" "${duration}s" >> "$REPORT_FILE"
      ((passed++))
    elif [[ "$line" =~ ✗\ AS-([0-9]+):\ FAIL ]]; then
      test_num="${BASH_REMATCH[1]}"
      test_id=$(printf "AS-%03d" "$test_num")
      duration=$(echo "$line" | grep -oE "\([0-9]+s\)" | grep -oE "[0-9]+" || echo "0")
      message=$(echo "$line" | sed 's/.*FAIL[^(]*//' | sed 's/([0-9]*s)//' | sed 's/^[[:space:]]*//')
      echo "$test_id,FAIL,${duration}s,\"$message\"" >> "$CSV_FILE"
      printf "%-8s %-6s %6s  %s\n" "$test_id" "FAIL" "${duration}s" "$message" >> "$REPORT_FILE"
      ((failed++))
    elif [[ "$line" =~ ⊘\ AS-([0-9]+):\ SKIP ]]; then
      test_num="${BASH_REMATCH[1]}"
      test_id=$(printf "AS-%03d" "$test_num")
      message=$(echo "$line" | sed 's/.*SKIP[^:]*: //')
      echo "$test_id,SKIP,0s,\"$message\"" >> "$CSV_FILE"
      printf "%-8s %-6s %6s  %s\n" "$test_id" "SKIP" "0s" "$message" >> "$REPORT_FILE"
      ((skipped++))
    fi
  done < "$OUTPUT_FILE"
fi

# Add summary
executed=$((passed + failed))
pass_rate=$([ "$executed" -gt 0 ] && echo "$((passed * 100 / executed))%" || echo "N/A")

cat >> "$REPORT_FILE" <<EOF

========================================
Summary:
  Total Tests: 55
  Executed: $executed
  Passed: $passed
  Failed: $failed
  Skipped: $skipped
  Pass Rate: $pass_rate
========================================
EOF

echo ""
echo "Reports generated:"
echo "  Text: $REPORT_FILE"
echo "  CSV:  $CSV_FILE"
echo ""
cat "$REPORT_FILE"




