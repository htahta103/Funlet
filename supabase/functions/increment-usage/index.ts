import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers
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
    const { phone_number, action_type } = await req.json();

    // Validate input
    if (!phone_number || !action_type) {
      return new Response(JSON.stringify({
        error: 'Phone number and action_type are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate action_type
    const validActions = ['ai_interaction', 'sms_sent', 'create_event'];
    if (!validActions.includes(action_type)) {
      return new Response(JSON.stringify({
        error: 'Invalid action_type. Must be one of: ' + validActions.join(', ')
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

    // Call the database function to increment usage
    const { data, error } = await supabase.rpc('increment_usage', {
      user_phone: phone_number,
      action_type: action_type
    });

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({
        error: 'Failed to increment usage',
        details: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Return success response
    return new Response(JSON.stringify({
      success: true,
      message: `Usage incremented for ${action_type}`,
      phone_number: phone_number,
      action_type: action_type
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Increment usage error:', error);
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
