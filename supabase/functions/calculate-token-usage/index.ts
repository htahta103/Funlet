import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Token pricing per 1M tokens (as of 2024)
const TOKEN_PRICING = {
  'gpt-4o': {
    input: 2.50,  // $2.50 per 1M input tokens
    output: 10.00 // $10.00 per 1M output tokens
  },
  'gpt-4o-mini': {
    input: 0.15,  // $0.15 per 1M input tokens
    output: 0.60  // $0.60 per 1M output tokens
  },
  'gpt-4': {
    input: 30.00, // $30.00 per 1M input tokens
    output: 60.00 // $60.00 per 1M output tokens
  },
  'gpt-3.5-turbo': {
    input: 0.50,  // $0.50 per 1M input tokens
    output: 1.50  // $1.50 per 1M output tokens
  }
};

// Simple token estimation (rough approximation)
function estimateTokens(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // This is a simplified approach - for production, use tiktoken library
  return Math.ceil(text.length / 4);
}

// Calculate cost based on model and token usage
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = TOKEN_PRICING[model as keyof typeof TOKEN_PRICING];
  if (!pricing) {
    console.warn(`Unknown model pricing for ${model}, using gpt-4o-mini pricing`);
    const defaultPricing = TOKEN_PRICING['gpt-4o-mini'];
    return (inputTokens / 1000000) * defaultPricing.input + (outputTokens / 1000000) * defaultPricing.output;
  }
  
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  return inputCost + outputCost;
}

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
    const { 
      user_id, 
      phone_number, 
      assistant_id, 
      thread_id, 
      model, 
      input_text, 
      output_text, 
      action,
      metadata = {} 
    } = await req.json();

    // Validate required fields
    if (!assistant_id || !model) {
      return new Response(JSON.stringify({
        error: 'assistant_id and model are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Calculate token usage
    const inputTokens = input_text ? estimateTokens(input_text) : 0;
    const outputTokens = output_text ? estimateTokens(output_text) : 0;
    const totalTokens = inputTokens + outputTokens;
    const costUsd = calculateCost(model, inputTokens, outputTokens);

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Insert usage record
    const { data: usageData, error: usageError } = await supabase
      .from('ai_usage')
      .insert({
        user_id: user_id || null,
        phone_number: phone_number || null,
        assistant_id,
        thread_id: thread_id || null,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        action: action || null,
        metadata: {
          ...metadata,
          input_text_length: input_text?.length || 0,
          output_text_length: output_text?.length || 0,
          calculated_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (usageError) {
      console.error('Error inserting AI usage:', usageError);
      return new Response(JSON.stringify({
        error: 'Failed to record AI usage',
        details: usageError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Return usage data
    return new Response(JSON.stringify({
      success: true,
      usage_id: usageData.id,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cost_usd: costUsd,
      model: model,
      pricing: TOKEN_PRICING[model as keyof typeof TOKEN_PRICING] || TOKEN_PRICING['gpt-4o-mini']
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Token Usage Calculation Error:', error);
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
