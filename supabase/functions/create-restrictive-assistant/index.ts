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
    const { model = 'gpt-4o-mini' } = await req.json();

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Enhanced instructions supporting both simple actions and structured data extraction
    const restrictiveInstructions = `You are a minimal SMS event coordinator. Respond with action words or structured JSON when data extraction is needed.

RESPONSE FORMATS:

1. SIMPLE ACTIONS (respond with action word only):
- CREATE_CREW: User wants to create a crew
- SYNC_UP: User wants to find time/coordinate
- CHECK_RSVPS: User wants to check responses
- ADD_CREW_MEMBERS: User wants to add people
- CHECK_CREW_MEMBERS: User wants to see crew
- SYNC_UP_STATUS: User wants sync up status
- RE_SYNC: User wants to add more times
- SEND_INVITATIONS: User wants to send invites
- INVITE_MORE_PEOPLE: User wants to invite more
- SEND_MESSAGE: User wants to message crew
- RECEIVE_MESSAGE: User sent custom message
- HELP: User needs help
- ONBOARDING_START: User wants guided setup
- INVALID: Unclear request

2. STRUCTURED RESPONSES (respond with JSON when extracting data):
For onboarding data extraction, use these formats:

Crew name extraction:
{
  "action": "ONBOARDING_CONTINUE",
  "extracted_data": {
    "crew_name": "extracted crew name here"
  }
}

Location/timezone extraction:
{
  "action": "ONBOARDING_CONTINUE", 
  "extracted_data": {
    "location": "city name or location",
    "timezone": "timezone identifier"
  }
}

RULES:
1. For simple actions, respond with ONLY the action word
2. For data extraction (crew names, dates, etc.), respond with JSON
3. No explanations or additional text
4. Keep simple responses under 20 characters
5. Use exact action words only
6. For unclear requests, respond "INVALID"

EXAMPLES:
"create crew" → CREATE_CREW
"sync up" → SYNC_UP
"help" → HELP
"my crew name is test crew" → {"action": "ONBOARDING_CONTINUE", "extracted_data": {"crew_name": "test crew"}}
"crew is awesome team" → {"action": "ONBOARDING_CONTINUE", "extracted_data": {"crew_name": "awesome team"}}
"I'm in San Francisco" → {"action": "ONBOARDING_CONTINUE", "extracted_data": {"location": "San Francisco", "timezone": "America/Los_Angeles"}}
"Los Angeles" → {"action": "ONBOARDING_CONTINUE", "extracted_data": {"location": "Los Angeles", "timezone": "America/Los_Angeles"}}
"what time" → INVALID
"hello" → INVALID`;

    // Create OpenAI Assistant
    const openaiResponse = await fetch('https://api.openai.com/v1/assistants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        model: model,
        name: 'Funlet Enhanced Assistant',
        description: 'SMS event coordinator with structured data extraction',
        instructions: restrictiveInstructions,
        tools: [],
        metadata: {
          version: '3.0',
          type: 'enhanced',
          token_optimized: 'true',
          structured_responses: 'true',
          data_extraction: 'true'
        }
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API Error:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to create restrictive assistant',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const assistantData = await openaiResponse.json();
    console.log('Created Restrictive Assistant:', assistantData.id);

    // Save assistant ID to constants table
    const { data: constantData, error: constantError } = await supabase
      .from('constants')
      .upsert({
        key: 'openai_assistant_id_enhanced',
        value: assistantData.id,
        description: 'Enhanced assistant with structured data extraction'
      });

    if (constantError) {
      console.error('Error saving assistant ID:', constantError);
    }

    return new Response(JSON.stringify({
      success: true,
      assistant_id: assistantData.id,
      model: model,
      type: 'enhanced',
      token_optimized: true,
      structured_responses: true,
      data_extraction: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Assistant Creation Error:', error);
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
