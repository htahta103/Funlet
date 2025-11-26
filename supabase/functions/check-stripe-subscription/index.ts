import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Allow GET requests for testing (no auth required)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const subscription_id = url.searchParams.get('subscription_id');
    const is_sandbox = url.searchParams.get('is_sandbox') === 'true';
    
    if (!subscription_id) {
      return new Response(JSON.stringify({ 
        error: 'subscription_id is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Get Stripe secret key
      const stripeSecretKey = is_sandbox
        ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
        : Deno.env.get('STRIPE_SECRET_KEY');

      if (!stripeSecretKey) {
        return new Response(JSON.stringify({ 
          error: 'Stripe secret key not found' 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Initialize Stripe
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient()
      });

      // Get subscription from Stripe
      const subscription = await stripe.subscriptions.retrieve(subscription_id);

      return new Response(JSON.stringify({
        success: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at,
          current_period_start: subscription.current_period_start,
          current_period_end: subscription.current_period_end,
          customer: subscription.customer,
          items: subscription.items.data.map(item => ({
            price_id: item.price.id,
            quantity: item.quantity
          })),
          metadata: subscription.metadata
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Error checking Stripe subscription:', error);
      return new Response(JSON.stringify({
        error: 'Failed to retrieve subscription',
        details: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    const { subscription_id, is_sandbox = true } = await req.json();
    
    if (!subscription_id) {
      return new Response(JSON.stringify({ 
        error: 'subscription_id is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get Stripe secret key
    const stripeSecretKey = is_sandbox
      ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
      : Deno.env.get('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      return new Response(JSON.stringify({ 
        error: 'Stripe secret key not found' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient()
    });

    // Get subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscription_id);

    return new Response(JSON.stringify({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        customer: subscription.customer,
        items: subscription.items.data.map(item => ({
          price_id: item.price.id,
          quantity: item.quantity
        })),
        metadata: subscription.metadata
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
console.error('Error checking Stripe subscription:', error);
    return new Response(JSON.stringify({
      error: 'Failed to retrieve subscription',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
