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
    const { user_id, phone_number, first_name, email } = await req.json();

    // Validate required fields
    if (!user_id || !phone_number) {
      return new Response(JSON.stringify({
        error: 'user_id and phone_number are required'
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

    // Normalize phone number - handle phone numbers without +1 prefix
    let normalizedPhone = phone_number.replace(/\D/g, '');
    
    // If it's a 10-digit US number, add +1
    if (normalizedPhone.length === 10) {
      normalizedPhone = `+1${normalizedPhone}`;
    } else if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      // If it's 11 digits starting with 1, just add +
      normalizedPhone = `+${normalizedPhone}`;
    } else if (normalizedPhone.length > 0) {
      // For any other length, add + if not already present
      if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = `+${normalizedPhone}`;
      }
    }
    
    console.log('Processing signup for user:', user_id, 'original phone:', phone_number, 'normalized phone:', normalizedPhone);

    // 1. Create or update profile record
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user_id,
        first_name: first_name || 'User',
        phone_number: normalizedPhone,
        email: email,
        subscription_status: 'trial',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (profileError) {
      console.error('Error creating/updating profile:', profileError);
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

    console.log('Profile created/updated:', profileData.id);

    // 2. Create or update conversation_state record for onboarding
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (conversationError) {
      console.error('Error creating conversation state:', conversationError);
      return new Response(JSON.stringify({
        error: 'Failed to create conversation state',
        details: conversationError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Conversation state created:', conversationData.id);

    // 3. Send welcome SMS
    const welcomeMessage = `Welcome to Funlet! 🎉 I'm your AI assistant for organizing group events. What should we call your first crew?`;
    
    try {
      // Use the same Twilio configuration as send-invitations
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
      const TWILIO_PHONE_NUMBER = '+18887787794';
      
      console.log('Twilio credentials check:', {
        hasAccountSid: !!TWILIO_ACCOUNT_SID,
        hasAuthToken: !!TWILIO_AUTH_TOKEN,
        phoneNumber: TWILIO_PHONE_NUMBER
      });

      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio credentials not configured');
      }

      const Twilio = (await import('npm:twilio@4.22.0')).default;
      const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

      console.log('Sending SMS to:', `+${normalizedPhone}`);
      console.log('SMS message:', welcomeMessage);

      const smsResult = await twilioClient.messages.create({
        body: welcomeMessage,
        from: TWILIO_PHONE_NUMBER,
        to: `+${normalizedPhone}`,
        shortenUrls: true
      });

      console.log('Welcome SMS sent successfully:', smsResult.sid);

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
      console.error('SMS Error details:', {
        message: smsError.message,
        code: smsError.code,
        status: smsError.status
      });
      // Don't fail the entire process if SMS fails
    }

    // 4. Log user action for onboarding start
    await supabase
      .from('user_actions')
      .insert({
        user_id: user_id,
        action: 'onboarding_start',
        event_id: null,
        metadata: {
          phone_number: normalizedPhone,
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
      phone_number: normalizedPhone,
      profile_created: !!profileData,
      conversation_state_created: !!conversationData,
      welcome_sms_sent: true,
      onboarding_step: 1
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Auto-launch onboarding error:', error);
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
