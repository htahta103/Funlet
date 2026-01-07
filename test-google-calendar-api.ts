/**
 * Test script to fetch events from Google Calendar API
 * Run with: deno run --allow-net test-google-calendar-api.ts
 */

const ACCESS_TOKEN = Deno.env.get("GOOGLE_ACCESS_TOKEN") || "YOUR_ACCESS_TOKEN_HERE";

// Get current date and 7 days from now for time range
const now = new Date();
const timeMin = now.toISOString();
const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

console.log('📅 Testing Google Calendar API...');
console.log('Time range:', { timeMin, timeMax });
console.log('');

async function testGetCalendarEvents() {
  try {
    // Test 1: Get calendar list
    console.log('Test 1: Getting calendar list...');
    const calendarListResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!calendarListResponse.ok) {
      const errorText = await calendarListResponse.text();
      console.error('❌ Calendar list error:', calendarListResponse.status, errorText);
      return;
    }

    const calendarList = await calendarListResponse.json();
    console.log('✅ Calendar list retrieved:', {
      totalCalendars: calendarList.items?.length || 0,
      primaryCalendar: calendarList.items?.find((cal: any) => cal.primary)?.summary || 'Not found'
    });
    console.log('');

    // Test 2: Get events from primary calendar
    console.log('Test 2: Getting events from primary calendar...');
    const eventsResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=10&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!eventsResponse.ok) {
      const errorText = await eventsResponse.text();
      console.error('❌ Events error:', eventsResponse.status, errorText);
      return;
    }

    const eventsData = await eventsResponse.json();
    console.log('✅ Events retrieved:', {
      totalEvents: eventsData.items?.length || 0,
      timeZone: eventsData.timeZone || 'Not specified'
    });
    console.log('');

    // Display events
    if (eventsData.items && eventsData.items.length > 0) {
      console.log('📋 Upcoming Events:');
      eventsData.items.forEach((event: any, index: number) => {
        const start = event.start?.dateTime || event.start?.date;
        const end = event.end?.dateTime || event.end?.date;
        console.log(`${index + 1}. ${event.summary || '(No title)'}`);
        console.log(`   Start: ${start}`);
        console.log(`   End: ${end}`);
        if (event.location) {
          console.log(`   Location: ${event.location}`);
        }
        console.log('');
      });
    } else {
      console.log('📭 No events found in the next 7 days');
    }

    // Test 3: Get calendar timezone
    console.log('Test 3: Getting calendar timezone...');
    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (calendarResponse.ok) {
      const calendar = await calendarResponse.json();
      console.log('✅ Calendar timezone:', calendar.timeZone || 'Not specified');
    } else {
      const errorText = await calendarResponse.text();
      console.error('❌ Calendar timezone error:', calendarResponse.status, errorText);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testGetCalendarEvents();




