import { createClient } from 'npm:@supabase/supabase-js@2';
import { logWorkflowAction } from './logger.ts';
/**
 * Send SMS message via Twilio or save to database
 * 
 * @param phoneNumber - Recipient phone number
 * @param message - SMS message content
 * @param shouldSend - Whether to actually send via Twilio (false = save to database only)
 * @param owner_phone_number - Phone number of the user who initiated the action (for usage tracking)
 * @returns Result object with success status and optional error/sid
 */ export async function sendSMS(phoneNumber, message, shouldSend = true, owner_phone_number = null) {
  try {
    // Create Supabase client (needed for both paths)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Find user by phone number (needed for both paths)
    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const phoneVariations = [
      normalizedPhone
    ];
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      phoneVariations.push(normalizedPhone.substring(1));
    }
    if (normalizedPhone.length === 10) {
      phoneVariations.push('1' + normalizedPhone);
    }
    const plusVariations = phoneVariations.map((phone)=>'+' + phone);
    phoneVariations.push(...plusVariations);
    const { data: profile } = await supabase.from('profiles').select('id, sms_sent_count').in('phone_number', phoneVariations).single();
    
    // Skip SMS if recipient is a host (phone number exists in profiles table)
    const isHost = !!profile;

    
    // Check SMS limit for the owner (person who initiated the action)
    // TEMPORARILY DISABLED FOR TESTING
    if (false && shouldSend && owner_phone_number) {
      const checkPhoneNumber = owner_phone_number; // Always check owner's limit
      try {
        const smsLimitResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-usage-limits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            phone_number: checkPhoneNumber,
            action_type: 'sms_sent'
          })
        });
        const smsLimitData = await smsLimitResponse.json();
        if (!smsLimitData.allowed) {
          console.log('❌ SMS limit exceeded for owner:', checkPhoneNumber);
          // Log SMS sent error (limit exceeded)
          logWorkflowAction({
            supabase,
            userId: profile?.id || null,
            workflowName: 'sms_sent',
            workflowStep: 'sms_limit_exceeded',
            eventType: 'sms_sent',
            executionStatus: 'failure',
            errorDetails: {
              error_type: 'SMS_LIMIT_EXCEEDED',
              limit_data: smsLimitData
            },
            metadata: {
              phone_number: phoneNumber,
              owner_phone_number: owner_phone_number,
              message_length: message.length
            }
          }).catch((error)=>console.error('Error logging SMS limit exceeded:', error));
          // Don't send SMS, return error
          return {
            success: false,
            error: 'SMS_LIMIT_EXCEEDED',
            limit_data: smsLimitData
          };
        }
      } catch (error) {
        console.error('⚠️ Error checking SMS limits:', error);
      // Continue sending on error (fail open)
      }
    }
    // Save to database when NOT sending (send_sms = false)
    if (!shouldSend) {
      if (profile?.id) {
        await supabase.from('message_thread').insert({
          user_id: profile.id,
          phone_number: phoneNumber,
          message: message,
          role: 'assistant',
          sent: false,
          sent_at: null
        });
        console.log('SMS skipped (send_sms=false), saved to message_thread');
      }
      return {
        success: true,
        skipped: true
      };
    }
    if (isHost) {
      console.log('📱 Skipping SMS - recipient is a host (phone exists in profiles table):', phoneNumber);
      // Still save to message_thread for webchat (when shouldSend=false)
      if (!shouldSend && profile?.id) {
        console.log('SMS skipped (host), saved to message_thread for webchat');
      }
      return {
        success: true,
        skipped: true,
        reason: 'host'
      };
    }
    // When shouldSend=true, send via Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = '+18887787794';
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Twilio credentials not configured');
      // Log SMS sent error (missing credentials)
      logWorkflowAction({
        supabase,
        userId: profile?.id || null,
        workflowName: 'sms_sent',
        workflowStep: 'sms_credentials_missing',
        eventType: 'sms_sent',
        executionStatus: 'failure',
        errorDetails: {
          error_type: 'TWILIO_CREDENTIALS_MISSING',
          missing_sid: !TWILIO_ACCOUNT_SID,
          missing_token: !TWILIO_AUTH_TOKEN
        },
        metadata: {
          phone_number: phoneNumber,
          owner_phone_number: owner_phone_number,
          message_length: message.length
        }
      }).catch((error)=>console.error('Error logging SMS credentials error:', error));
      return {
        success: false,
        error: 'Twilio credentials not configured'
      };
    }
    const Twilio = (await import('npm:twilio@4.22.0')).default;
    const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('Sending SMS to:', phoneNumber);
    console.log('SMS message:', message);
    const smsResult = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: phoneNumber,
      shortenUrls: true
    });
    console.log('SMS sent successfully:', smsResult.sid);
    // Log SMS sent event
    logWorkflowAction({
      supabase,
      userId: profile?.id || null,
      workflowName: 'sms_sent',
      workflowStep: 'sms_delivered',
      eventType: 'sms_sent',
      executionStatus: 'success',
      metadata: {
        phone_number: phoneNumber,
        owner_phone_number: owner_phone_number,
        message_length: message.length,
        twilio_sid: smsResult.sid,
        twilio_status: smsResult.status
      }
    }).catch((error)=>console.error('Error logging SMS sent:', error));
    // After successful Twilio message send, increment SMS count for owner
    if (owner_phone_number) {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/increment-usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: owner_phone_number,
          action_type: 'sms_sent'
        })
      }).catch((error)=>console.error('Error incrementing SMS usage for owner:', error));
    }
    return {
      success: true,
      sid: smsResult.sid
    };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    // Try to get supabase client for error logging
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      // Find user by phone number for error logging
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const phoneVariations = [
        normalizedPhone
      ];
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      const plusVariations = phoneVariations.map((phone)=>'+' + phone);
      phoneVariations.push(...plusVariations);
      const { data: profile } = await supabase.from('profiles').select('id').in('phone_number', phoneVariations).single();
      // Log SMS sent error
      logWorkflowAction({
        supabase,
        userId: profile?.id || null,
        workflowName: 'sms_sent',
        workflowStep: 'sms_send_failed',
        eventType: 'sms_sent',
        executionStatus: 'failure',
        errorDetails: {
          error_type: 'SMS_SEND_ERROR',
          error_message: error.message || String(error),
          error_stack: error.stack
        },
        metadata: {
          phone_number: phoneNumber,
          owner_phone_number: owner_phone_number,
          message_length: message?.length || 0
        }
      }).catch((logError)=>console.error('Error logging SMS send error:', logError));
    } catch (logError) {
      console.error('Failed to log SMS error:', logError);
    }
    return {
      success: false,
      error: error.message
    };
  }
}
/**
 * Log when an SMS is received (inbound message from invitee)
 * 
 * @param supabase - Supabase client instance
 * @param phoneNumber - Phone number that sent the SMS
 * @param message - SMS message content
 * @param contactId - Optional contact ID if known
 * @param eventId - Optional event ID if related to an event
 * @param syncUpId - Optional sync_up ID if related to a sync-up
 */ export async function logSMSReceived(supabase, phoneNumber, message, contactId, eventId, syncUpId) {
  try {
    // Early return if phoneNumber or message is missing
    if (!phoneNumber || !message) {
      console.warn('logSMSReceived called with missing phoneNumber or message', {
        phoneNumber,
        message
      });
      return;
    }
    // Find user/contact by phone number
    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const phoneVariations = [
      normalizedPhone
    ];
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      phoneVariations.push(normalizedPhone.substring(1));
    }
    if (normalizedPhone.length === 10) {
      phoneVariations.push('1' + normalizedPhone);
    }
    const plusVariations = phoneVariations.map((phone)=>'+' + phone);
    phoneVariations.push(...plusVariations);
    const { data: profile } = await supabase.from('profiles').select('id').in('phone_number', phoneVariations).single();
    // Log SMS received event
    logWorkflowAction({
      supabase,
      userId: profile?.id || null,
      workflowName: 'sms_received',
      workflowStep: 'sms_received',
      eventType: 'sms_received',
      executionStatus: 'success',
      contactId: contactId || undefined,
      eventId: eventId || undefined,
      syncUpId: syncUpId || undefined,
      metadata: {
        phone_number: phoneNumber || null,
        message_length: message?.length || 0
      }
    }).catch((error)=>console.error('Error logging SMS received:', error));
  } catch (error) {
    console.error('Failed to log SMS received:', error);
    // Try to log the error in logging itself
    try {
      logWorkflowAction({
        supabase,
        userId: null,
        workflowName: 'sms_received',
        workflowStep: 'log_sms_received_failed',
        eventType: 'error',
        executionStatus: 'failure',
        errorDetails: {
          error_type: 'LOG_SMS_RECEIVED_ERROR',
          error_message: error.message || String(error),
          original_phone_number: phoneNumber || null,
          original_message_length: message?.length || 0
        },
        metadata: {
          phone_number: phoneNumber || null,
          message_length: message?.length || 0
        }
      }).catch((logError)=>console.error('Error logging SMS received logging error:', logError));
    } catch (logError) {
      console.error('Failed to log SMS received logging error:', logError);
    }
  }
}
