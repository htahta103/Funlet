import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing required environment variables');
      return new Response(JSON.stringify({
        error: 'Missing required environment variables'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('Starting daily billing cycle reset check...');

    // Get today's date
    const today = new Date();
    
    // Find users whose billing cycle was at least 28 days ago (handles month variations)
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);

    const { data: profiles, error: selectError } = await supabase
      .from('profiles')
      .select('id, billing_cycle_start, subscription_tier, subscription_status')
      .or(`billing_cycle_start.is.null,billing_cycle_start.lte.${twentyEightDaysAgo.toISOString()}`);

    if (selectError) {
      console.error('Error fetching profiles:', selectError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch profiles',
        details: selectError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Checking ${profiles?.length || 0} profiles for billing cycle resets`);

    // Filter to only reset users where:
    // 1. Free tier users (always reset via cron)
    // 2. Paid users with inactive/past_due status (webhook might have failed)
    const usersToReset = profiles?.filter(profile => {
      if (!profile.billing_cycle_start) {
        console.log(`User ${profile.id}: No billing_cycle_start, will reset`);
        return true; // Reset if never set
      }
      
      const billingDate = new Date(profile.billing_cycle_start);
      const daysSince = Math.floor((today.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Reset if it's been at least 28 days (handles month variations)
      if (daysSince < 28) {
        return false;
      }
      
      // Always reset free tier
      if (profile.subscription_tier === 'free') {
        console.log(`User ${profile.id}: Free tier, ${daysSince} days since last reset, will reset`);
        return true;
      }
      
      // For paid users, check if they're truly inactive
      // Don't reset if they have paid tier (even if status='canceled' during grace period)
      if (profile.subscription_tier !== 'free' && profile.subscription_status === 'canceled') {
        // User canceled but still has paid tier = grace period, skip reset
        console.log(`User ${profile.id}: Canceled but still on paid tier (grace period), skipping reset`);
        return false;
      }

      if (profile.subscription_tier === 'free' && profile.subscription_status !== 'active') {
        // Free tier with non-active status, reset as backup
        console.log(`User ${profile.id}: Free tier with status=${profile.subscription_status}, ${daysSince} days since last reset, will reset as backup`);
        return true;
      }

      // For other paid users with non-active status, reset as backup
      if (profile.subscription_status !== 'active') {
        console.log(`User ${profile.id}: Paid tier but status=${profile.subscription_status}, ${daysSince} days since last reset, will reset as backup`);
        return true;
      }
      
      // Skip paid active users (handled by Stripe webhooks)
      console.log(`User ${profile.id}: Paid active user, skipping (handled by Stripe webhook)`);
      return false;
    }) || [];

    console.log(`Found ${usersToReset.length} users to reset`);

    // Reset usage for each filtered profile
    const resetResults = [];
    for (const profile of usersToReset) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          ai_messages_used: 0,
          sms_sent_count: 0,
          events_created: 0,
          billing_cycle_start: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (updateError) {
        console.error(`Error resetting usage for user ${profile.id}:`, updateError);
        resetResults.push({
          user_id: profile.id,
          success: false,
          error: updateError.message
        });
      } else {
        console.log(`✅ Reset usage for user ${profile.id} (tier: ${profile.subscription_tier}, status: ${profile.subscription_status})`);
        resetResults.push({
          user_id: profile.id,
          success: true,
          tier: profile.subscription_tier,
          status: profile.subscription_status
        });
      }
    }

    const successCount = resetResults.filter(r => r.success).length;
    const failureCount = resetResults.filter(r => !r.success).length;

    console.log(`Daily billing cycle reset complete: ${successCount} succeeded, ${failureCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Daily billing cycle reset completed',
      total_checked: profiles?.length || 0,
      total_reset: usersToReset.length,
      succeeded: successCount,
      failed: failureCount,
      results: resetResults
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Monthly usage reset error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

