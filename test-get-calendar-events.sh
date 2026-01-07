#!/bin/bash
# Test script to get events from Google Calendar API
# Usage: ./test-get-calendar-events.sh <access_token>

ACCESS_TOKEN="${1:-}"

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Error: Access token required"
  echo "Usage: ./test-get-calendar-events.sh <access_token>"
  echo ""
  echo "Example:"
  echo "  ./test-get-calendar-events.sh ya29.A0Aa7pCA..."
  exit 1
fi

echo "📅 Testing Google Calendar API - Getting Events"
echo "================================================"
echo ""

# Get current date and 7 days from now
TIME_MIN=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIME_MAX=$(date -u -v+7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")

if [ -z "$TIME_MAX" ]; then
  # Fallback: calculate 7 days manually
  TIME_MAX=$(date -u +%Y-%m-%dT%H:%M:%SZ | awk -F'T' '{print $1"T23:59:59Z"}')
fi

echo "⏰ Time range: $TIME_MIN to $TIME_MAX"
echo ""

# Test 1: Get calendar timezone
echo "1️⃣ Getting calendar timezone..."
CALENDAR_INFO=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/calendars/primary")

TIMEZONE=$(echo "$CALENDAR_INFO" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('timeZone', 'Not found'))" 2>/dev/null)

if [ "$TIMEZONE" != "Not found" ] && [ ! -z "$TIMEZONE" ]; then
  echo "✅ Calendar timezone: $TIMEZONE"
else
  echo "⚠️  Could not get timezone"
fi
echo ""

# Test 2: Get events from primary calendar
echo "2️⃣ Getting events from primary calendar (next 7 days)..."
EVENTS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${TIME_MIN}&timeMax=${TIME_MAX}&maxResults=10&singleEvents=true&orderBy=startTime")

# Check for errors
ERROR=$(echo "$EVENTS_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('error', {}).get('message', ''))" 2>/dev/null)

if [ ! -z "$ERROR" ] && [ "$ERROR" != "None" ]; then
  echo "❌ Error: $ERROR"
  echo ""
  echo "Full response:"
  echo "$EVENTS_RESPONSE" | python3 -m json.tool
  exit 1
fi

# Parse events
EVENT_COUNT=$(echo "$EVENTS_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('items', [])))" 2>/dev/null)

if [ -z "$EVENT_COUNT" ]; then
  EVENT_COUNT=0
fi

echo "✅ Found $EVENT_COUNT event(s)"
echo ""

if [ "$EVENT_COUNT" -gt 0 ]; then
  echo "📋 Events:"
  echo "$EVENTS_RESPONSE" | python3 -c "
import sys, json
from datetime import datetime

data = json.load(sys.stdin)
events = data.get('items', [])

for i, event in enumerate(events, 1):
    summary = event.get('summary', '(No title)')
    start = event.get('start', {})
    end = event.get('end', {})
    
    start_time = start.get('dateTime') or start.get('date', '')
    end_time = end.get('dateTime') or end.get('date', '')
    
    location = event.get('location', '')
    
    print(f'{i}. {summary}')
    print(f'   Start: {start_time}')
    print(f'   End: {end_time}')
    if location:
        print(f'   Location: {location}')
    print()
" 2>/dev/null || echo "$EVENTS_RESPONSE" | python3 -m json.tool
else
  echo "📭 No events found in the next 7 days"
  echo ""
  echo "Full response:"
  echo "$EVENTS_RESPONSE" | python3 -m json.tool | head -20
fi

echo ""
echo "✅ Test complete!"




