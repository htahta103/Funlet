/**
 * Generates calendar event links for Google Calendar and Apple Calendar
 * @param {Object} eventData - Event details
 * @param {string} eventData.title - Event title
 * @param {string} eventData.description - Event description
 * @param {Date|string} eventData.startDate - Event start date
 * @param {Date|string} eventData.endDate - Event end date
 * @param {string} eventData.location - Event location (optional)
 * @param {boolean} eventData.allDay - Whether it's an all-day event (optional)
 * @returns {Object} Object containing Google Calendar and Apple Calendar URLs
 */
function generateCalendarEventLinks(eventData) {
  const {
    title,
    description = '',
    startDate,
    endDate,
    location = '',
    allDay = false
  } = eventData;

  // Validate required fields
  if (!title || !startDate) {
    throw new Error('Title and startDate are required');
  }

  // Format dates for URLs
  const formatDateForGoogle = (date) => {
    const d = new Date(date);
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const formatDateForApple = (date) => {
    const d = new Date(date);
    return d.toISOString().replace(/[-:]/g, '').split('.')[0];
  };

  // Google Calendar URL
  const googleCalendarUrl = (() => {
    const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    const params = new URLSearchParams();
    
    params.append('text', title);
    params.append('details', description);
    params.append('location', location);
    
    if (allDay) {
      const start = new Date(startDate);
      const end = new Date(endDate || startDate);
      params.append('dates', `${start.toISOString().split('T')[0]}/${end.toISOString().split('T')[0]}`);
    } else {
      params.append('dates', `${formatDateForGoogle(startDate)}/${formatDateForGoogle(endDate || startDate)}`);
    }
    
    return `${baseUrl}&${params.toString()}`;
  })();

  // Apple Calendar URL (using .ics format)
  const appleCalendarUrl = (() => {
    const start = new Date(startDate);
    const end = new Date(endDate || startDate);
    
    const formatDateForICS = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calendar Event//EN',
      'BEGIN:VEVENT',
      `DTSTART:${allDay ? formatDateForICS(start).split('T')[0] : formatDateForICS(start)}`,
      `DTEND:${allDay ? formatDateForICS(end).split('T')[0] : formatDateForICS(end)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
      `LOCATION:${location}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n');

    return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
  })();

  return {
    google: googleCalendarUrl,
    apple: appleCalendarUrl,
    // Also provide a universal link that detects platform
    universal: generateUniversalCalendarLink(eventData)
  };
}

/**
 * Generates a universal calendar link that detects platform and redirects appropriately
 * @param {Object} eventData - Event details
 * @returns {string} Universal calendar link
 */
function generateUniversalCalendarLink(eventData) {
  const { google, apple } = generateCalendarEventLinks(eventData);
  
  // This would typically be handled by a server-side redirect
  // For now, we'll return a simple detection script
  return `
    <script>
      if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        window.location.href = '${apple}';
      } else {
        window.location.href = '${google}';
      }
    </script>
  `;
}

/**
 * Creates a simple HTML page with calendar event buttons
 * @param {Object} eventData - Event details
 * @returns {string} HTML content
 */
function createCalendarEventPage(eventData) {
  const { google, apple } = generateCalendarEventLinks(eventData);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Add to Calendar</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
        .calendar-btn { 
          display: inline-block; 
          margin: 10px; 
          padding: 15px 30px; 
          background: #007AFF; 
          color: white; 
          text-decoration: none; 
          border-radius: 8px; 
          font-size: 16px;
        }
        .calendar-btn:hover { background: #0056CC; }
        .google-btn { background: #4285F4; }
        .apple-btn { background: #000; }
      </style>
    </head>
    <body>
      <h2>Add Event to Calendar</h2>
      <p><strong>${eventData.title}</strong></p>
      <p>${eventData.description}</p>
      <a href="${google}" class="calendar-btn google-btn">Add to Google Calendar</a>
      <a href="${apple}" class="calendar-btn apple-btn">Add to Apple Calendar</a>
    </body>
    </html>
  `;
}

// Example usage:
const eventData = {
  title: 'Team Meeting',
  description: 'Weekly team standup meeting',
  startDate: '2024-01-15T10:00:00',
  endDate: '2024-01-15T11:00:00',
  location: 'Conference Room A',
  allDay: false
};

console.log('Calendar Links:', generateCalendarEventLinks(eventData));
console.log('HTML Page:', createCalendarEventPage(eventData));

// Export functions
module.exports = {
  generateCalendarEventLinks,
  generateUniversalCalendarLink,
  createCalendarEventPage
};
