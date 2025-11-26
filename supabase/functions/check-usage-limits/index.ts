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
    const { phone_number, action_type = 'ai_interaction' } = await req.json();

    // Validate input
    if (!phone_number) {
      return new Response(JSON.stringify({
        error: 'Phone number is required'
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

    // Call the database function to check usage limits
    const { data, error } = await supabase.rpc('check_usage_limits', {
      user_phone: phone_number,
      action_type: action_type
    });

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({
        error: 'Failed to check usage limits',
        details: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // If no profile/subscription, allow by default per business rule
    const noProfileOrPlan = !data || data.error === 'User not found' || !data.plan;

    // Generate upgrade message if limit exceeded
    let upgradeMessage = '';
    if (!noProfileOrPlan && !data.allowed && data.limit_exceeded) {
      const planNames = {
        'free': 'Free',
        'standard': 'Standard',
        'pro': 'Pro',
        'enterprise': 'Enterprise'
      };
      
      const nextTier = {
        'free': 'Standard ($6.99/month)',
        'standard': 'Pro ($16.99/month)',
        'pro': 'Enterprise ($39.99/month)',
        'enterprise': 'Custom Plan'
      };

      const limitMessages = {
        'ai_interaction': `You've been organizing a lot this month! Upgrade for more fun: funlet.ai/upgrade`,
        'sms_sent': `You're really making the most of Funlet! Upgrade for more fun: funlet.ai/upgrade`,
        'create_event': `You've created ${data.usage.events_created} events this month! Upgrade for more events: funlet.ai/upgrade`
      };

      upgradeMessage = limitMessages[data.limit_exceeded] || `Upgrade to ${nextTier[data.plan]} for more coordination: funlet.ai/upgrade`;
    }

    // Return the usage check result (override to allowed when no profile/plan)
    return new Response(JSON.stringify({
      allowed: noProfileOrPlan ? true : data.allowed,
      plan: data.plan ?? null,
      limits: data.limits ?? null,
      usage: data.usage ?? null,
      limit_exceeded: noProfileOrPlan ? null : (data.limit_exceeded || null),
      upgrade_message: noProfileOrPlan ? '' : upgradeMessage
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Usage check error:', error);
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
