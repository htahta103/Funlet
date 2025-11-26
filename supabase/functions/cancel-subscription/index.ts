import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Parse request body first to check for sandbox mode
    const { user_id, is_sandbox = false } = await req.json();
    
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = is_sandbox
      ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
      : Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(JSON.stringify({ 
        error: 'Missing required environment variables' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!stripeSecretKey) {
      console.error('Missing Stripe secret key');
      return new Response(JSON.stringify({ 
        error: 'Stripe configuration missing' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate input
    if (!user_id) {
      return new Response(JSON.stringify({ 
        error: 'user_id is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Check if user exists
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier')
      .eq('id', user_id)
      .single();

    if (profileError || !userProfile) {
      console.error('User not found:', profileError);
      return new Response(JSON.stringify({ 
        error: 'User not found' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get active subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('id, stripe_subscription_id, stripe_customer_id, status, current_period_end')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single();

    if (subError || !subscription) {
      console.error('No active subscription found:', subError);
      return new Response(JSON.stringify({ 
        error: 'No active subscription found for this user' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if subscription has a Stripe ID (not a free tier subscription)
    if (!subscription.stripe_subscription_id) {
      return new Response(JSON.stringify({ 
        error: 'No Stripe subscription found. User may be on free tier or subscription was not created via Stripe.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if already canceled
    if (subscription.status === 'canceled') {
      return new Response(JSON.stringify({ 
        error: 'Subscription is already canceled',
        subscription_id: subscription.stripe_subscription_id
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient()
    });

    // Cancel subscription via Stripe (at period end - keep access until then)
    let canceledSubscription;
    try {
      canceledSubscription = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        {
          cancel_at_period_end: true
        }
      );
    } catch (stripeError) {
      console.error('Stripe cancellation error:', stripeError);
      return new Response(JSON.stringify({ 
        error: 'Failed to cancel subscription with Stripe',
        details: stripeError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Database updates will be handled by Stripe webhook when it receives the event
    console.log('✅ Stripe API call successful, webhook will handle database updates');

    console.log('✅ Subscription cancellation scheduled successfully:', {
      user_id,
      subscription_id: subscription.stripe_subscription_id,
      cancel_at: canceledSubscription.cancel_at,
      current_period_end: canceledSubscription.current_period_end
    });

    // Return success response
    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription cancellation scheduled successfully',
      subscription_id: subscription.stripe_subscription_id,
      cancel_at: canceledSubscription.cancel_at ? new Date(canceledSubscription.cancel_at * 1000).toISOString() : null,
      current_period_end: new Date(canceledSubscription.current_period_end * 1000).toISOString(),
      access_until: new Date(canceledSubscription.current_period_end * 1000).toISOString(),
      current_tier: userProfile.subscription_tier,
      status: 'scheduled_for_cancellation'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Subscription cancellation error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to cancel subscription',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

