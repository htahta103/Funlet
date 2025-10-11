import { createClient } from 'npm:@supabase/supabase-js@2';

// Enhanced CORS headers with wildcard for headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
};

// Detailed logging function
function logRequest(req, stage) {
  console.log(`[USER_CONTACT_FUNCTION] ${stage} Request Details:`, {
    method: req.method,
    url: req.url,
    headers: Object.fromEntries(req.headers),
    timestamp: new Date().toISOString()
  });
}

// Handle OPTIONS requests with expanded CORS support
function handleOptions(req) {
  logRequest(req, 'OPTIONS_PREFLIGHT');
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

Deno.serve(async (req) => {
  // Log all incoming requests for debugging
  logRequest(req, 'INCOMING_REQUEST');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleOptions(req);
  }

  // Ensure it's a POST request
  if (req.method !== 'POST') {
    console.warn(`[USER_CONTACT_FUNCTION] Unsupported method: ${req.method}`);
    return new Response(JSON.stringify({
      error: true,
      message: 'Only POST requests are allowed',
      receivedMethod: req.method
    }), {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    // Log request body for debugging
    const rawBody = await req.text();
    console.log('[USER_CONTACT_FUNCTION] Raw Request Body:', rawBody);

    // Parse request body
    let requestBody;
    try {
      requestBody = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('[USER_CONTACT_FUNCTION] JSON Parse Error:', parseError);
      return new Response(JSON.stringify({
        error: true,
        message: 'Invalid JSON in request body',
        rawBody: rawBody
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    const { user_id, first_name, phone_number } = requestBody;

    // Validate input
    if (!user_id || !first_name) {
      return new Response(JSON.stringify({
        error: true,
        message: 'user_id and first_name are required',
        receivedBody: requestBody
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Supabase client with Service Role key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Insert contact record
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        user_id,
        first_name,
        phone_number
      })
      .select()
      .single();

    // Handle insertion errors
    if (error) {
      console.error('[USER_CONTACT_FUNCTION] Contact creation error:', error);
      return new Response(JSON.stringify({
        error: true,
        message: error.message || 'Failed to create contact',
        details: error
      }), {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Successfully created contact
    console.log('[USER_CONTACT_FUNCTION] Contact created successfully:', data);
    return new Response(JSON.stringify({
      error: false,
      contact: data
    }), {
      status: 201,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    console.error('[USER_CONTACT_FUNCTION] Unhandled error:', err);
    return new Response(JSON.stringify({
      error: true,
      message: 'Internal server error',
      errorDetails: err.toString()
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
});
