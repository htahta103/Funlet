import { createClient } from 'npm:@supabase/supabase-js@2';

// Twilio configuration
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER = '+18887787794';

// CORS headers for WeWeb integration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Phone number formatting utility (same as send-invitations)
const formatPhoneForTwilio = (phoneNumber) => {
  // Remove all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Check for valid phone number lengths
  if (digitsOnly.length === 10) {
    // US/Canada 10-digit number, add +1 country code
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // Number already starts with 1, just add +
    return `+${digitsOnly}`;
  } else if (digitsOnly.length >= 11) {
    // For international numbers, assume the first digits are country code
    // Take the last 10 digits with appropriate country code
    return `+${digitsOnly.slice(0, -10)}${digitsOnly.slice(-10)}`;
  }
  
  // Invalid number format
  console.warn(`Invalid phone number format: ${phoneNumber}`);
  return null;
};

// Send SMS via Twilio (same as send-invitations)
async function sendSMS(to, message) {
  const Twilio = (await import('npm:twilio@4.22.0')).default;
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    const twilioMessage = await twilioClient.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: to
    });
    
    return {
      status: 'sent',
      sid: twilioMessage.sid
    };
  } catch (error) {
    console.error('Twilio SMS sending error:', error);
    return {
      status: 'failed',
      error: error.message
    };
  }
}

// Send email using the send-email function
const sendEmailNotification = async (email, content) => {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        email: email,
        content: content
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to send email:', errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log('Email sent successfully:', result);
    return { success: true, result };
  } catch (error) {
    console.error('Error calling send-email function:', error);
    return { success: false, error: error.message };
  }
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: CORS_HEADERS
    });
  }

  // Ensure it's a POST request
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

  // Create Supabase client
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  );

  try {
    // Parse request body - now accepts message, statuses, event_id
    const { message, statuses, event_id, inviting_user_id } = await req.json();

    // Validate input
    if (!message || !statuses || !event_id || !inviting_user_id) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: message, statuses, event_id, inviting_user_id'
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate statuses array
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return new Response(JSON.stringify({
        error: 'statuses must be a non-empty array'
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Validate status values - REMOVED "all" status
    const validStatuses = ['in', 'out', 'maybe', 'no_response'];
    const invalidStatuses = statuses.filter(status => !validStatuses.includes(status));
    if (invalidStatuses.length > 0) {
      return new Response(JSON.stringify({
        error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('Received group message request:', {
      message,
      statuses,
      event_id,
      inviting_user_id
    });

    // Get event details for message formatting
    const { data: eventData, error: eventError } = await supabaseClient
      .from('events')
      .select('title, event_date, start_time')
      .eq('id', event_id)
      .single();

    if (eventError || !eventData) {
      return new Response(JSON.stringify({
        error: 'Event not found'
      }), {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get host profile details for message formatting and notifications
    const { data: hostProfile, error: hostProfileError } = await supabaseClient
      .from('profiles')
      .select('first_name, phone_number, email, sms_consent')
      .eq('id', inviting_user_id)
      .single();

    if (hostProfileError || !hostProfile) {
      return new Response(JSON.stringify({
        error: 'Host profile not found'
      }), {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get all invitations for the specified event with contact details
    // Don't filter by status here - we want to include all invitations regardless of status
    const { data: invitations, error: invitationsError } = await supabaseClient
      .from('invitations')
      .select(`
        id,
        contact_id,
        response_note,
        status,
        is_host,
        contacts (id, phone_number, first_name)
      `)
      .eq('event_id', event_id);

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch invitations'
      }), {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!invitations || invitations.length === 0) {
      console.log('No invitations found for the specified event - skipping message sending');
      
      // Return success response with zero counts instead of error
      return new Response(JSON.stringify({
        success: true,
        message: 'No invitations found for the specified event',
        total_invitations: 0,
        sent_count: 0,
        failed_count: 0,
        results: [],
        hostNotificationStatus: 'skipped',
        hostNotificationMethod: 'none'
      }), {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    // Filter invitations based on their RSVP status
    // Exclude host invitations (is_host = true) and only include actual contacts
    const targetInvitations = invitations.filter(invitation => {
      if (!invitation.contacts) return false;
      if (invitation.is_host) return false; // Exclude host invitations
      
      return statuses.includes(invitation.response_note);
    });

    if (targetInvitations.length === 0) {
      console.log(`No invitations found with the specified RSVP statuses: ${statuses.join(', ')} - skipping message sending`);
      
      // Return success response with zero counts instead of error
      return new Response(JSON.stringify({
        success: true,
        message: `No invitations found with specified RSVP statuses: ${statuses.join(', ')}`,
        total_invitations: 0,
        sent_count: 0,
        failed_count: 0,
        results: [],
        hostNotificationStatus: 'skipped',
        hostNotificationMethod: 'none'
      }), {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log(`Found ${invitations.length} total invitations for event`);
    console.log(`Found ${targetInvitations.length} invitations to send message to`);
    console.log('Target invitations:', targetInvitations.map(inv => ({
      id: inv.id,
      contact_name: inv.contacts?.first_name,
      response_note: inv.response_note,
      status: inv.status,
      is_host: inv.is_host
    })));

    // Format date for message header
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric'
      });
    };

    const eventDate = formatDate(eventData.event_date);
    const formattedMessage = `${hostProfile.first_name} (${eventData.title} ${eventDate}): ${message}`;

    console.log('Formatted message:', formattedMessage);

    // Track message sending results
    const sendResults = [];
    const smsLogEntries = [];

    // Send SMS to each target invitation
    for (const invitation of targetInvitations) {
      if (!invitation.contacts?.phone_number) {
        console.warn(`Skipping invitation ${invitation.id}: No phone number`);
        continue;
      }

      const formattedPhone = formatPhoneForTwilio(invitation.contacts.phone_number);
      
      // Skip invalid phone numbers
      if (formattedPhone === null) {
        smsLogEntries.push({
          phone_number: invitation.contacts.phone_number,
          message_body: formattedMessage,
          direction: 'outbound',
          twilio_message_id: null,
          twilio_status: 'invalid_format',
          user_id: inviting_user_id,
          event_id: event_id,
          message_type: 'group_message'
        });
        continue;
      }

      try {
        const sendResult = await sendSMS(formattedPhone, formattedMessage);
        
        // Prepare log entry matching sms_log table schema
        smsLogEntries.push({
          phone_number: formattedPhone,
          message_body: formattedMessage,
          direction: 'outbound',
          twilio_message_id: sendResult.sid || null,
          twilio_status: sendResult.status,
          user_id: inviting_user_id,
          event_id: event_id,
          message_type: 'group_message'
        });
        
        sendResults.push({
          invitationId: invitation.id,
          contactName: invitation.contacts.first_name,
          phoneNumber: formattedPhone,
          status: sendResult.status,
          error: sendResult.error || null
        });
      } catch (error) {
        console.error(`Error sending SMS to ${invitation.contacts.first_name}:`, error);
        
        // Log any unexpected errors
        smsLogEntries.push({
          phone_number: formattedPhone,
          message_body: formattedMessage,
          direction: 'outbound',
          twilio_message_id: null,
          twilio_status: 'error',
          user_id: inviting_user_id,
          event_id: event_id,
          message_type: 'group_message'
        });

        sendResults.push({
          invitationId: invitation.id,
          contactName: invitation.contacts.first_name,
          phoneNumber: formattedPhone,
          status: 'error',
          error: error.message
        });
      }
    }

    // Log SMS attempts
    if (smsLogEntries.length > 0) {
      const { error: logError } = await supabaseClient
        .from('sms_log')
        .insert(smsLogEntries);

      if (logError) {
        console.error('Failed to log SMS messages:', logError);
      }
    }

    // Update SMS count in profiles table for the host (only count member SMS, not host confirmation)
    const successfulMemberSmsCount = sendResults.filter(r => r.status === 'sent').length;
    if (successfulMemberSmsCount > 0) {
      // First get the current count, then update it
      const { data: currentProfile, error: fetchError } = await supabaseClient
        .from('profiles')
        .select('sms_sent_count')
        .eq('id', inviting_user_id)
        .single();

      if (!fetchError && currentProfile) {
        const newCount = (currentProfile.sms_sent_count || 0) + successfulMemberSmsCount;
        
        const { error: updateError } = await supabaseClient
          .from('profiles')
          .update({
            sms_sent_count: newCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', inviting_user_id);

        if (updateError) {
          console.error('Failed to update SMS count:', updateError);
        } else {
          console.log(`Updated SMS count from ${currentProfile.sms_sent_count} to ${newCount} for user ${inviting_user_id} (member messages only)`);
        }
      } else {
        console.error('Failed to fetch current SMS count:', fetchError);
      }
    }

    // Send confirmation notification to host (SMS or Email based on consent)
    let hostNotificationStatus = 'not_sent';
    let hostNotificationMethod = 'none';
    
    // Use the existing hostProfile data for notifications
    if (hostProfile) {
      // Check if host has SMS consent (true = SMS, null/false = email)
      const hasSmsConsent = hostProfile.sms_consent === true;
      
      if (hasSmsConsent && hostProfile.phone_number) {
        // Send SMS notification to host
        hostNotificationMethod = 'sms';
        const hostPhoneNumber = formatPhoneForTwilio(hostProfile.phone_number);
        
        if (hostPhoneNumber) {
          const hostMessage = `You sent a group message to ${targetInvitations.length} people for your event.`;

          try {
            const hostSmsResult = await sendSMS(hostPhoneNumber, hostMessage);
            hostNotificationStatus = hostSmsResult.status;
            console.log('Host confirmation SMS sent:', hostSmsResult.status);
          } catch (error) {
            console.error('Failed to send host confirmation SMS:', error);
            hostNotificationStatus = 'failed';
          }
        } else {
          console.log('Invalid host phone number format');
          hostNotificationStatus = 'invalid_number';
        }
      } else if (!hasSmsConsent && hostProfile.email) {
        // Send email notification to host when SMS consent is null/false
        hostNotificationMethod = 'email';
        
        const hostEmailContent = `Hi ${hostProfile.first_name},\n\nYou sent a group message to ${targetInvitations.length} people for your event.\n\nThanks,\nThe Funlet Team`;
        
        try {
          const emailResult = await sendEmailNotification(hostProfile.email, hostEmailContent);
          if (emailResult.success) {
            hostNotificationStatus = 'sent';
            console.log('Host confirmation email sent');
          } else {
            hostNotificationStatus = 'failed';
            console.error('Failed to send host confirmation email:', emailResult.error);
          }
        } catch (error) {
          console.error('Failed to send host confirmation email:', error);
          hostNotificationStatus = 'failed';
        }
      } else {
        console.log('No phone number or email found for host, or SMS consent not set');
        hostNotificationStatus = 'no_contact';
      }
    } else {
      console.error('Host profile not available for notification');
      hostNotificationStatus = 'profile_error';
    }

    // Calculate success/failure counts after all operations are complete
    const successCount = sendResults.filter(r => r.status === 'sent').length;
    const failureCount = sendResults.length - successCount;

    // Prepare response
    return new Response(JSON.stringify({
      success: true,
      message: `Group message sent to ${targetInvitations.length} invitations`,
      total_invitations: targetInvitations.length,
      sent_count: successCount,
      failed_count: failureCount,
      results: sendResults,
      hostNotificationStatus: hostNotificationStatus,
      hostNotificationMethod: hostNotificationMethod
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Group message sending error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
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
