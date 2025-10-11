import { createClient } from 'npm:@supabase/supabase-js@2';

// === Helper: shorten URL by Rebrandly ===
async function shortenUrl(longUrl) {
  try {
    const res = await fetch("https://api.rebrandly.com/v1/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("REBRANDLY_API_KEY")
      },
      body: JSON.stringify({
        destination: longUrl,
        domain: {
          fullName: "cal.funlet.ai"
        }
      })
    });
    if (!res.ok) {
      console.error("Failed to shorten URL:", await res.text());
      return null; // ❌ nếu lỗi → null
    }
    const data = await res.json();
    return `https://${data.shortUrl}`;
  } catch (err) {
    console.error("Error in shortenUrl:", err);
    return null; // ❌ nếu exception → null
  }
}

// Helper function to generate ICS file content for events
function generateICSContent(event) {
  const now = new Date();
  const eventDate = new Date(event.event_date);
  
  // Parse time and create full datetime
  const [startHours, startMinutes] = event.start_time ? event.start_time.split(':').map(Number) : [12, 0];
  const [endHours, endMinutes] = event.end_time ? event.end_time.split(':').map(Number) : [13, 0];
  
  const startDateTime = new Date(eventDate);
  startDateTime.setHours(startHours, startMinutes, 0, 0);
  
  const endDateTime = new Date(eventDate);
  endDateTime.setHours(endHours, endMinutes, 0, 0);
  
  // Format dates for ICS (YYYYMMDDTHHMMSSZ format)
  const formatICSDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  
  const startICS = formatICSDate(startDateTime);
  const endICS = formatICSDate(endDateTime);
  const createdICS = formatICSDate(now);
  
  // Generate unique UID for the event
  const uid = `event-${event.id}@funlet.ai`;
  
  // Escape special characters for ICS format
  const escapeICSText = (text) => {
    return text.replace(/[\\,;]/g, '\\$&').replace(/\n/g, '\\n');
  };
  
  const title = escapeICSText(event.title);
  const location = event.location ? escapeICSText(event.location) : '';
  const description = escapeICSText(`Event created via Funlet.ai${event.notes ? ' - ' + event.notes : ''}`);
  
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Funlet//Funlet Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${createdICS}
DTSTART:${startICS}
DTEND:${endICS}
SUMMARY:${title}
DESCRIPTION:${description}
LOCATION:${location}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;
}

// Helper function to create and store ICS file for events
async function createAndStoreICSFile(supabase, event) {
  try {
    // Generate ICS content
    const icsContent = generateICSContent(event);
    
    // Use event_id as filename for easy querying
    const filename = `${event.id}.ics`;
    
    // Ensure calendar-files bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some((bucket) => bucket.name === 'calendar-files');
    
    if (!bucketExists) {
      console.log('Creating calendar-files bucket...');
      const { error: bucketError } = await supabase.storage.createBucket('calendar-files', {
        public: true,
        allowedMimeTypes: ['text/calendar', 'application/octet-stream'],
        fileSizeLimit: 1024 * 1024 // 1MB limit
      });
      
      if (bucketError) {
        console.error('Failed to create bucket:', bucketError);
        return null;
      }
    }
    
    // Upload ICS file to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('calendar-files')
      .upload(filename, icsContent, {
        contentType: 'text/calendar',
        upsert: true
      });
    
    if (uploadError) {
      console.error('Failed to upload ICS file:', uploadError);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('calendar-files')
      .getPublicUrl(filename);
    
    console.log('ICS file created successfully:', urlData.publicUrl);
    return urlData.publicUrl;
    
  } catch (error) {
    console.error('Error creating ICS file:', error);
    return null;
  }
}

Deno.serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  // Ensure it's a POST request
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    const { event_id } = await req.json();

    if (!event_id) {
      return new Response(JSON.stringify({
        error: 'event_id is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get event data
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      console.error('Event not found:', eventError);
      return new Response(JSON.stringify({
        error: 'Event not found',
        details: eventError?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Generate ICS file for the event
    const calendarUrl = await createAndStoreICSFile(supabase, event);
    
    if (!calendarUrl) {
      return new Response(JSON.stringify({
        error: 'Failed to generate ICS file'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // === Shorten URL calendarUrl ===
    const shortenUrlValue = await shortenUrl(calendarUrl); // có thể null

    // Update event with calendar URL
    const { error: updateError } = await supabase
      .from('events')
      .update({ 
        calendar_url: calendarUrl,
        shorten_calendar_url: shortenUrlValue,
        updated_at: new Date().toISOString()
      })
      .eq('id', event_id);

    if (updateError) {
      console.error('Failed to update event with calendar URL:', updateError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'ICS file generated successfully',
      event_id: event_id,
      calendar_url: calendarUrl,
      shorten_calendar_url: shortenUrlValue,
      event_title: event.title
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('ICS generation error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate ICS files',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});