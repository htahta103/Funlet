import { createClient } from 'npm:@supabase/supabase-js@2.39.0';

// CORS headers for WeWeb compatibility
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
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
    const { invitation_code } = await req.json();

    // Validate input
    if (!invitation_code) {
      return new Response(JSON.stringify({
        error: 'Invitation code is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Supabase client with service role (bypass RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Comprehensive join query to fetch invitation, contact, and event data
    const { data, error } = await supabase
      .from('invitations')
      .select(`
        *,
        contacts (first_name, phone_number),
        events (
          title,
          location,
          event_date,
          start_time,
          end_time,
          creator_id,
          calendar_url,
          shorten_calendar_url
        )
      `)
      .eq('invitation_code', invitation_code)
      .single();

    // Handle no data found
    if (error || !data) {
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

    // Get host name from profiles using creator_id
    let hostName = null;
    if (data.events?.creator_id) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('first_name')
        .eq('id', data.events.creator_id)
        .single();
      hostName = profileData?.first_name;
    }

    // Get all invitations for the event with contact details
    const { data: allInvitations, error: invitationsError } = await supabase
      .from('invitations')
      .select(`
        id,
        event_id,
        contact_id,
        response_note,
        invitation_code,
        status,
        responded_at,
        invited_by,
        is_host,
        created_at,
        updated_at,
        contact:contacts (first_name, phone_number)
      `)
      .eq('event_id', data.event_id)
      .eq('status', 'sent')
      .order('created_at', { ascending: true });

    // Calculate RSVP counts
    let inCount = 0;
    let maybeCount = 0;
    let outCount = 0;
    let noResponseCount = 0;

    if (!invitationsError && allInvitations) {
      allInvitations.forEach((invitation) => {
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

    // Restructure response to match specified format
    const response = {
      invitation: {
        id: data.id,
        event_id: data.event_id,
        contact_id: data.contact_id,
        response_note: data.response_note,
        invitation_code: data.invitation_code,
        status: data.status,
        responded_at: data.responded_at,
        invited_by: data.invited_by,
        is_host: data.is_host,
        created_at: data.created_at,
        updated_at: data.updated_at
      },
      guest: data.contacts || null,
      event: data.events || null,
      host: {
        first_name: hostName
      },
      rsvpCounts: {
        in: inCount,
        maybe: maybeCount,
        out: outCount,
        noResponse: noResponseCount
      },
      invitations: allInvitations || []
    };

    // Return successful response
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});