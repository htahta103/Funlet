#!/bin/bash
# Test script to fetch events from Google Calendar API
# Usage: ./test-calendar-api.sh <access_token>

ACCESS_TOKEN="${1:-}"

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Usage: ./test-calendar-api.sh <access_token>"
  echo "Example: ./test-calendar-api.sh ya29.A0Aa7pCA..."
  exit 1
fi

echo "📅 Testing Google Calendar API with provided token..."
echo ""

# Get current date and 7 days from now
TIME_MIN=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIME_MAX=$(date -u -v+7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")

if [ -z "$TIME_MAX" ]; then
  # Fallback: calculate 7 days manually
  TIME_MAX=$(date -u +%Y-%m-%dT%H:%M:%SZ | awk -F'T' '{print $1"T23:59:59Z"}')
fi

echo "Time range: $TIME_MIN to $TIME_MAX"
echo ""

# Test 1: Get calendar list
echo "Test 1: Getting calendar list..."
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/users/me/calendarList" | python3 -m json.tool
echo ""

# Test 2: Get events from primary calendar
echo "Test 2: Getting events from primary calendar..."
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${TIME_MIN}&timeMax=${TIME_MAX}&maxResults=10&singleEvents=true&orderBy=startTime" | python3 -m json.tool
echo ""

# Test 3: Get calendar timezone
echo "Test 3: Getting calendar timezone..."
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/calendars/primary" | python3 -m json.tool | grep -A 2 "timeZone"
echo ""




