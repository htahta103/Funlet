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

  // Add proper error handling to prevent event loop issues
  try {
    // Parse request body to check for sandbox mode
    const body = await req.text();
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

    // Check for sandbox mode from event metadata or URL params
    const url = new URL(req.url);
    const is_sandbox = url.searchParams.get('sandbox') === 'true' || 
                      event?.data?.object?.metadata?.sandbox === 'true' || false;
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = is_sandbox
      ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
      : Deno.env.get('STRIPE_SECRET_KEY');

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
    console.log('🔍 Event data:', event.data);
    // Handle different event types
    switch(event.type){
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(supabase, event.data.object);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(supabase, event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(supabase, event.data.object, stripe);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(supabase, event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(supabase, event.data.object);
      break;
    case 'customer.subscription.created':
      await handleSubscriptionCreated(supabase, event.data.object, stripe);
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

// Note: Removed global error handlers to prevent Deno event loop issues

// Helper function to map Stripe price IDs to subscription tiers
function getPlanTierFromPriceId(priceId: string): string {
  const priceTierMap = {
    // Production price IDs
    'price_1SKJv7FkQpmG5zYQLK6DQhhH': 'standard',
    'price_1SKJwHFkQpmG5zYQp21Lmlh3': 'pro',
    'price_1SKJxLFkQpmG5zYQpn8MJ2V4': 'enterprise',
    // Sandbox price IDs
    'price_1SKlIHFiNXEZooPvmpnsZT6y': 'standard',
    'price_1SKlJlFiNXEZooPvAysinU4a': 'pro',
    'price_1SKlKcFiNXEZooPvWQfWXPfQ': 'enterprise'
  };
  return priceTierMap[priceId] || 'free';
}

// Helper function to map Stripe subscription status to valid database status
function mapStripeStatusToDbStatus(stripeStatus: string): string {
  const statusMap = {
    'active': 'active',
    'canceled': 'canceled',
    'incomplete': 'inactive', // Map incomplete to inactive
    'incomplete_expired': 'canceled',
    'past_due': 'inactive',
    'unpaid': 'inactive',
    'trialing': 'trial'
  };
  
  return statusMap[stripeStatus] || 'inactive';
}

async function handleCheckoutSessionCompleted(supabase, session) {
  console.log('Processing checkout.session.completed:', session.id);
  
  // Log all session data for debugging
  console.log('🔍 Full session data:', {
    id: session.id,
    customer: session.customer,
    client_reference_id: session.client_reference_id,
    customer_details: session.customer_details,
    metadata: session.metadata,
    subscription: session.subscription,
    payment_status: session.payment_status,
    status: session.status
  });
  
  let userId = session.metadata?.user_id;
  
  // If no user_id in metadata, try to look up by customer_id
  if (!userId && session.customer) {
    console.log('🔍 No user_id in session metadata, looking up by customer_id:', session.customer);
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, stripe_customer_id, email')
      .eq('stripe_customer_id', session.customer)
      .single();
    
    if (error) {
      console.error('❌ Error looking up user by customer_id:', error);
    } else if (profile) {
      userId = profile.id;
      console.log('✅ Found user by customer_id:', userId);
    } else {
      console.log('❌ No profile found with customer_id:', session.customer);
    }
  }
  
  // Additional fallback: try client_reference_id
  if (!userId && session.client_reference_id) {
    console.log('🔍 Trying client_reference_id as fallback:', session.client_reference_id);
    userId = session.client_reference_id;
    console.log('✅ Using client_reference_id as user_id:', userId);
  }
  
  // Additional fallback: try customer email
  if (!userId && session.customer_details?.email) {
    console.log('🔍 Trying customer email as fallback:', session.customer_details.email);
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', session.customer_details.email)
      .single();
    
    if (error) {
      console.error('❌ Error looking up user by email:', error);
    } else if (profile) {
      userId = profile.id;
      console.log('✅ Found user by email:', userId);
    } else {
      console.log('❌ No profile found with email:', session.customer_details.email);
    }
  }
  
  if (!userId) {
    console.error('❌ No user_id found after all fallback attempts:', {
      metadata_user_id: session.metadata?.user_id,
      client_reference_id: session.client_reference_id,
      customer: session.customer,
      customer_email: session.customer_details?.email
    });
    return;
  }
  
  console.log('✅ Final user_id determined:', userId);

  try {
    // Get subscription details if this was a subscription checkout
    let subscriptionData = null;
    if (session.subscription) {
      console.log('🔍 Retrieving subscription details for:', session.subscription);
      
      // Determine if this is sandbox mode based on session metadata
      const isSandbox = session.metadata?.is_sandbox === 'true' || session.metadata?.environment === 'editor';
      const stripeSecretKey = isSandbox 
        ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
        : Deno.env.get('STRIPE_SECRET_KEY');
      
      console.log('🔍 Using Stripe key for sandbox mode:', isSandbox);
      
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2025-06-30.basil',
        httpClient: Stripe.createFetchHttpClient()
      });
      
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        subscriptionData = subscription;
        console.log('✅ Subscription retrieved successfully:', {
          id: subscription.id,
          status: subscription.status,
          customer: subscription.customer,
          metadata: subscription.metadata
        });
      } catch (subscriptionError) {
        console.error('❌ Error retrieving subscription:', subscriptionError.message);
        // Continue without subscription data
      }
    } else {
      console.log('ℹ️ No subscription ID found in session');
    }

    // Extract price ID and map to tier
    const priceId = subscriptionData?.items?.data[0]?.price?.id || session.metadata?.price_id;
    const tier = getPlanTierFromPriceId(priceId);
    
    console.log(`Checkout completed: price_id=${priceId}, tier=${tier}`);

    // Skip subscription creation in checkout.session.completed
    // Let customer.subscription.created handle all subscription record creation
    console.log('ℹ️ Skipping subscription record creation in checkout.session.completed');
    console.log('ℹ️ Subscription records will be handled by customer.subscription.created event');

    // Update user's subscription status and tier in profiles, and reset usage counters
    const subscriptionStatus = subscriptionData?.status || 'active';
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_tier: tier,
      subscription_status: subscriptionStatus,
      ai_messages_used: 0,
      sms_sent_count: 0,
      events_created: 0,
      billing_cycle_start: new Date(),
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully processed checkout session ${session.id} for user ${userId} with tier ${tier} and reset usage counters`);
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
    // Get current subscription to determine tier
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('subscription_plan, stripe_price_id')
      .eq('user_id', userId)
      .eq('stripe_subscription_id', invoice.subscription)
      .single();

    const tier = subscription?.subscription_plan || 'free';
    
    console.log(`Invoice paid: invoice_id=${invoice.id}, tier=${tier}`);

    // Update subscription status to active
    const { error } = await supabase.from('subscriptions').update({
      status: 'active',
      is_active: true,
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.error('Error updating subscription for invoice:', error);
      return;
    }

    // Update user's subscription status and tier, and reset usage counters
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_tier: tier,
      subscription_status: 'active',
      ai_messages_used: 0,
      sms_sent_count: 0,
      events_created: 0,
      billing_cycle_start: new Date(),
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile for invoice:', profileError);
    }

    console.log(`Successfully processed invoice ${invoice.id} for user ${userId} with tier ${tier} and reset usage counters`);
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
  } else {
    // Query subscriptions table directly using stripe_subscription_id
    try {
      const { data: subscriptionRecord } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_subscription_id', subscription.id)
        .single();
      
      if (subscriptionRecord) {
        userId = subscriptionRecord.user_id;
        console.log(`Found user_id ${userId} for subscription ${subscription.id}`);
      }
    } catch (error) {
      console.error('Error retrieving subscription record:', error);
    }
  }

  if (!userId) {
    console.error('No user_id found in subscription metadata or subscription table lookup');
    return;
  }

  try {
    // Check if subscription is scheduled for cancellation
    if (subscription.cancel_at_period_end) {
      console.log(`Subscription ${subscription.id} scheduled for cancellation, keeping current tier until period end`);
      
      // Keep current tier but mark as canceling
      const { error } = await supabase.from('subscriptions').update({
        status: 'canceling',
        is_active: true,
        current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : null,
        current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
        trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        updated_at: new Date()
      }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

      if (error) {
        console.error('Error updating subscription for cancellation:', error);
        return;
      }
      
      await supabase.from('profiles').update({
        subscription_status: 'canceled',
        updated_at: new Date()
      }).eq('id', userId);
      
      console.log(`Successfully scheduled subscription ${subscription.id} for cancellation, user ${userId} keeps access until period end`);
      return;
    }

    // Extract price ID and map to tier
    const priceId = subscription.items?.data[0]?.price?.id;
    const tier = getPlanTierFromPriceId(priceId);
    
    console.log(`Subscription updated: subscription_id=${subscription.id}, price_id=${priceId}, tier=${tier}`);

    // Update subscription record
    const { error } = await supabase.from('subscriptions').update({
      stripe_price_id: priceId || null,
      subscription_plan: tier,
      status: subscription.status,
      is_active: subscription.status === 'active',
      current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : null,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
      trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating subscription:', error);
      return;
    }

    // Update user's subscription status and tier
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_tier: tier,
      subscription_status: mapStripeStatusToDbStatus(subscription.status),
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully updated subscription ${subscription.id} for user ${userId} to tier ${tier}`);
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
    // Check if subscription period has ended
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const now = new Date();

    if (now < periodEnd) {
      // Period hasn't ended yet, keep current tier
      console.log(`Subscription ${subscription.id} deleted before period end, keeping tier until ${periodEnd}`);
      
      const { error } = await supabase.from('subscriptions').update({
        status: 'canceling',
        is_active: true,
        updated_at: new Date()
      }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

      if (error) {
        console.error('Error updating subscription for early cancellation:', error);
        return;
      }
      
      await supabase.from('profiles').update({
        subscription_status: 'canceled',
        updated_at: new Date()
      }).eq('id', userId);
      
      console.log(`Successfully handled early cancellation for subscription ${subscription.id}, user ${userId} keeps access until period end`);
      return;
    }

    // Period has ended, downgrade to free
    console.log(`Subscription ${subscription.id} period ended, downgrading to free tier`);

    // Update subscription status to canceled and downgrade to free
    const { error } = await supabase.from('subscriptions').update({
      subscription_plan: 'free',
      status: 'canceled',
      is_active: false,
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating subscription:', error);
      return;
    }

    // Downgrade user to free tier in profiles
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_tier: 'free',
      subscription_status: 'active', // Set to active when period ends
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile:', profileError);
    }

    console.log(`Successfully canceled subscription ${subscription.id} and downgraded user ${userId} to free tier`);
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

async function handleSubscriptionCreated(supabase, subscription, stripe) {
  console.log('Processing customer.subscription.created:', subscription.id);
  
  // Add detailed logging for debugging
  console.log('🔍 Subscription object received:', {
    id: subscription.id,
    status: subscription.status,
    customer: subscription.customer,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    metadata: subscription.metadata
  });

  console.log('🔍 Status mapping:', {
    stripe_status: subscription.status,
    mapped_status: mapStripeStatusToDbStatus(subscription.status),
    is_active: subscription.status === 'active'
  });
  
  // Try to get user_id from subscription metadata
  let userId = subscription.metadata?.user_id;
  
  // If no user_id in metadata, try to get customer details from Stripe
  if (!userId && subscription.customer) {
    console.log('🔍 No user_id in subscription metadata, getting customer details from Stripe:', subscription.customer);
    
    try {
      const customer = await stripe.customers.retrieve(subscription.customer);
      const customerEmail = customer.email;
      
      if (customerEmail) {
        console.log('🔍 Found customer email from Stripe:', customerEmail);
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('email', customerEmail)
          .single();
        
        if (error) {
          console.error('❌ Error looking up user by email:', error);
        } else if (profile) {
          userId = profile.id;
          console.log('✅ Found user by email:', userId);
        } else {
          console.log('❌ No profile found with email:', customerEmail);
        }
      }
    } catch (error) {
      console.error('❌ Error retrieving customer from Stripe:', error);
    }
  }
  
  if (!userId) {
    console.error('❌ No user_id found for subscription.created event');
    return;
  }
  
  // Extract price ID and map to tier
  const priceId = subscription.items?.data[0]?.price?.id;
  const tier = getPlanTierFromPriceId(priceId);
  
  // Extract period dates from subscription items (more reliable than subscription object)
  const periodStart = subscription.items?.data[0]?.current_period_start || subscription.current_period_start;
  const periodEnd = subscription.items?.data[0]?.current_period_end || subscription.current_period_end;
  
  // Convert Unix timestamps to Date objects for database storage
  const periodStartDate = periodStart ? new Date(periodStart * 1000) : null;
  const periodEndDate = periodEnd ? new Date(periodEnd * 1000) : null;
  
  console.log(`✅ Subscription created: subscription_id=${subscription.id}, tier=${tier}`);
  
  // Check if user has any other active subscriptions and deactivate them
  const { data: oldSubscriptions } = await supabase
    .from('subscriptions')
    .select('id, stripe_subscription_id, status')
    .eq('user_id', userId)
    .eq('is_active', true)
    .neq('stripe_subscription_id', subscription.id);

  if (oldSubscriptions && oldSubscriptions.length > 0) {
    console.log(`Found ${oldSubscriptions.length} old active subscriptions for user ${userId}, deactivating them`);
    
    // Deactivate all old subscriptions in parallel to avoid event loop issues
    const deactivationPromises = oldSubscriptions.map(async (oldSub) => {
      const { error } = await supabase.from('subscriptions').update({
        status: 'canceled',
        is_active: false,
        updated_at: new Date()
      }).eq('id', oldSub.id);
      
      if (error) {
        console.error(`Error deactivating subscription ${oldSub.stripe_subscription_id}:`, error);
      } else {
        console.log(`Deactivated old subscription ${oldSub.stripe_subscription_id} (was ${oldSub.status})`);
      }
    });
    
    await Promise.all(deactivationPromises);
  }
  
  // Check if subscription already exists
  const { data: existingSubscription, error: checkError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  let subscriptionError = null;

  if (existingSubscription) {
    console.log('ℹ️ Subscription already exists, updating instead of creating');
    
    // Log what we're about to update
    const updateData = {
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_price_id: priceId || null,
      subscription_plan: tier,
      status: mapStripeStatusToDbStatus(subscription.status),
      is_active: subscription.status === 'active',
      current_period_start: periodStartDate,
      current_period_end: periodEndDate,
      trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      updated_at: new Date()
    };
    
    console.log('🔍 Updating subscription with data:', updateData);
    
    // Update existing subscription
    const { error } = await supabase.from('subscriptions').update(updateData).eq('stripe_subscription_id', subscription.id);
    
    subscriptionError = error;
  } else {
    console.log('ℹ️ Creating new subscription record');
    
    // Log what we're about to insert
    const insertData = {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      stripe_price_id: priceId || null,
      subscription_plan: tier,
      status: mapStripeStatusToDbStatus(subscription.status),
      is_active: subscription.status === 'active',
      current_period_start: periodStartDate,
      current_period_end: periodEndDate,
      trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    console.log('🔍 Creating subscription with data:', insertData);
    
    // Create new subscription record
    const { error } = await supabase.from('subscriptions').insert(insertData);
    
    subscriptionError = error;
  }
  
  if (subscriptionError) {
    console.error('❌ Error with subscription record:', subscriptionError);
    return;
  }
  
  // If subscription was created as incomplete, check if it's now active in Stripe
  if (subscription.status === 'incomplete') {
    console.log('🔍 Subscription created as incomplete, checking if it became active in Stripe...');
    
    try {
      // Retrieve the subscription from Stripe to get current status
      const currentSubscription = await stripe.subscriptions.retrieve(subscription.id);
      
      if (currentSubscription.status === 'active' && subscription.status !== 'active') {
        console.log(`🔄 Subscription ${subscription.id} is now active in Stripe, updating database...`);
        
        // Update the subscription to active status
        const currentPeriodStart = currentSubscription.items?.data[0]?.current_period_start || currentSubscription.current_period_start;
        const currentPeriodEnd = currentSubscription.items?.data[0]?.current_period_end || currentSubscription.current_period_end;
        
        const { error: updateError } = await supabase.from('subscriptions').update({
          status: 'active',
          is_active: true,
          current_period_start: currentPeriodStart ? new Date(currentPeriodStart * 1000) : null,
          current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
          updated_at: new Date()
        }).eq('stripe_subscription_id', subscription.id);
        
        if (updateError) {
          console.error('❌ Error updating subscription to active:', updateError);
        } else {
          console.log(`✅ Successfully updated subscription ${subscription.id} to active status`);
        }
      }
    } catch (stripeError) {
      console.error('❌ Error checking subscription status in Stripe:', stripeError);
    }
  }
  
  // Update profile with subscription info
  const { error: profileError } = await supabase.from('profiles').update({
    subscription_tier: tier,
    subscription_status: mapStripeStatusToDbStatus(subscription.status),
    stripe_customer_id: subscription.customer,
    updated_at: new Date()
  }).eq('id', userId);
  
  if (profileError) {
    console.error('❌ Error updating profile:', profileError);
  } else {
    console.log(`✅ Successfully processed subscription.created for user ${userId} with tier ${tier}`);
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
    console.log(`Invoice payment failed: invoice_id=${invoice.id}, marking past_due but keeping tier`);

    // Update subscription status to past_due and mark inactive
    const { error } = await supabase.from('subscriptions').update({
      status: 'past_due',
      is_active: false,
      updated_at: new Date()
    }).eq('user_id', userId).eq('stripe_subscription_id', invoice.subscription);

    if (error) {
      console.error('Error updating subscription for failed payment:', error);
      return;
    }

    // Update user's subscription status (keep current tier for grace period)
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_status: 'past_due',
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('Error updating profile for failed payment:', profileError);
    }

    console.log(`Successfully processed failed payment for invoice ${invoice.id} for user ${userId} - tier maintained for grace period`);
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
  }
}

async function handleInvoicePaymentSucceeded(supabase, invoice, stripe) {
  console.log('Processing invoice.payment_succeeded:', invoice.id);
  
  let userId = null;
  let subscriptionData = null;
  
  // Step 1: Try invoice metadata (unlikely to have user_id)
  userId = invoice.metadata?.user_id;
  console.log('🔍 Invoice metadata user_id:', userId);
  
  // Step 2: Retrieve subscription from Stripe to get metadata
  if (!userId && invoice.subscription) {
    console.log('🔍 Retrieving subscription for user_id:', invoice.subscription);
    
    try {
      subscriptionData = await stripe.subscriptions.retrieve(invoice.subscription);
      userId = subscriptionData.metadata?.user_id;
      console.log('✅ Found user_id in subscription metadata:', userId);
      console.log('🔍 Subscription metadata:', subscriptionData.metadata);
    } catch (error) {
      console.error('❌ Error retrieving subscription:', error);
    }
  }
  
  // Step 3: Fallback to customer email lookup (more reliable)
  let customerEmail = null;
  
  // Try to get email from subscription customer details
  if (subscriptionData?.customer_details?.email) {
    customerEmail = subscriptionData.customer_details.email;
    console.log('🔍 Found customer email in subscription:', customerEmail);
  }
  // Fallback to invoice customer email
  else if (invoice.customer_email) {
    customerEmail = invoice.customer_email;
    console.log('🔍 Found customer email in invoice:', customerEmail);
  }
  
  if (!userId && customerEmail) {
    console.log('🔍 Looking up user by customer email:', customerEmail);
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', customerEmail)
      .single();
    
    if (error) {
      console.error('❌ Error looking up user by email:', error);
    } else if (profile) {
      userId = profile.id;
      console.log('✅ Found user by email:', userId);
    } else {
      console.log('❌ No profile found with email:', customerEmail);
    }
  }
  
  if (!userId) {
    console.error('❌ No user_id found after all attempts');
    return;
  }
  
  // Debug invoice lines structure
  console.log('🔍 Invoice lines debug:', {
    has_lines: !!invoice.lines,
    lines_data_length: invoice.lines?.data?.length,
    first_line: invoice.lines?.data?.[0],
    price_field: invoice.lines?.data?.[0]?.price,
    pricing_field: invoice.lines?.data?.[0]?.pricing
  });
  
  // Extract price ID and determine tier from invoice lines (more reliable) or subscription data
  const priceId = invoice.lines?.data[0]?.pricing?.price_details?.price || subscriptionData?.items?.data[0]?.price?.id;
  const tier = getPlanTierFromPriceId(priceId);
  
  console.log(`✅ Invoice payment succeeded: user_id=${userId}, tier=${tier}, price_id=${priceId}`);
  
  try {
    // Update profile with tier and reset usage
    const { error: profileError } = await supabase.from('profiles').update({
      subscription_tier: tier,
      subscription_status: 'active',
      stripe_customer_id: invoice.customer, // Ensure customer_id is saved
      ai_messages_used: 0,
      sms_sent_count: 0,
      events_created: 0,
      billing_cycle_start: new Date(),
      updated_at: new Date()
    }).eq('id', userId);

    if (profileError) {
      console.error('❌ Error updating profile:', profileError);
    } else {
      console.log(`✅ Successfully processed invoice payment for user ${userId} with tier ${tier} and reset usage counters`);
    }
  } catch (error) {
    console.error('❌ Error handling invoice payment succeeded:', error);
  }
}
