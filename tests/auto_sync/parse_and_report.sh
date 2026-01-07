#!/bin/bash
# Parse test results and create comprehensive report

source "$(dirname "$0")/test_config.sh"

OUTPUT_FILE="test_execution_output.log"
REPORT_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).txt"
CSV_FILE="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S).csv"

# Read CSV for test names
declare -A test_names
CSV_PATH="../../test_auto_sync.csv"
if [[ ! -f "$CSV_PATH" ]]; then
  CSV_PATH="../test_auto_sync.csv"
fi
if [[ -f "$CSV_PATH" ]]; then
  while IFS=$'\t' read -r id name rest; do
    if [[ "$id" =~ ^AS-[0-9]+$ ]]; then
      test_names["$id"]="$name"
    fi
  done < <(tail -n +2 "$CSV_PATH" 2>/dev/null)
fi

# Parse results
declare -A results
declare -A durations
declare -A messages

while IFS= read -r line; do
  if [[ "$line" =~ ^Running\ AS-([0-9]+) ]]; then
    test_id="AS-$(printf "%03d" ${BASH_REMATCH[1]})"
    results["$test_id"]="RUN"
  elif [[ "$line" =~ ✓\ AS-([0-9]+):\ PASS ]]; then
    test_id="AS-$(printf "%03d" ${BASH_REMATCH[1]})"
    results["$test_id"]="PASS"
    if [[ "$line" =~ \(([0-9]+)s\) ]]; then
      durations["$test_id"]="${BASH_REMATCH[1]}"
    fi
  elif [[ "$line" =~ ✗\ AS-([0-9]+):\ FAIL ]]; then
    test_id="AS-$(printf "%03d" ${BASH_REMATCH[1]})"
    results["$test_id"]="FAIL"
    if [[ "$line" =~ \(([0-9]+)s\) ]]; then
      durations["$test_id"]="${BASH_REMATCH[1]}"
    fi
  elif [[ "$line" =~ ⊘\ AS-([0-9]+):\ SKIP ]]; then
    test_id="AS-$(printf "%03d" ${BASH_REMATCH[1]})"
    results["$test_id"]="SKIP"
    messages["$test_id"]="Automation test (24h/48h)"
  fi
done < "$OUTPUT_FILE" 2>/dev/null

# Count results
total=55
passed=0
failed=0
skipped=0

for i in {1..55}; do
  test_id=$(printf "AS-%03d" $i)
  status="${results[$test_id]:-UNKNOWN}"
  case "$status" in
    PASS) ((passed++)) ;;
    FAIL) ((failed++)) ;;
    SKIP) ((skipped++)) ;;
  esac
done

executed=$((passed + failed))
pass_rate=$([ "$executed" -gt 0 ] && echo "$((passed * 100 / executed))%" || echo "N/A")

# Generate CSV
echo "Test ID,Test Name,Status,Duration,Message" > "$CSV_FILE"

# Generate text report
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
  Pass Rate: $pass_rate

========================================
Test Results (by Test ID):
========================================

EOF

for i in {1..55}; do
  test_id=$(printf "AS-%03d" $i)
  status="${results[$test_id]:-UNKNOWN}"
  duration="${durations[$test_id]:-0}"
  message="${messages[$test_id]:-}"
  test_name="${test_names[$test_id]:-N/A}"
  
  echo "$test_id,\"$test_name\",$status,${duration}s,\"$message\"" >> "$CSV_FILE"
  printf "%-8s %-40s %-6s %6s  %s\n" "$test_id" "$test_name" "$status" "${duration}s" "$message" >> "$REPORT_FILE"
done

echo ""
echo "Reports generated:"
echo "  Text: $REPORT_FILE"
echo "  CSV:  $CSV_FILE"
echo ""
cat "$REPORT_FILE"




