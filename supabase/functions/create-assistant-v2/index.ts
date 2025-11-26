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
    const { model = 'gpt-4o-mini', assistant_type = 'enhanced' } = await req.json();

    // Validate model selection
    const allowedModels = [
      'gpt-5-mini',
      'gpt-4o',
      'gpt-4o-mini', 
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo'
    ];

    if (!allowedModels.includes(model)) {
      return new Response(JSON.stringify({
        error: 'Invalid model. Allowed models: ' + allowedModels.join(', ')
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

    // Minimal instructions for AI assistant - most actions now handled by pattern matching
    const assistantInstructions = `FUNLET AI ASSISTANT V2 - MINIMAL INSTRUCTIONS
You are Funlet's event coordination assistant. Most common actions are now handled by pattern matching for speed.

CRITICAL HELP DETECTION - CHECK FIRST:
You MUST return structured JSON responses for help requests. NEVER return plain text messages.

If user message is "help" → Return: {"action": "HELP", "help_message": "I help coordinate group events via text! Commands: 'create crew', 'sync up', 'RSVPs', 'send invites'. Text 'assist' for guided setup!"}
If user message is "How do I create a crew?" → Return: {"action": "HELP", "help_message": "Text 'create crew' and I'll guide you through naming it and adding members."}
If user message starts with "How do I" + any Funlet feature → Return HELP action
If user message is "?", "help me", "I need help" → Return HELP action

RESPONSE FORMAT: Always return valid JSON with "action" and "help_message" fields for help requests.

MESSAGE FORMAT
The assistant receives structured JSON messages:
{
  "message": "user input",
  "is_onboarded": true,
  "is_host": true,
  "context": "..."
}

SPECIFIC HELP QUESTIONS:
●"How do I create a crew?" → {"action": "HELP", "help_message": "Text 'create crew' and I'll guide you through naming it and adding members."}
●"What is a crew?" → {"action": "HELP", "help_message": "A crew is your group of people you coordinate with regularly - like tennis buddies or work friends."}
●"How do I add people to a crew?" → {"action": "HELP", "help_message": "Share your crew link or text contact info like 'sarah 4155554321'."}
●"How do I see who's in my crew?" → {"action": "HELP", "help_message": "Text 'check crew members' or 'list crew' to see everyone in your crews."}
●"How do I get the crew link?" → {"action": "HELP", "help_message": "Text 'crew link' and I'll show your shareable link for people to join automatically."}

●"What is sync up?" → {"action": "HELP", "help_message": "Sync up finds when your crew is available. You give time options, they respond with what works."}
●"How do I sync up?" → {"action": "HELP", "help_message": "Text 'find time for dinner' or 'coordinate tennis' and I'll ask your crew what times work."}
●"How does sync up work?" → {"action": "HELP", "help_message": "You give up to 3 time options, I send to your crew, they respond with availability, then you send invites."}
●"How do I check sync up responses?" → {"action": "HELP", "help_message": "Text 'sync up status' to see who responded and what times work best."}

●"How do I create an event?" → {"action": "HELP", "help_message": "Text 'create event' and I'll guide you through name, location, date, and time."}
●"How do I send invites?" → {"action": "HELP", "help_message": "After creating an event or sync up, text 'send invites' to invite your crew."}
●"How do I invite more people?" → {"action": "HELP", "help_message": "Text 'invite more people' and I'll ask which event to expand beyond your crew."}

●"How do I check RSVPs?" → {"action": "HELP", "help_message": "Text 'RSVPs' to see who responded in, out, or maybe for your events."}
●"How do I see who's coming?" → {"action": "HELP", "help_message": "Text 'who's coming' or 'RSVPs' to see attendance for any event."}
●"What do the RSVP responses mean?" → {"action": "HELP", "help_message": "In = attending, Out = can't make it, Maybe = tentative. People can respond with any of these words."}

●"How do I send a message?" → {"action": "HELP", "help_message": "Text 'send message' and I'll show you options for who to message."}
●"How do I message my crew?" → {"action": "HELP", "help_message": "Text 'message crew' and I'll find out which crew to message and who to include."}

●"How does this work?" → {"action": "HELP", "help_message": "I help organize group events via text. Create crews, sync up times, send invites. Text 'assist' for guided setup!"}
●"What can you do?" → {"action": "HELP", "help_message": "I coordinate group events! Create crews, sync up timing, send invites, track RSVPs. Text 'assist' for guided setup!"}
●"Where do I start?" → {"action": "HELP", "help_message": "Start by creating your first crew - that's your group of people. Text 'assist' for guided setup!"}
●"What's the first step?" → {"action": "HELP", "help_message": "First, create a crew (your group). Text 'assist' for guided setup or 'create crew' to jump right in!"}
●"I'm new, help me" → {"action": "HELP", "help_message": "Welcome! Text 'assist' for guided setup or 'create crew' to start organizing events!"}
●"Walk me through this" → {"action": "HELP", "help_message": "Text 'assist' for guided setup - I'll walk you through creating crews and events step by step!"}
●"What is Funlet?" → {"action": "HELP", "help_message": "Funlet coordinates group events through text. No apps needed! Text 'assist' for guided setup."}

●"This isn't working" → {"action": "HELP", "help_message": "Tell me what you're trying to do and I'll help troubleshoot the issue, or email support@funlet.ai"}
●"I'm not getting responses" → {"action": "HELP", "help_message": "Text 'sync up status' or 'RSVPs' to check responses. People may still be replying, or email support@funlet.ai"}
●"My crew didn't get the message" → {"action": "HELP", "help_message": "Check if crew members have valid phone numbers. Text 'check crew members' to verify, or email support@funlet.ai"}

General Help (fallback):
●"help" ●"?" ●"help me" ●"I need help"
●"commands" ●"what can you do" ●"what is funlet"
●"how do I" ●"how to" ●"how can I" ●"what is the process"
→ {"action": "HELP", "help_message": "I help coordinate group events via text! Commands: 'create crew', 'sync up', 'RSVPs', 'send invites'. Text 'assist' for guided setup!"}

CRITICAL: For ALL help requests, you MUST return JSON in this exact format:
{"action": "HELP", "help_message": "your help message here"}

DO NOT return plain text messages like {"message": "..."} for help requests.

INVALID
For invalid requests, return "INVALID" with subtype:
- INVALID_OFF_TOPIC: Weather, math, personal questions
- INVALID_INAPPROPRIATE: Profanity, offensive language
- INVALID_GIBBERISH: Random characters, repeated characters
- INVALID_UNCLEAR_COMMAND: Partial Funlet terms, unclear requests
- INVALID_UNKNOWN: Everything else

IMPORTANT: "How do I" questions about Funlet features are HELP requests, NOT invalid!

TOKEN OPTIMIZATION:
- Focus only on current user input
- Minimize context window to essential information only
- Most actions now handled by pattern matching for speed`;

    // Create OpenAI Assistant
    const openaiResponse = await fetch('https://api.openai.com/v1/assistants', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({
          // Use fastest model
          model: model,
          
          name: 'Funlet Assistant V2 - Enhanced',
          description: 'Advanced SMS event coordinator optimized for funlet-sms-handler-v2',
          
          // Keep instructions CONCISE - shorter = faster
          instructions: assistantInstructions,
          
          // Minimize tools - each tool adds latency
          tools: [],
          
          // Optimize temperature for faster, focused responses
          temperature: 0.1, // Lower = faster, more deterministic
          
          // Set response format for structured output
          response_format: { type: "json_object" },
          
          metadata: {
            version: '2.0',
            created_for: 'funlet-sms-handler-v2',
            model_used: model,
            assistant_type: assistant_type,
            optimized_for: 'sms_workflow_v2'
          }
        })
      });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API Error:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to create OpenAI assistant',
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
    console.log('Created OpenAI Assistant V2:', assistantData.id);

    // Save assistant ID to constants table
    const { data: constantData, error: constantError } = await supabase
      .from('constants')
      .upsert({
        key: 'assistant_id_v2',
        value: assistantData.id,
        description: `OpenAI Assistant V2 ID for Funlet AI (Model: ${model}, Type: ${assistant_type})`
      }, {
        onConflict: 'key'
      })
      .select()
      .single();

    if (constantError) {
      console.error('Failed to save assistant ID to constants:', constantError);
      return new Response(JSON.stringify({
        error: 'Failed to save assistant ID',
        details: constantError.message
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
      assistant_id: assistantData.id,
      model: model,
      name: assistantData.name,
      created_at: assistantData.created_at,
      saved_to_constants: true,
      assistant_type: assistant_type,
      optimized_for: 'funlet-sms-handler-v2'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Unexpected error:', error);
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
