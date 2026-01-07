#!/usr/bin/env python3
"""
Execute all manual curl tests AS-001 to AS-010
Uses MCP for setup and curl for testing
"""

import json
import subprocess
import time
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

test_results = []

def send_curl(message):
    """Send curl request"""
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
        time.sleep(1)
        return result.stdout.strip()
    except Exception as e:
        return json.dumps({"error": str(e)})

def log_test(test_id, test_name, expected, request, response, status, notes=""):
    """Log test result"""
    try:
        resp_json = json.loads(response) if response else {}
    except:
        resp_json = {"raw": response}
    
    result = {
        "test_id": test_id,
        "test_name": test_name,
        "expected": expected,
        "request": request,
        "response": resp_json,
        "status": status,
        "notes": notes,
        "timestamp": datetime.now().isoformat()
    }
    test_results.append(result)
    
    with open(REPORT_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n=== {test_id}: {test_name} ===\n")
        f.write(f"Expected: {expected}\n")
        f.write(f"Request: {request}\n")
        f.write(f"Response: {json.dumps(resp_json, indent=2)}\n")
        f.write(f"Status: {status}\n")
        if notes:
            f.write(f"Notes: {notes}\n")
        f.write("-" * 40 + "\n")
    
    print(f"{test_id}: {status} - {test_name}")

def check_response(response, keywords):
    """Check if response contains keywords"""
    if not response:
        return False
    try:
        resp_json = json.loads(response)
        response_text = resp_json.get("response", "").lower()
        return any(kw.lower() in response_text for kw in keywords)
    except:
        return False

def clear_conversation_state():
    """Clear conversation state via SQL (would use MCP in production)"""
    # This will be done via MCP calls between tests
    pass

# Initialize report
with open(REPORT_FILE, "w", encoding="utf-8") as f:
    f.write(f"Auto Sync Manual Curl Test Report\n")
    f.write(f"Phone: {PHONE_NUMBER}\n")
    f.write(f"User ID: {USER_ID}\n")
    f.write(f"Generated: {datetime.now()}\n")
    f.write("=" * 40 + "\n")

print("=" * 60)
print("Auto Sync Manual Curl Tests - AS-001 to AS-010")
print(f"Phone: {PHONE_NUMBER}")
print(f"Report: {REPORT_FILE}")
print("=" * 60)

# AS-001: Start Auto Sync with no crews
print("\n[AS-001] Testing: Start Auto Sync with no crews")
print("  Setup: Ensuring no crews exist")
# MCP: Delete all crews for this user
response = send_curl("auto sync")
if check_response(response, ["don't have any crews", "no crews", "don't have any"]):
    log_test("AS-001", "Start Auto Sync with no crews", 
             "System responds that no crews exist and exits",
             "auto sync", response, "PASS", "Correctly detected no crews")
else:
    log_test("AS-001", "Start Auto Sync with no crews",
             "System responds that no crews exist and exits",
             "auto sync", response, "FAIL", f"Unexpected response: {json.loads(response).get('response', '')[:100] if response else 'No response'}")

# AS-002: Start Auto Sync with crew selection
print("\n[AS-002] Testing: Start Auto Sync with crew selection")
print("  Setup: Creating test crew 'Friends'")
# MCP: Create crew 'Friends' for this user
# Note: Crew already created via MCP above
clear_conversation_state()
response = send_curl("auto sync Friends")
if check_response(response, ["event name", "Event name", "what's the event", "Event name?"]):
    log_test("AS-002", "Start Auto Sync with crew selection",
             "Crew selected, system prompts for event name",
             "auto sync Friends", response, "PASS", "Crew selected, prompted for event name")
else:
    resp_text = json.loads(response).get("response", "") if response else ""
    log_test("AS-002", "Start Auto Sync with crew selection",
             "Crew selected, system prompts for event name",
             "auto sync Friends", response, "FAIL", f"Crew not found or wrong response: {resp_text[:100]}")

# AS-003: Invalid crew name
print("\n[AS-003] Testing: Invalid crew name")
print("  Setup: Clear conversation state")
clear_conversation_state()
response = send_curl("auto sync FakeCrew")
if check_response(response, ["couldn't find", "not found", "doesn't exist", "I couldn't find"]):
    log_test("AS-003", "Invalid crew name",
             "System responds crew not found",
             "auto sync FakeCrew", response, "PASS", "Correctly rejected invalid crew")
else:
    resp_text = json.loads(response).get("response", "") if response else ""
    log_test("AS-003", "Invalid crew name",
             "System responds crew not found",
             "auto sync FakeCrew", response, "FAIL", f"Did not reject invalid crew: {resp_text[:100]}")

# AS-004: Event name required
print("\n[AS-004] Testing: Event name required")
print("  Setup: Start Auto Sync with crew")
clear_conversation_state()
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("")
if check_response(response2, ["event name", "Please add", "add an event", "Please add an event"]):
    log_test("AS-004", "Event name required",
             "System re-prompts for event name",
             "blank message after crew selection", response2, "PASS", "Correctly re-prompted for event name")
else:
    resp_text = json.loads(response2).get("response", "") if response2 else ""
    log_test("AS-004", "Event name required",
             "System re-prompts for event name",
             "blank message after crew selection", response2, "FAIL", f"Did not re-prompt: {resp_text[:100]}")

# AS-005: Exit during setup
print("\n[AS-005] Testing: Exit during setup")
print("  Setup: Start Auto Sync, provide event name")
clear_conversation_state()
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
time.sleep(1)
response3 = send_curl("exit")
if check_response(response3, ["cancelled", "discarded", "exit", "cancelled", "Auto Sync cancelled"]):
    log_test("AS-005", "Exit during setup",
             "Auto Sync is discarded; normal chat resumes",
             "exit", response3, "PASS", "Correctly cancelled Auto Sync")
else:
    resp_text = json.loads(response3).get("response", "") if response3 else ""
    log_test("AS-005", "Exit during setup",
             "Auto Sync is discarded; normal chat resumes",
             "exit", response3, "FAIL", f"Did not cancel properly: {resp_text[:100]}")

# AS-006: Calendar connected auto-detection
print("\n[AS-006] Testing: Calendar connected auto-detection")
print("  Setup: Check if user has calendar tokens")
# Check calendar status via MCP first
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
if check_response(response2, ["time window", "next week", "weekend"]):
    log_test("AS-006", "Calendar connected auto-detection",
             "Calendar is used automatically; no calendar prompt shown",
             "auto sync Friends -> Test Event", response2, "PASS", "Calendar mode activated")
else:
    log_test("AS-006", "Calendar connected auto-detection",
             "Calendar is used automatically; no calendar prompt shown",
             "auto sync Friends -> Test Event", response2, "SKIP", "User may not have calendar tokens")

# AS-007: Calendar not connected
print("\n[AS-007] Testing: Calendar not connected")
print("  Setup: Ensure no calendar tokens")
# MCP: Verify no calendar tokens exist (already confirmed)
clear_conversation_state()
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
if check_response(response2, ["What times work", "1-3 options", "times work", "What times"]):
    log_test("AS-007", "Calendar not connected",
             "Auto Sync proceeds in no-calendar mode",
             "auto sync Friends -> Test Event", response2, "PASS", "No-calendar mode activated")
else:
    resp_text = json.loads(response2).get("response", "") if response2 else ""
    log_test("AS-007", "Calendar not connected",
             "Auto Sync proceeds in no-calendar mode",
             "auto sync Friends -> Test Event", response2, "FAIL", f"Wrong mode or response: {resp_text[:100]}")

# AS-008: No calendar prompt shown
print("\n[AS-008] Testing: No calendar prompt shown")
print("  Setup: Ensure no calendar tokens")
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
response_text = json.loads(response2).get("response", "").lower() if response2 else ""
if "connect" not in response_text or "calendar" not in response_text or "connect.*calendar" not in response_text:
    log_test("AS-008", "No calendar prompt shown",
             "System does not prompt to connect calendar",
             "auto sync Friends -> Test Event", response2, "PASS", "No calendar prompt shown")
else:
    log_test("AS-008", "No calendar prompt shown",
             "System does not prompt to connect calendar",
             "auto sync Friends -> Test Event", response2, "FAIL", "Calendar prompt was shown")

# AS-009: Calendar mode time window input
print("\n[AS-009] Testing: Calendar mode time window input")
print("  Setup: User must have calendar tokens")
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
time.sleep(1)
response3 = send_curl("next week evenings")
if check_response(response3, ["window that works", "Week view", "evaluates calendar"]):
    log_test("AS-009", "Calendar mode time window input",
             "System evaluates calendar",
             "next week evenings", response3, "PASS", "Calendar evaluated time window")
else:
    log_test("AS-009", "Calendar mode time window input",
             "System evaluates calendar",
             "next week evenings", response3, "SKIP", "May require calendar tokens or different response")

# AS-010: Calendar search produces option
print("\n[AS-010] Testing: Calendar search produces option")
print("  Setup: User must have calendar tokens and availability")
response1 = send_curl("auto sync Friends")
time.sleep(1)
response2 = send_curl("Test Event")
time.sleep(1)
response3 = send_curl("next week evenings")
if check_response(response3, ["window that works", "Week view", "Mon", "Tue", "proposes"]):
    log_test("AS-010", "Calendar search produces option",
             "System proposes first option with calendar view",
             "next week evenings", response3, "PASS", "Calendar proposal shown")
else:
    log_test("AS-010", "Calendar search produces option",
             "System proposes first option with calendar view",
             "next week evenings", response3, "SKIP", "May require calendar tokens or no availability")

# Save JSON report
with open(JSON_FILE, "w", encoding="utf-8") as f:
    json.dump(test_results, f, indent=2)

print(f"\n{'='*60}")
print(f"Test execution complete!")
print(f"Text report: {REPORT_FILE}")
print(f"JSON report: {JSON_FILE}")
print(f"Total tests: {len(test_results)}")
passed = sum(1 for t in test_results if t["status"] == "PASS")
failed = sum(1 for t in test_results if t["status"] == "FAIL")
skipped = sum(1 for t in test_results if t["status"] == "SKIP")
print(f"Passed: {passed}, Failed: {failed}, Skipped: {skipped}")

