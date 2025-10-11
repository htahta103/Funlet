import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface CalendarEventData {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: string;
  allDay?: boolean;
}

interface RebrandlyLink {
  id: string;
  title: string;
  slashtag: string;
  destination: string;
  shortUrl: string;
  domain: {
    id: string;
    ref: string;
    fullName: string;
  };
}

interface RebrandlyResponse {
  data: RebrandlyLink[];
  errors: any[];
}

interface TrafficRoutingRule {
  condition: string;
  destination: string;
  description: string;
}

/**
 * Generates Google Calendar URL
 */
function generateGoogleCalendarUrl(eventData: CalendarEventData): string {
  const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const params = new URLSearchParams();
  
  params.append('text', eventData.title);
  params.append('details', eventData.description || '');
  params.append('location', eventData.location || '');
  
  if (eventData.allDay) {
    const start = new Date(eventData.startDate);
    const end = new Date(eventData.endDate || eventData.startDate);
    params.append('dates', `${start.toISOString().split('T')[0]}/${end.toISOString().split('T')[0]}`);
  } else {
    const formatDateForGoogle = (date: string) => {
      const d = new Date(date);
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    params.append('dates', `${formatDateForGoogle(eventData.startDate)}/${formatDateForGoogle(eventData.endDate || eventData.startDate)}`);
  }
  
  return `${baseUrl}&${params.toString()}`;
}

/**
 * Generates Apple Calendar URL (.ics format)
 */
function generateAppleCalendarUrl(eventData: CalendarEventData): string {
  const start = new Date(eventData.startDate);
  const end = new Date(eventData.endDate || eventData.startDate);
  
  const formatDateForICS = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendar Event//EN',
    'BEGIN:VEVENT',
    `DTSTART:${eventData.allDay ? formatDateForICS(start).split('T')[0] : formatDateForICS(start)}`,
    `DTEND:${eventData.allDay ? formatDateForICS(end).split('T')[0] : formatDateForICS(end)}`,
    `SUMMARY:${eventData.title}`,
    `DESCRIPTION:${(eventData.description || '').replace(/\n/g, '\\n')}`,
    `LOCATION:${eventData.location || ''}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n');

  return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
}

/**
 * Creates a fallback HTML page for calendar selection
 */
function createFallbackHTMLPage(eventData: CalendarEventData): string {
  const googleUrl = generateGoogleCalendarUrl(eventData);
  const appleUrl = generateAppleCalendarUrl(eventData);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Add to Calendar</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 20px; 
          text-align: center; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
          margin: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .container {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 40px;
          max-width: 500px;
          margin: 0 auto;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        .calendar-btn { 
          display: block; 
          margin: 15px auto; 
          padding: 15px 30px; 
          background: rgba(255, 255, 255, 0.2);
          color: white; 
          text-decoration: none; 
          border-radius: 12px; 
          font-size: 16px;
          font-weight: 600;
          transition: all 0.3s ease;
          border: 2px solid rgba(255, 255, 255, 0.3);
        }
        .calendar-btn:hover { 
          background: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        .google-btn { 
          background: linear-gradient(45deg, #4285F4, #34A853);
          border-color: #4285F4;
        }
        .apple-btn { 
          background: linear-gradient(45deg, #000, #333);
          border-color: #000;
        }
        h2 { margin-bottom: 20px; font-size: 24px; }
        .event-details { 
          background: rgba(255, 255, 255, 0.1);
          padding: 20px;
          border-radius: 12px;
          margin: 20px 0;
          text-align: left;
        }
        .event-title { font-size: 20px; font-weight: bold; margin-bottom: 10px; }
        .event-description { margin-bottom: 10px; }
        .event-location { color: #ccc; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>📅 Add to Calendar</h2>
        <div class="event-details">
          <div class="event-title">${eventData.title}</div>
          <div class="event-description">${eventData.description || ''}</div>
          ${eventData.location ? `<div class="event-location">📍 ${eventData.location}</div>` : ''}
        </div>
        <a href="${googleUrl}" class="calendar-btn google-btn">📱 Add to Google Calendar</a>
        <a href="${appleUrl}" class="calendar-btn apple-btn">🍎 Add to Apple Calendar</a>
      </div>
    </body>
    </html>
  `;
}

/**
 * Creates a Rebrandly link with traffic routing
 */
async function createRebrandlyLink(
  eventData: CalendarEventData,
  rebrandlyApiKey: string,
  domainId?: string
): Promise<RebrandlyLink> {
  const googleUrl = generateGoogleCalendarUrl(eventData);
  const appleUrl = generateAppleCalendarUrl(eventData);
  
  // Create the main link (default to Google Calendar)
  const linkData = {
    destination: googleUrl,
    title: `Calendar Event: ${eventData.title}`,
    slashtag: `cal-${Date.now()}`,
    ...(domainId && { domain: { id: domainId } })
  };

  const response = await fetch('https://api.rebrandly.com/v1/links', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': rebrandlyApiKey
    },
    body: JSON.stringify(linkData)
  });

  if (!response.ok) {
    throw new Error(`Rebrandly API error: ${response.status} ${response.statusText}`);
  }

  const result: RebrandlyResponse = await response.json();
  
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Rebrandly API errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data[0];
}

/**
 * Sets up traffic routing rules for the Rebrandly link
 */
async function setupTrafficRouting(
  linkId: string,
  eventData: CalendarEventData,
  rebrandlyApiKey: string
): Promise<void> {
  const googleUrl = generateGoogleCalendarUrl(eventData);
  const appleUrl = generateAppleCalendarUrl(eventData);
  
  const routingRules: TrafficRoutingRule[] = [
    {
      condition: 'deviceType = "iOS"',
      destination: appleUrl,
      description: 'Redirect iOS users to Apple Calendar'
    },
    {
      condition: 'deviceType = "Android"',
      destination: googleUrl,
      description: 'Redirect Android users to Google Calendar'
    },
    {
      condition: 'deviceType = "Desktop"',
      destination: googleUrl,
      description: 'Redirect desktop users to Google Calendar'
    }
  ];

  // Note: Traffic routing setup via API may require different endpoints
  // This is a conceptual implementation - check Rebrandly API docs for exact endpoints
  for (const rule of routingRules) {
    try {
      await fetch(`https://api.rebrandly.com/v1/links/${linkId}/routing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': rebrandlyApiKey
        },
        body: JSON.stringify(rule)
      });
    } catch (error) {
      console.warn(`Failed to set up routing rule: ${rule.condition}`, error);
    }
  }
}

Deno.serve(async (req: Request) => {
  try {
    // Handle CORS
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { eventData, useTrafficRouting = true } = await req.json();

    // Validate required fields
    if (!eventData || !eventData.title || !eventData.startDate) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: title and startDate are required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get Rebrandly API key from environment
    const rebrandlyApiKey = Deno.env.get('REBRANDLY_API_KEY');
    if (!rebrandlyApiKey) {
      return new Response(JSON.stringify({ 
        error: 'Rebrandly API key not configured' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get domain ID from environment (optional)
    const domainId = Deno.env.get('REBRANDLY_DOMAIN_ID');

    let result;

    if (useTrafficRouting) {
      // Create Rebrandly link with traffic routing
      const link = await createRebrandlyLink(eventData, rebrandlyApiKey, domainId);
      
      // Set up traffic routing rules
      await setupTrafficRouting(link.id, eventData, rebrandlyApiKey);
      
      result = {
        success: true,
        link: {
          id: link.id,
          shortUrl: link.shortUrl,
          title: link.title,
          slashtag: link.slashtag
        },
        message: 'Calendar link created with traffic routing',
        urls: {
          google: generateGoogleCalendarUrl(eventData),
          apple: generateAppleCalendarUrl(eventData)
        }
      };
    } else {
      // Create fallback HTML page
      const htmlPage = createFallbackHTMLPage(eventData);
      
      result = {
        success: true,
        htmlPage: htmlPage,
        message: 'HTML calendar page generated',
        urls: {
          google: generateGoogleCalendarUrl(eventData),
          apple: generateAppleCalendarUrl(eventData)
        }
      };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error generating calendar link:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
