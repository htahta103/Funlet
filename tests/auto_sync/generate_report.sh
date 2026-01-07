#!/bin/bash
# Auto Sync Test Report Generator

source "$(dirname "$0")/test_config.sh"

generate_report() {
  local report_file="${TEST_RESULTS_DIR}/test_report_$(date +%Y%m%d_%H%M%S)"
  local json_file="${report_file}.json"
  local html_file="${report_file}.html"
  
  # Parse test results from log file
  local total_tests=$(grep -c "AS-" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local passed=$(grep -c "PASS" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local failed=$(grep -c "FAIL" "$TEST_LOG_FILE" 2>/dev/null || echo "0")
  local pass_rate=0
  
  if [[ "$total_tests" -gt 0 ]]; then
    pass_rate=$(echo "scale=2; $passed * 100 / $total_tests" | bc)
  fi
  
  # Generate JSON report
  cat > "$json_file" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total_tests": $total_tests,
  "passed": $passed,
  "failed": $failed,
  "pass_rate": $pass_rate,
  "tests": [
EOF
  
  # Add individual test results
  local first=true
  while IFS= read -r line; do
    if [[ "$line" =~ AS-[0-9]+: ]]; then
      if [[ "$first" == false ]]; then
        echo "," >> "$json_file"
      fi
      first=false
      
      local test_id=$(echo "$line" | grep -o "AS-[0-9]\+" | head -1)
      local status=$(echo "$line" | grep -o "PASS\|FAIL")
      local message=$(echo "$line" | sed 's/.*- \(.*\)$/\1/')
      local duration=$(echo "$line" | grep -o "([0-9]\+s)" | grep -o "[0-9]\+" || echo "0")
      
      cat >> "$json_file" <<EOF
    {
      "id": "$test_id",
      "status": "$status",
      "duration": $duration,
      "message": $(echo "$message" | python3 -c "import sys, json; print(json.dumps(sys.stdin.read()))")
    }
EOF
    fi
  done < "$TEST_LOG_FILE"
  
  cat >> "$json_file" <<EOF
  ]
}
EOF
  
  # Generate HTML report
  cat > "$html_file" <<EOF
<!DOCTYPE html>
<html>
<head>
  <title>Auto Sync Test Report - $(date +%Y-%m-%d\ %H:%M:%S)</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .pass { color: green; }
    .fail { color: red; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #4CAF50; color: white; }
    .status-pass { color: green; font-weight: bold; }
    .status-fail { color: red; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Auto Sync Test Report</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p><strong>Total Tests:</strong> $total_tests</p>
    <p class="pass"><strong>Passed:</strong> $passed</p>
    <p class="fail"><strong>Failed:</strong> $failed</p>
    <p><strong>Pass Rate:</strong> ${pass_rate}%</p>
    <p><strong>Generated:</strong> $(date)</p>
  </div>
  <h2>Test Results</h2>
  <table>
    <tr>
      <th>Test ID</th>
      <th>Status</th>
      <th>Duration</th>
      <th>Message</th>
    </tr>
EOF
  
  while IFS= read -r line; do
    if [[ "$line" =~ AS-[0-9]+: ]]; then
      local test_id=$(echo "$line" | grep -o "AS-[0-9]\+" | head -1)
      local status=$(echo "$line" | grep -o "PASS\|FAIL")
      local message=$(echo "$line" | sed 's/.*- \(.*\)$/\1/')
      local duration=$(echo "$line" | grep -o "([0-9]\+s)" | grep -o "[0-9]\+" || echo "0")
      local status_class="status-$status"
      
      cat >> "$html_file" <<EOF
    <tr>
      <td>$test_id</td>
      <td class="$status_class">$status</td>
      <td>${duration}s</td>
      <td>$message</td>
    </tr>
EOF
    fi
  done < "$TEST_LOG_FILE"
  
  cat >> "$html_file" <<EOF
  </table>
</body>
</html>
EOF
  
  echo "Report generated: $html_file"
  echo "JSON report: $json_file"
}




