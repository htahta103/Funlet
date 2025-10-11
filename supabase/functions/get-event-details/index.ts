import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers for WeWeb integration
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

// UUID validation function
const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

Deno.serve(async (req) => {
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
    // Parse request body
    const { input } = await req.json();

    // Validate input
    if (!input) {
      return new Response(JSON.stringify({
        error: 'Input is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Received request with input:', input);

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    let eventData;
    let invitationData = null;

    // Determine if input is event_id (UUID) or invitation_code
    if (isValidUUID(input)) {
      console.log('Input is UUID, treating as event_id');
      
      // Fetch event details directly by event_id
      const { data, error } = await supabase
        .from('events')
        .select(`
          *,
          profiles!events_creator_id_fkey (first_name, phone_number)
        `)
        .eq('id', input)
        .single();

      if (error) {
        console.error('Event error:', error);
        return new Response(JSON.stringify({
          error: 'Event not found'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      eventData = data;
    } else {
      console.log('Input is not UUID, treating as invitation_code');
      
      // Fetch event details via invitation_code
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          events (
            *,
            profiles!events_creator_id_fkey (first_name, phone_number)
          ),
          contacts (first_name, phone_number)
        `)
        .eq('invitation_code', input)
        .single();

      if (error) {
        console.error('Invitation error:', error);
        return new Response(JSON.stringify({
          error: 'Invitation not found'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      invitationData = data;
      eventData = data.events;
    }

    if (!eventData) {
      return new Response(JSON.stringify({
        error: 'Event not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get RSVP counts for the event
    const { data: rsvpCounts, error: countError } = await supabase
      .from('invitations')
      .select('response_note, status')
      .eq('event_id', eventData.id)
      .eq('status', 'sent');

    let inCount = 0;
    let maybeCount = 0;
    let outCount = 0;
    let noResponseCount = 0;

    if (!countError && rsvpCounts) {
      rsvpCounts.forEach(invitation => {
        switch (invitation.response_note) {
          case 'in':
            inCount++;
            break;
          case 'maybe':
            maybeCount++;
            break;
          case 'out':
            outCount++;
            break;
          case 'no_response':
          default:
            noResponseCount++;
            break;
        }
      });
    }

    // Format the response
    const response = {
      event: {
        id: eventData.id,
        title: eventData.title,
        location: eventData.location,
        event_date: eventData.event_date,
        start_time: eventData.start_time,
        end_time: eventData.end_time,
        notes: eventData.notes,
        creator_id: eventData.creator_id,
        crew_id: eventData.crew_id,
        created_at: eventData.created_at,
        updated_at: eventData.updated_at
      },
      host: eventData.profiles || null,
      rsvpCounts: {
        in: inCount,
        maybe: maybeCount,
        out: outCount,
        noResponse: noResponseCount
      }
    };

    // If we got the data via invitation_code, include invitation and guest info
    if (invitationData) {
      response.invitation = {
        id: invitationData.id,
        event_id: invitationData.event_id,
        contact_id: invitationData.contact_id,
        response_note: invitationData.response_note,
        invitation_code: invitationData.invitation_code,
        status: invitationData.status,
        responded_at: invitationData.responded_at,
        invited_by: invitationData.invited_by,
        created_at: invitationData.created_at,
        updated_at: invitationData.updated_at
      };
      response.guest = invitationData.contacts || null;
    }

    // Return successful response
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Get event details error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
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
