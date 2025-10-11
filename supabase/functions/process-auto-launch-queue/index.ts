import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get pending auto-launch queue items
    const { data: queueItems, error: queueError } = await supabase
      .from('auto_launch_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10); // Process up to 10 items at a time

    if (queueError) {
      console.error('Error fetching queue items:', queueError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch queue items',
        details: queueError
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending items to process',
        processed_count: 0
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log(`Processing ${queueItems.length} auto-launch queue items`);

    const results = [];

    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('auto_launch_queue')
          .update({ 
            status: 'processing',
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // Call the auto-launch onboarding function
        const autoLaunchResponse = await fetch('https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/auto-launch-onboarding', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            user_id: item.user_id,
            phone_number: item.phone_number,
            first_name: item.first_name,
            email: item.email
          })
        });

        const autoLaunchResult = await autoLaunchResponse.json();

        if (autoLaunchResponse.ok) {
          // Mark as completed
          await supabase
            .from('auto_launch_queue')
            .update({ 
              status: 'completed',
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);

          results.push({
            user_id: item.user_id,
            status: 'success',
            result: autoLaunchResult
          });

          console.log(`Auto-launch completed for user ${item.user_id}`);
        } else {
          // Mark as failed
          await supabase
            .from('auto_launch_queue')
            .update({ 
              status: 'failed',
              error_message: autoLaunchResult.error || 'Unknown error',
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id);

          results.push({
            user_id: item.user_id,
            status: 'failed',
            error: autoLaunchResult
          });

          console.error(`Auto-launch failed for user ${item.user_id}:`, autoLaunchResult);
        }

      } catch (error) {
        console.error(`Error processing user ${item.user_id}:`, error);
        
        // Mark as failed
        await supabase
          .from('auto_launch_queue')
          .update({ 
            status: 'failed',
            error_message: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        results.push({
          user_id: item.user_id,
          status: 'error',
          error: error.message
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${results.length} auto-launch queue items`,
      processed_count: results.length,
      results: results
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Process auto-launch queue error:', error);
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
