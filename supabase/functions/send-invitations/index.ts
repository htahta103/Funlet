import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const { event_id, selected_member_ids, crew_id, inviting_user_id } = await req.json();

    // Validate input - need either crew_id OR selected_member_ids
    if (!event_id || !inviting_user_id) {
      throw new Error('Missing required parameters: event_id and inviting_user_id');
    }
    
    if (!crew_id && (!selected_member_ids || selected_member_ids.length === 0)) {
      throw new Error('Must provide either crew_id OR selected_member_ids');
    }

    console.log('Received request with:', {
      event_id,
      selected_member_ids,
      crew_id,
      inviting_user_id
    });

    // Create Supabase client WITHOUT additional Authorization headers
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Fetch event details (including creator_id and shortened calendar URL)
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('title, location, event_date, start_time, end_time, creator_id, shorten_calendar_url')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('Event error:', eventError);
      throw eventError;
    }

    // Fetch inviting user's data from profiles table
    const { data: invitingUserData, error: invitingUserError } = await supabase
      .from('profiles')
      .select('first_name, phone_number, email, sms_consent')
      .eq('id', inviting_user_id)
      .single();

    if (invitingUserError) {
      console.error('Profile error for user_id:', inviting_user_id);
      console.error('Profile error details:', invitingUserError);
      throw invitingUserError;
    }

    // Auto-invite the host if they don't have an invitation record
    if (eventData.creator_id) {
      console.log('Checking if host needs auto-invitation...');
      
      // Check if host already has an invitation
      const { data: existingHostInvitation, error: hostInvitationError } = await supabase
        .from('invitations')
        .select('id')
        .eq('event_id', event_id)
        .is('contact_id', null)
        .eq('is_host', true)
        .single();

      if (hostInvitationError && hostInvitationError.code === 'PGRST116') {
        // No existing invitation found, create one for the host
        console.log('Creating auto-invitation for host...');
        
        // Get host's contact info
        // If the inviting user is the host, use their profile data, otherwise fetch host profile
        let hostProfile;
        let hostProfileError = null;
        
        if (eventData.creator_id === inviting_user_id) {
          // Inviting user is the host, use their profile data
          hostProfile = invitingUserData;
          console.log('Inviting user is the host, using their profile data');
        } else {
          // Different host, fetch their profile
          const { data, error } = await supabase
            .from('profiles')
            .select('first_name, phone_number')
            .eq('id', eventData.creator_id)
            .single();
          hostProfile = data;
          hostProfileError = error;
        }

        if (hostProfileError) {
          console.error('Error fetching host profile:', hostProfileError);
        } else if (hostProfile) {
          // Generate invitation code for host
          const hostInvitationCode = await generateUniqueInvitationCode(supabase);
          
          // Create host invitation without sending SMS
          let hostInvitationStatus = 'sent';
          let hostSmsSentAt = null;
          let hostError = null;
          
          console.log('Creating host auto-invitation without SMS confirmation');
          
          // Create invitation record for host with "in" status
          const { data: hostInvitationData, error: hostInvitationCreateError } = await supabase
            .from('invitations')
            .insert({
              event_id: event_id,
              contact_id: null, // Host is not a contact, they're a user
              invitation_code: hostInvitationCode,
              status: hostInvitationStatus,
              response_note: 'in', // Host is automatically "in"
              invited_by: inviting_user_id,
              sms_sent_at: hostSmsSentAt,
              is_host: true, // Mark this invitation as host invitation
              error_message: hostError
            })
            .select();

          if (hostInvitationCreateError) {
            console.error('Error creating host invitation:', hostInvitationCreateError);
          } else {
            console.log('Host auto-invitation created successfully:', hostInvitationData);
          }
        }
      } else if (hostInvitationError) {
        console.error('Error checking host invitation:', hostInvitationError);
      } else {
        console.log('Host already has an invitation record');
      }
    }

    // Determine which crew members to invite
    let memberData;
    let memberError;
    
    if (crew_id) {
      // If crew_id provided, get ALL members of that crew
      console.log('Fetching all members for crew_id:', crew_id);
      const { data, error } = await supabase
        .from('crew_members')
        .select(`
          id, 
          contacts (id, phone_number, first_name)
        `)
        .eq('crew_id', crew_id);
      
      memberData = data;
      memberError = error;
    } else {
      // If selected_member_ids provided, get specific members
      console.log('Fetching specific members:', selected_member_ids);
      const { data, error } = await supabase
        .from('crew_members')
        .select(`
          id, 
          contacts (id, phone_number, first_name)
        `)
        .in('id', selected_member_ids);
      
      memberData = data;
      memberError = error;
    }

    if (memberError) {
      console.error('Member error:', memberError);
      throw memberError;
    }

    // Validate member data
    if (!memberData || memberData.length === 0) {
      throw new Error('No valid members found for invitation');
    }

    // Filter out invalid members (missing contact info, invalid phone numbers, etc.)
    const validMembers = memberData.filter(member => {
      if (!member.contacts) {
        console.warn(`Skipping member ${member.id}: No contact information`);
        return false;
      }
      
      if (!member.contacts.phone_number) {
        console.warn(`Skipping member ${member.id}: No phone number`);
        return false;
      }
      
      const formattedPhone = formatPhoneForTwilio(member.contacts.phone_number);
      if (!formattedPhone) {
        console.warn(`Skipping member ${member.id}: Invalid phone number format: ${member.contacts.phone_number}`);
        return false;
      }
      
      return true;
    });

    if (validMembers.length === 0) {
      throw new Error('No members with valid contact information found');
    }

    console.log(`Found ${memberData.length} total members, ${validMembers.length} valid members to invite`);

    // Log skipped members for debugging
    const skippedMembers = memberData.filter(member => !validMembers.includes(member));
    if (skippedMembers.length > 0) {
      console.log('Skipped members due to invalid data:', skippedMembers.map(m => ({
        id: m.id,
        contact_id: m.contacts?.id,
        first_name: m.contacts?.first_name,
        phone_number: m.contacts?.phone_number
      })));
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

    const formatDateShort = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
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
    const invitationPromises = validMembers.map(async (member) => {

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
        `${formatDate(eventData.event_date)} at ${eventData.location} ${timeMessage}. ` +
        `Reply 1=In! 2=Out 3=Maybe.`;

      try {
        // Send SMS via Twilio with formatted phone number
        const twilioMessage = await twilioClient.messages.create({
          body: messageBody,
          from: TWILIO_PHONE_NUMBER,
          to: formattedPhoneNumber
        });

        // Log all IDs for debugging
        console.log('=== SMS SENT - ALL IDs ===');
        console.log('Twilio Message Object:', JSON.stringify(twilioMessage, null, 2));
        console.log('Twilio Message SID:', twilioMessage.sid);
        console.log('Member ID:', member.id);
        console.log('Contact ID:', member.contacts.id);
        console.log('Invitation Code:', invitationCode);
        console.log('Event ID:', event_id);
        console.log('Inviting User ID:', inviting_user_id);
        console.log('=== END SMS IDs ===');

        // Create invitation record with no_response as default
        const { data: invitationData, error: invitationError } = await supabase
          .from('invitations')
          .insert({
            event_id: event_id,
            contact_id: member.contacts.id,
            invitation_code: invitationCode,
            status: 'sent',
            response_note: 'no_response',
            invited_by: inviting_user_id,
            sms_sent_at: new Date().toISOString(),
            is_host: false // Mark this invitation as guest invitation
          })
          .select();

        if (invitationError) throw invitationError;

        // Log the created invitation record
        console.log('=== INVITATION CREATED ===');
        console.log('Invitation Record:', JSON.stringify(invitationData, null, 2));
        console.log('=== END INVITATION ===');

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
            response_note: 'no_response',
            error_message: smsError.message,
            invited_by: inviting_user_id,
            sms_sent_at: new Date().toISOString(),
            is_host: false // Mark this invitation as guest invitation
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

    // Update SMS count in profiles table for the host (only count member SMS, not host confirmation)
    const successfulMemberSmsCount = invitationResults.filter(result => result.status === 'sent').length;
    if (successfulMemberSmsCount > 0) {
      // First get the current count, then update it
      const { data: currentProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('sms_sent_count')
        .eq('id', inviting_user_id)
        .single();

      if (!fetchError && currentProfile) {
        const newCount = (currentProfile.sms_sent_count || 0) + successfulMemberSmsCount;
        
        const { error: updateError } = await supabase
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

    // Skip sending confirmation notification to host - only send to invitees
    const hostNotificationStatus = 'skipped';
    const hostNotificationMethod = 'none';
    console.log('Host notification skipped - only sending to invitees');

    return new Response(JSON.stringify({
      message: 'Invitations processed',
      results: invitationResults,
      hostNotificationStatus: hostNotificationStatus,
      hostNotificationMethod: hostNotificationMethod
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
