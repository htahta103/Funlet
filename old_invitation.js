import { createClient } from 'npm:@supabase/supabase-js@2';

// Invitation tracking base URL
const getInvitationUrl = (invitationCode) => `https://funlet.ai/rsvp/${invitationCode}`;

// Twilio configuration (replace with your actual Twilio credentials)
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = '+18887787794';

// Phone number formatting utility
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

// Generate unique invitation code with collision checking
const generateUniqueInvitationCode = async (supabase) => {
  while (true) {
    // Generate a random 8-character alphanumeric code
    const invitationCode = Math.random().toString(36).substring(2, 10);
    
    // Check if the code already exists in the database
    const { data, error } = await supabase
      .from('invitations')
      .select('invitation_code')
      .eq('invitation_code', invitationCode)
      .single();
    
    // If no existing code found, return this code
    if (error && error.code === 'PGRST116') {
      return invitationCode;
    }
  }
};

Deno.serve(async (req) => {
  // CORS headers for WeWeb integration
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };

  // Handle preflight requests
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
    const { event_id, selected_member_ids, inviting_user_id } = await req.json();

    // Validate input
    if (!event_id || !selected_member_ids || !inviting_user_id) {
      throw new Error('Missing required parameters');
    }

    console.log('Received request with:', {
      event_id,
      selected_member_ids,
      inviting_user_id
    });

    // Create Supabase client WITHOUT additional Authorization headers
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Fetch event details
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('title, location, event_date, start_time, end_time')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Event error:', eventError);
      throw eventError;
    }

    // Fetch inviting user's name from profiles table
    const { data: invitingUserData, error: invitingUserError } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('id', inviting_user_id)
      .single();

    if (invitingUserError) {
      console.error('Profile error for user_id:', inviting_user_id);
      console.error('Profile error details:', invitingUserError);
      throw invitingUserError;
    }

    // FIRST: Auto-RSVP the organizer BEFORE processing other invitations
    const { data: organizerContact, error: organizerError } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', inviting_user_id)
      .limit(1)
      .maybeSingle();

    if (organizerContact && !organizerError) {
      const organizerRSVP = await supabase
        .from('invitations')
        .insert({
          event_id: event_id,
          contact_id: organizerContact.id,
          invited_by: inviting_user_id,
          status: 'sent',
          rsvp_status: 'in',
          responded_at: new Date().toISOString(),
          invitation_code: await generateUniqueInvitationCode(supabase)
        });
      console.log('Organizer auto-RSVP:', organizerRSVP);
    } else {
      console.log('No contact found for organizer or error:', organizerError);
    }

    // Fetch crew member contact info with JOIN
    const { data: memberData, error: memberError } = await supabase
      .from('crew_members')
      .select(`
        id, 
        contacts (id, phone_number, first_name)
      `)
      .in('id', selected_member_ids);

    if (memberError) {
      console.error('Member error:', memberError);
      throw memberError;
    }

    // Validate member data
    if (!memberData || memberData.length === 0) {
      throw new Error('No valid members found for invitation');
    }

    // Prepare and send SMS invitations via Twilio
    const Twilio = (await import('npm:twilio@4.22.0')).default;
    const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    // Format date and time utilities
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'numeric',
        day: 'numeric'
      });
    };

    const formatTime = (timeString) => {
      const [hours, minutes] = timeString.split(':').map(Number);
      const period = hours >= 12 ? 'pm' : 'am';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
      return `${displayHours}${displayMinutes}${period}`;
    };

    // Process invitations for selected crew members
    const invitationPromises = memberData.map(async (member) => {
      // Validate member contact data
      if (!member.contacts || !member.contacts.phone_number) {
        console.error('Invalid member data:', member);
        throw new Error(`Missing contact information for member: ${member.id}`);
      }

      // Format phone number for Twilio
      const formattedPhoneNumber = formatPhoneForTwilio(member.contacts.phone_number);

      // Skip if phone number is invalid
      if (!formattedPhoneNumber) {
        console.error(`Invalid phone number for member: ${member.id}`, member.contacts.phone_number);
        return {
          memberId: member.id,
          memberName: member.contacts.first_name,
          status: 'failed',
          error: 'Invalid phone number format'
        };
      }

      // Generate unique invitation code
      const invitationCode = await generateUniqueInvitationCode(supabase);

      // Construct time part of the message
      const timeMessage = eventData.end_time 
        ? `${formatTime(eventData.start_time)}-${formatTime(eventData.end_time)}` 
        : `${formatTime(eventData.start_time)}`;

      // Construct SMS message
      const messageBody = `${invitingUserData.first_name} invited you to ${eventData.title}, ` +
        `${formatDate(eventData.event_date)} ${timeMessage} ` +
        `at ${eventData.location}. ` +
        `Reply 1=In! 2=Maybe 3=Out. ` +
        `Details: ${getInvitationUrl(invitationCode)}`;

      try {
        // Send SMS via Twilio with formatted phone number
        const twilioMessage = await twilioClient.messages.create({
          body: messageBody,
          from: TWILIO_PHONE_NUMBER,
          to: formattedPhoneNumber
        });

        // Create invitation record with no_response as default
        const { data: invitationData, error: invitationError } = await supabase
          .from('invitations')
          .insert({
            event_id: event_id,
            contact_id: member.contacts.id,
            invitation_code: invitationCode,
            status: 'sent',
            rsvp_status: 'no_response',
            twilio_sid: twilioMessage.sid,
            invited_by: inviting_user_id,
            sms_sent_at: new Date().toISOString()
          })
          .select();

        if (invitationError) throw invitationError;

        return {
          memberId: member.id,
          memberName: member.contacts.first_name,
          status: 'sent',
          invitationCode: invitationCode,
          formattedPhoneNumber: formattedPhoneNumber
        };

      } catch (smsError) {
        console.error('SMS sending error:', smsError);
        
        // Log failed invitation
        await supabase
          .from('invitations')
          .insert({
            event_id: event_id,
            contact_id: member.contacts.id,
            invitation_code: invitationCode,
            status: 'failed',
            rsvp_status: 'no_response',
            error_message: smsError.message,
            invited_by: inviting_user_id,
            sms_sent_at: new Date().toISOString()
          });

        return {
          memberId: member.id,
          memberName: member.contacts.first_name,
          status: 'failed',
          error: smsError.message,
          formattedPhoneNumber: formattedPhoneNumber
        };
      }
    });

    // Wait for all SMS messages to be processed
    const invitationResults = await Promise.all(invitationPromises);

    return new Response(JSON.stringify({
      message: 'Invitations processed',
      results: invitationResults
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Invitation sending error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to send invitations',
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
