import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature'
      }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
      console.error('Missing required environment variables');
      return new Response(JSON.stringify({
        error: 'Missing required environment variables'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-06-30.basil',
      httpClient: Stripe.createFetchHttpClient()
    });

    // Get the raw body for processing
    const body = await req.text();

    // Parse the event without signature verification
    let event;
    try {
      event = JSON.parse(body);
    } catch (err) {
      console.error('Failed to parse webhook body:', err);
      return new Response(JSON.stringify({
        error: 'Invalid JSON payload'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate that this looks like a Stripe event
    if (!event.id || !event.type || !event.data) {
      console.error('Invalid event structure:', event);
      return new Response(JSON.stringify({
        error: 'Invalid event structure'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    console.log(`Processing webhook event: ${event.type} (ID: ${event.id})`);

    // Handle different event types
    switch(event.type){
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(supabase, event.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(supabase, event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(supabase, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(supabase, event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(supabase, event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({
      received: true,
      event_id: event.id
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});

async function handleCheckoutSessionCompleted(supabase, session) {
  console.log('Processing checkout.session.completed:', session.id);
  
  const userId = session.metadata?.user_id;
  if (!userId) {
    console.error('No user_id in session metadata');
    return;
  }

  try {
    // Get subscription details if this was a subscription checkout
    let subscriptionData = null;
    if (session.subscription) {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
        apiVersion: '2025-06-30.basil',
        httpClient: Stripe.createFetchHttpClient()
      });
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      subscriptionData = subscription;
    }

    // Update or create subscription record
    const { error } = await supabase.from('subscriptions').upsert({
      user_id: userId,
      stripe_subscription_id: session.subscription,
      stripe_customer_id: session.customer,
      stripe_price_id: session.metadata?.price_id || null,
      status: subscriptionData?.status || 'active',
      current_period_start: subscriptionData?.current_period_start ? new Date(subscriptionData.current_period_start * 1000) : null,
      current_period_end: subscriptionData?.current_period_end ? new Date(subscriptionData.current_period_end * 1000) : null,
      trial_start: subscriptionData?.trial_start ? new Date(subscriptionData.trial_start * 1000) : null,
      trial_end: subscriptionData?.trial_end ? new Date(subscriptionData.trial_end * 1000) : null,
      metadata: session.metadata,
      created_at: new Date(),
      updated_at: new Date()
    });

    if (error) {
      console.error('Error updating subscription:', error);
      return;
    }

    // Update user's subscription status in profiles
    const subscriptionStatus = subscriptionData?.status || 'active';
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: subscriptionStatus,
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully processed checkout session ${session.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling checkout session completed:', error);
  }
}

async function handleInvoicePaid(supabase, invoice) {
  console.log('Processing invoice.paid:', invoice.id);
  
  let userId = null;

  // Try to get user_id from invoice metadata first
  if (invoice.metadata?.user_id) {
    userId = invoice.metadata.user_id;
  } else if (invoice.customer) {
    // If not in invoice metadata, get from profiles table using stripe_customer_id
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('stripe_customer_id', invoice.customer).single();
      if (profile) {
        userId = profile.id;
      }
    } catch (error) {
      console.error('Error retrieving profile for customer:', error);
    }
  }

  if (!userId) {
    console.error('No user_id found in invoice metadata or customer lookup');
    return;
  }

  try {
    // Update subscription status to active
    const { error } = await supabase.from('subscriptions').update({
      status: 'active',
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.error('Error updating subscription for invoice:', error);
      return;
    }

    // Update user's subscription status
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: 'active',
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile for invoice:', profileError);
    }

    console.log(`Successfully processed invoice ${invoice.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling invoice paid:', error);
  }
}

async function handleSubscriptionUpdated(supabase, subscription) {
  console.log('Processing customer.subscription.updated:', subscription.id);
  
  let userId = null;

  // Try to get user_id from subscription metadata first
  if (subscription.metadata?.user_id) {
    userId = subscription.metadata.user_id;
  } else if (subscription.customer) {
    // If not in subscription metadata, get from profiles table using stripe_customer_id
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('stripe_customer_id', subscription.customer).single();
      if (profile) {
        userId = profile.id;
      }
    } catch (error) {
      console.error('Error retrieving profile for customer:', error);
    }
  }

  if (!userId) {
    console.error('No user_id found in subscription metadata or customer lookup');
    return;
  }

  try {
    // Update subscription record
    const { error } = await supabase.from('subscriptions').update({
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
      trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating subscription:', error);
      return;
    }

    // Update user's subscription status
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: subscription.status,
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully updated subscription ${subscription.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(supabase, subscription) {
  console.log('Processing customer.subscription.deleted:', subscription.id);
  
  let userId = null;

  // Try to get user_id from subscription metadata first
  if (subscription.metadata?.user_id) {
    userId = subscription.metadata.user_id;
  } else if (subscription.customer) {
    // If not in subscription metadata, get from profiles table using stripe_customer_id
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('stripe_customer_id', subscription.customer).single();
      if (profile) {
        userId = profile.id;
      }
    } catch (error) {
      console.error('Error retrieving profile for customer:', error);
    }
  }

  if (!userId) {
    console.error('No user_id found in subscription metadata or customer lookup');
    return;
  }

  try {
    // Update subscription status to canceled
    const { error } = await supabase.from('subscriptions').update({
      status: 'canceled',
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating subscription:', error);
      return;
    }

    // Update user's subscription status
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: 'canceled',
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully canceled subscription ${subscription.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

async function handleInvoicePaymentFailed(supabase, invoice) {
  console.log('Processing invoice.payment_failed:', invoice.id);
  
  let userId = null;

  // Try to get user_id from invoice metadata first
  if (invoice.metadata?.user_id) {
    userId = invoice.metadata.user_id;
  } else if (invoice.customer) {
    // If not in invoice metadata, get from profiles table using stripe_customer_id
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('stripe_customer_id', invoice.customer).single();
      if (profile) {
        userId = profile.id;
      }
    } catch (error) {
      console.error('Error retrieving profile for customer:', error);
    }
  }

  if (!userId) {
    console.error('No user_id found in invoice metadata or customer lookup');
    return;
  }

  try {
    // Update subscription status to past_due
    const { error } = await supabase.from('subscriptions').update({
      status: 'past_due',
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.error('Error updating subscription for failed payment:', error);
      return;
    }

    // Update user's subscription status
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: 'past_due',
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile for failed payment:', profileError);
    }

    console.log(`Successfully processed failed payment for invoice ${invoice.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
  }
}
