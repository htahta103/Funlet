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
    // Parse webhook payload
    const payload = await req.json();
    console.log('Webhook payload:', JSON.stringify(payload, null, 2));

    // Extract user data from Supabase webhook
    const { type, record, old_record } = payload;
    
    // Only process user creation events
    if (type !== 'INSERT' || !record) {
      return new Response(JSON.stringify({
        message: 'Not a user creation event, skipping'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const user_id = record.id;
    const user_email = record.email;
    const user_metadata = record.user_metadata || {};
    
    // Extract phone number and name from user metadata
    const phone_number = user_metadata.phone_number || user_metadata.phone;
    const first_name = user_metadata.first_name || user_metadata.name || 'User';

    if (!phone_number) {
      console.log('No phone number found for user:', user_id);
      return new Response(JSON.stringify({
        message: 'No phone number provided, skipping auto-launch'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Processing auto-launch for user:', user_id, 'phone:', phone_number);

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Normalize phone number
    const normalizedPhone = phone_number.replace(/\D/g, '');

    // 1. Create profile record
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user_id,
        first_name: first_name,
        phone_number: normalizedPhone,
        email: user_email,
        subscription_status: 'free',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (profileError) {
      console.error('Error creating profile:', profileError);
      return new Response(JSON.stringify({
        error: 'Failed to create profile',
        details: profileError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // 2. Create conversation_state record
    const { data: conversationData, error: conversationError } = await supabase
      .from('conversation_state')
      .upsert({
        user_id: user_id,
        phone_number: normalizedPhone,
        current_state: 'onboarding_step_1',
        onboarding_step: 1,
        waiting_for: 'crew_name',
        last_action: 'ONBOARDING_START',
        last_action_timestamp: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (conversationError) {
      console.error('Error creating conversation state:', conversationError);
    }

    // 3. Send welcome SMS
    const welcomeMessage = `Welcome to Funlet! 🎉 I'm your AI assistant for organizing group events. What should we call your first crew?`;
    
    try {
      const Twilio = (await import('npm:twilio@4.22.0')).default;
      const twilioClient = new Twilio(
        Deno.env.get('TWILIO_ACCOUNT_SID'),
        Deno.env.get('TWILIO_AUTH_TOKEN')
      );

      const smsResult = await twilioClient.messages.create({
        body: welcomeMessage,
        from: '+18887787794',
        to: `+${normalizedPhone}`,
        shortenUrls: true
      });

      console.log('Welcome SMS sent:', smsResult.sid);

      // Log the SMS interaction
      await supabase
        .from('sms_log')
        .insert({
          phone_number: `+${normalizedPhone}`,
          message_body: welcomeMessage,
          direction: 'outbound',
          user_id: user_id,
          message_type: 'welcome_onboarding',
          intent_classification: {
            action: 'ONBOARDING_START',
            trigger: 'user_signup',
            auto_launched: true
          }
        });

    } catch (smsError) {
      console.error('Failed to send welcome SMS:', smsError);
    }

    // 4. Log user action
    await supabase
      .from('user_actions')
      .insert({
        user_id: user_id,
        action: 'onboarding_start',
        event_id: null,
        metadata: {
          phone_number: `+${normalizedPhone}`,
          trigger: 'user_signup',
          auto_launched: true,
          first_name: first_name
        }
      });

    console.log('Auto-launch onboarding completed for user:', user_id);

    return new Response(JSON.stringify({
      success: true,
      message: 'Auto-launch onboarding completed',
      user_id: user_id,
      phone_number: `+${normalizedPhone}`,
      profile_created: !!profileData,
      conversation_state_created: !!conversationData
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
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
