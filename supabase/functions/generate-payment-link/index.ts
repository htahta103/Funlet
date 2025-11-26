import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Stripe price IDs mapping
const PRICE_IDS = {
  production: {
    standard: 'price_1SKJv7FkQpmG5zYQLK6DQhhH',
    pro: 'price_1SKJwHFkQpmG5zYQp21Lmlh3',
    enterprise: 'price_1SKJxLFkQpmG5zYQpn8MJ2V4'
  },
  sandbox: {
    standard: 'price_1SKlIHFiNXEZooPvmpnsZT6y',
    pro: 'price_1SKlJlFiNXEZooPvAysinU4a',
    enterprise: 'price_1SKlKcFiNXEZooPvWQfWXPfQ'
  }
};

const PLAN_PRICES = {
  standard: '$6.99/month',
  pro: '$16.99/month',
  enterprise: '$39.99/month'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Parse request body first to get is_sandbox
    const { user_id, plan, environment = 'production', is_sandbox = false } = await req.json();
    
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
    if (!user_id || typeof user_id !== 'string' || user_id.trim() === '') {
      console.error('Invalid user_id provided:', user_id);
      return new Response(JSON.stringify({ 
        error: 'Valid user_id is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!plan || !['standard', 'pro', 'enterprise'].includes(plan)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid plan. Must be standard, pro, or enterprise' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!['editor', 'production'].includes(environment)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid environment. Must be editor or production' 
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

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, phone_number, stripe_customer_id')
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

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient()
    });

    // Get price ID for the selected plan
    const envType = is_sandbox ? 'sandbox' : 'production';
    const priceId = PRICE_IDS[envType][plan as keyof typeof PRICE_IDS['production']];

    // Configure URLs based on environment
    const URL_CONFIG = {
      editor: {
        success: 'https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/3ef91c14-e743-4091-b2d5-e3a871fa08cb?session_id={CHECKOUT_SESSION_ID}',
        cancel: 'https://editor.weweb.io/c5443708-06df-4852-bea4-33a82c04ee60/14e07d42-fd50-4a51-8b85-8eed0cd89053'
      },
      production: {
        success: 'https://www.funlet.ai/payment-success?session_id={CHECKOUT_SESSION_ID}',
        cancel: 'https://www.funlet.ai/payment-error'
      }
    };

    const urls = URL_CONFIG[environment as keyof typeof URL_CONFIG];

    // Cancel any existing active Stripe subscriptions for this customer
    if (userProfile.stripe_customer_id) {
      try {
        console.log(`🔍 Checking for existing subscriptions for customer: ${userProfile.stripe_customer_id}`);
        
        // List all active subscriptions for this customer
        const existingSubscriptions = await stripe.subscriptions.list({
          customer: userProfile.stripe_customer_id,
          status: 'active',
          limit: 10
        });

        if (existingSubscriptions.data.length > 0) {
          console.log(`⚠️ Found ${existingSubscriptions.data.length} active subscriptions, canceling them...`);
          
          // Cancel all existing active subscriptions
          for (const subscription of existingSubscriptions.data) {
            try {
              await stripe.subscriptions.cancel(subscription.id);
              console.log(`✅ Canceled existing subscription: ${subscription.id}`);
            } catch (cancelError) {
              console.error(`❌ Error canceling subscription ${subscription.id}:`, cancelError);
            }
          }
        } else {
          console.log(`✅ No active subscriptions found for customer: ${userProfile.stripe_customer_id}`);
        }
      } catch (error) {
        console.error('❌ Error checking/canceling existing subscriptions:', error);
        // Continue with checkout creation even if cancellation fails
      }
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      customer: userProfile.stripe_customer_id || undefined,
      customer_email: !userProfile.stripe_customer_id ? userProfile.email : undefined,
      client_reference_id: user_id,
      metadata: {
        user_id: user_id,
        price_id: priceId,
        plan: plan,
        environment: environment,
        is_sandbox: is_sandbox.toString()
      },
      success_url: urls.success,
      cancel_url: urls.cancel,
      allow_promotion_codes: true,
      billing_address_collection: 'required'
    });

    console.log('✅ Payment link generated:', {
      user_id,
      plan,
      environment,
      is_sandbox,
      session_id: session.id,
      checkout_url: session.url,
      metadata: {
        user_id: user_id,
        price_id: priceId,
        plan: plan,
        environment: environment,
        is_sandbox: is_sandbox.toString()
      }
    });

    // Return success response
    return new Response(JSON.stringify({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
      plan: plan,
      price: PLAN_PRICES[plan as keyof typeof PLAN_PRICES],
      environment: environment
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Payment link generation error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate payment link',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

