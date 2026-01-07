#!/bin/bash
# Auto Sync Test Report Generator with detailed information

source "$(dirname "$0")/test_config.sh"

generate_report() {
  local report_file="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S)"
  local json_file="${report_file}.json"
  local html_file="${report_file}.html"
  local csv_file="${report_file}.csv"
  
  # Read test case names from CSV (using file-based approach for compatibility)
  local csv_file_path="../../test_auto_sync.csv"
  if [[ ! -f "$csv_file_path" ]]; then
    csv_file_path="../test_auto_sync.csv"
  fi
  if [[ ! -f "$csv_file_path" ]]; then
    csv_file_path="test_auto_sync.csv"
  fi
  
  # Parse test results from log file
  local total_tests=$(grep -c "AS-" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local passed=$(grep -c ": PASS" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local failed=$(grep -c ": FAIL" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local skipped=$(grep -c ": SKIP" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local executed=$((passed + failed))
  local pass_rate="0.00"
  
  if [[ "$executed" -gt 0 ]] && [[ "$executed" -ne 0 ]]; then
    # Calculate pass rate (bash arithmetic, then format)
    local rate=$((passed * 10000 / executed))
    pass_rate=$(printf "%.2f" $(echo "scale=2; $rate / 100" | bc 2>/dev/null || echo "scale=2; $passed * 100 / $executed" | bc 2>/dev/null || echo "0"))
  fi
  
  # Generate CSV report
  echo "Test ID,Test Name,Status,Duration,Message" > "$csv_file"
  
  # Generate JSON report
  cat > "$json_file" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "summary": {
    "total_tests": $total_tests,
    "executed": $executed,
    "passed": $passed,
    "failed": $failed,
    "skipped": $skipped,
    "pass_rate": $pass_rate
  },
  "tests": [
EOF
  
  # Generate HTML report
  cat > "$html_file" <<EOF
<!DOCTYPE html>
<html>
<head>
  <title>Auto Sync Test Report - $(date +%Y-%m-%d\ %H:%M:%S)</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
    .summary h2 { margin-top: 0; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 20px; }
    .stat-box { background: rgba(255,255,255,0.2); padding: 15px 20px; border-radius: 5px; min-width: 150px; }
    .stat-box strong { display: block; font-size: 24px; margin-bottom: 5px; }
    .pass { color: #4CAF50; }
    .fail { color: #f44336; }
    .skip { color: #ff9800; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #667eea; color: white; position: sticky; top: 0; }
    tr:hover { background-color: #f5f5f5; }
    .status-pass { color: #4CAF50; font-weight: bold; }
    .status-fail { color: #f44336; font-weight: bold; }
    .status-skip { color: #ff9800; font-weight: bold; }
    .test-name { font-weight: 500; color: #333; }
    .test-id { font-family: monospace; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Auto Sync Test Report</h1>
    <div class="summary">
      <h2>Summary</h2>
      <div class="stats">
        <div class="stat-box">
          <strong>$total_tests</strong>
          <span>Total Tests</span>
        </div>
        <div class="stat-box">
          <strong>$executed</strong>
          <span>Executed</span>
        </div>
        <div class="stat-box">
          <strong class="pass">$passed</strong>
          <span>Passed</span>
        </div>
        <div class="stat-box">
          <strong class="fail">$failed</strong>
          <span>Failed</span>
        </div>
        <div class="stat-box">
          <strong class="skip">$skipped</strong>
          <span>Skipped</span>
        </div>
        <div class="stat-box">
          <strong>${pass_rate}%</strong>
          <span>Pass Rate</span>
        </div>
      </div>
      <p style="margin-top: 20px; opacity: 0.9;"><strong>Generated:</strong> $(date)</p>
    </div>
    <h2>Test Results</h2>
    <table>
      <tr>
        <th>Test ID</th>
        <th>Test Name</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Message</th>
      </tr>
EOF
  
  # Process each test result
  local first=true
  while IFS= read -r line; do
    if [[ "$line" =~ AS-[0-9]+: ]]; then
      local test_id=$(echo "$line" | grep -o "AS-[0-9]\+" | head -1)
      local status=$(echo "$line" | grep -oE "PASS|FAIL|SKIP" | head -1)
      local message=$(echo "$line" | sed -E 's/.*AS-[0-9]+: (PASS|FAIL|SKIP)[^:]*:? (.*)/\2/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      local duration=$(echo "$line" | grep -oE "\([0-9]+s\)" | grep -oE "[0-9]+" || echo "0")
      # Get test name from CSV if available
      local test_name="N/A"
      if [[ -f "$csv_file_path" ]]; then
        test_name=$(awk -F'\t' -v id="$test_id" '$1==id {print $2; exit}' "$csv_file_path" 2>/dev/null || echo "N/A")
      fi
      
      # Add to CSV
      echo "$test_id,\"$test_name\",$status,${duration}s,\"$message\"" >> "$csv_file"
      
      # Add to JSON
      if [[ "$first" == false ]]; then
        echo "," >> "$json_file"
      fi
      first=false
      
      local status_lower=$(echo "$status" | tr '[:upper:]' '[:lower:]')
      cat >> "$json_file" <<EOF
    {
      "id": "$test_id",
      "name": "$test_name",
      "status": "$status_lower",
      "duration": $duration,
      "message": $(echo "$message" | python3 -c "import sys, json; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null || echo '""')
    }
EOF
      
      # Add to HTML
      local status_class="status-${status_lower}"
      cat >> "$html_file" <<EOF
      <tr>
        <td class="test-id">$test_id</td>
        <td class="test-name">$test_name</td>
        <td class="$status_class">$status</td>
        <td>${duration}s</td>
        <td>$message</td>
      </tr>
EOF
    fi
  done < "$TEST_LOG_FILE"
  
  cat >> "$json_file" <<EOF
  ]
}
EOF
  
  cat >> "$html_file" <<EOF
    </table>
  </div>
</body>
</html>
EOF
  
  echo ""
  echo "========================================"
  echo "Reports generated:"
  echo "  HTML: $html_file"
  echo "  JSON: $json_file"
  echo "  CSV:  $csv_file"
  echo "========================================"
}

