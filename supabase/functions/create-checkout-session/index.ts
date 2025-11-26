import Stripe from "npm:stripe@14.4.0";
import { createClient } from "npm:@supabase/supabase-js";

// CORS configuration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

// Initialize Supabase client (optional, for future use)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

// Handle OPTIONS preflight request
const handleOptions = () => {
  return new Response(null, {
    headers: CORS_HEADERS,
    status: 204
  });
};

// Main handler for creating checkout session
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    // Parse request body first to check for sandbox mode
    const { userId, userEmail, priceId, successUrl, cancelUrl, is_sandbox = false } = await req.json();
    
    const stripeSecretKey = is_sandbox
      ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
      : Deno.env.get('STRIPE_SECRET_KEY');

    // Validate Stripe secret key
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }

    // Initialize Stripe with secret key
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16'
    });


    // Validate required fields
    if (!userId || !userEmail || !priceId || !successUrl || !cancelUrl) {
      return new Response(JSON.stringify({
        error: 'Missing required fields'
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: [
        'card'
      ],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      customer_email: userEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId,
        origin: 'supabase_pro_upgrade'
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          origin: 'supabase_pro_upgrade'
        }
      }
    });

    // Return checkout session URL
    return new Response(JSON.stringify({
      url: session.url
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Checkout session creation error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to create checkout session',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
});
