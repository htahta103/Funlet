#!/usr/bin/env python3
"""
Manual Curl Testing for AS-001 to AS-010
Tests Auto Sync functionality using curl commands with MCP setup
"""

import json
import subprocess
import time
import sys
from datetime import datetime
from pathlib import Path

# Configuration
PHONE_NUMBER = "+11231232323"
USER_ID = "84174326-705e-4416-a756-416838cf4f26"
FUNCTION_URL = "https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-beta"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs"

REPORT_DIR = Path("reports")
REPORT_DIR.mkdir(exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
REPORT_FILE = REPORT_DIR / f"manual_test_report_{TIMESTAMP}.txt"
JSON_FILE = REPORT_DIR / f"manual_test_report_{TIMESTAMP}.json"

# Test results storage
test_results = []

def send_curl(message):
    """Send curl request and return response"""
    cmd = [
        "curl", "-s", "-X", "POST", FUNCTION_URL,
        "-H", f"Authorization: Bearer {API_KEY}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({
            "message": message,
            "phone_number": PHONE_NUMBER,
            "is_host": True,
            "send_sms": False
        })
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        response = result.stdout.strip()
        time.sleep(1)  # Rate limiting
        return response
    except Exception as e:
        return json.dumps({"error": str(e)})

def log_test(test_id, test_name, expected, request, response, status, notes=""):
    """Log test result"""
    result = {
        "test_id": test_id,
        "test_name": test_name,
        "expected": expected,
        "request": request,
        "response": json.loads(response) if response else None,
        "status": status,
        "notes": notes,
        "timestamp": datetime.now().isoformat()
    }
    test_results.append(result)
    
    # Write to text report
    with open(REPORT_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n=== {test_id}: {test_name} ===\n")
        f.write(f"Expected: {expected}\n")
        f.write(f"Request: {request}\n")
        f.write(f"Response: {response}\n")
        f.write(f"Status: {status}\n")
        if notes:
            f.write(f"Notes: {notes}\n")
        f.write("-" * 40 + "\n")
    
    print(f"\n{test_id}: {status}")
    print(f"  Expected: {expected}")
    if response:
        try:
            resp_json = json.loads(response)
            print(f"  Got: {resp_json.get('response', 'N/A')[:100]}")
        except:
            print(f"  Got: {response[:100]}")

def check_response(response, expected_keywords):
    """Check if response contains expected keywords"""
    if not response:
        return False
    try:
        resp_json = json.loads(response)
        response_text = resp_json.get("response", "").lower()
        for keyword in expected_keywords:
            if keyword.lower() in response_text:
                return True
        return False
    except:
        return False

# Initialize report
with open(REPORT_FILE, "w", encoding="utf-8") as f:
    f.write(f"Auto Sync Manual Curl Test Report\n")
    f.write(f"Phone: {PHONE_NUMBER}\n")
    f.write(f"User ID: {USER_ID}\n")
    f.write(f"Generated: {datetime.now()}\n")
    f.write("=" * 40 + "\n")

print("Starting manual curl tests for AS-001 to AS-010")
print(f"Report will be saved to: {REPORT_FILE}")
print("=" * 60)

# Test cases will be executed here
# Each test will use MCP for setup (via separate calls)

if __name__ == "__main__":
    print("\nTest execution will be done step by step...")
    print("This script provides the framework for testing.")
    print("Individual tests will be executed with MCP setup.")




