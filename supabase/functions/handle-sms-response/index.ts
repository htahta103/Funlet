import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // CORS headers
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
    // Parse the form data from Twilio webhook
    const formData = await req.formData();
    
    // Extract Twilio webhook data
    const messageSid = formData.get('MessageSid') as string;
    const fromPhone = formData.get('From') as string;
    const toPhone = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const messageStatus = formData.get('SmsStatus') as string;

    // Log ALL webhook data to see what Twilio is sending
    const allWebhookData = {};
    for (const [key, value] of formData.entries()) {
      allWebhookData[key] = value;
    }
    
    console.log('=== ALL TWILIO WEBHOOK DATA ===');
    console.log(JSON.stringify(allWebhookData, null, 2));
    console.log('=== END WEBHOOK DATA ===');

    console.log('Received SMS webhook:', {
      messageSid,
      fromPhone,
      toPhone,
      body,
      messageStatus
    });

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Format the phone number to match our database format
    // Remove + and keep all digits (including leading 1 for US numbers)
    const formattedFromPhone = fromPhone.replace(/\D/g, '');
    console.log('Formatted phone number:', formattedFromPhone);
    
    // Create multiple phone number variations to search for
    const phoneVariations = [];
    
    // Original formatted phone (e.g., "18777804236")
    phoneVariations.push(formattedFromPhone);
    
    // If it's 11 digits and starts with 1, also try without the leading 1 (e.g., "8777804236")
    if (formattedFromPhone.length === 11 && formattedFromPhone.startsWith('1')) {
      phoneVariations.push(formattedFromPhone.substring(1));
    }
    
    // If it's 10 digits, also try with leading 1 (e.g., "18777804236")
    if (formattedFromPhone.length === 10) {
      phoneVariations.push('1' + formattedFromPhone);
    }
    
    // Add + prefix variations for all existing variations
    const plusVariations = phoneVariations.map(phone => '+' + phone);
    phoneVariations.push(...plusVariations);
    
    console.log('Phone variations to search:', phoneVariations);
    
    const cleanBody = body.trim().toLowerCase();
    
    console.log('=== BODY PROCESSING DEBUG ===');
    console.log('Original body:', JSON.stringify(body));
    console.log('Body after trim():', JSON.stringify(body.trim()));
    console.log('Body after toLowerCase():', JSON.stringify(cleanBody));
    console.log('cleanBody === "9":', cleanBody === '9');
    console.log('cleanBody length:', cleanBody.length);
    console.log('cleanBody char codes:', cleanBody.split('').map(c => c.charCodeAt(0)));
    console.log('=== END BODY DEBUG ===');
    
    // Handle "9" command for hosts to get upcoming events info
    if (cleanBody === '9') {
      console.log('Processing "9" command - looking for host invitation only');
      
      // For "9" command, only look for host invitations
      // Try each phone variation until we find a match
      let hostProfile = null;
      let profileError = null;
      
      for (const phoneVariation of phoneVariations) {
        console.log('Searching for host profile with phone:', phoneVariation);
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, phone_number')
          .eq('phone_number', phoneVariation)
          .single();
        
        if (data && !error) {
          hostProfile = data;
          profileError = null;
          console.log('Found host profile with phone variation:', phoneVariation);
          break;
        } else {
          console.log('No profile found for phone variation:', phoneVariation);
        }
      }

      if (profileError || !hostProfile) {
        console.error('No profile found for phone number:', { fromPhone, formattedFromPhone });
        return new Response(JSON.stringify({
          error: 'Host profile not found',
          fromPhone,
          formattedFromPhone,
          debug: 'No profile found for this phone number'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      // Find host invitation for this profile
      const { data: hostInvitation, error: hostInvitationError } = await supabase
        .from('invitations')
        .select(`
          id,
          event_id,
          contact_id,
          response_note,
          is_host,
          events (title, location, event_date, start_time, end_time, creator_id, shorten_calendar_url)
        `)
        .eq('events.creator_id', hostProfile.id)
        .is('contact_id', null)
        .eq('is_host', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (hostInvitationError || !hostInvitation) {
        console.error('No host invitation found for profile:', hostProfile.id);
        return new Response(JSON.stringify({
          error: 'Host invitation not found',
          fromPhone,
          formattedFromPhone,
          debug: 'No host invitation found for this profile'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      // Add profile data to host invitation
      const invitation = {
        ...hostInvitation,
        contacts: {
          first_name: hostProfile.first_name,
          phone_number: hostProfile.phone_number
        }
      };

      // Get host's upcoming events
      const { data: hostEvents, error: eventsError } = await supabase
        .from('events')
        .select(`
          id,
          title,
          location,
          event_date,
          start_time,
          end_time,
          creator_id
        `)
        .eq('creator_id', hostProfile.id)
        .gte('event_date', new Date().toISOString().split('T')[0]) // Only future events
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (eventsError || !hostEvents || hostEvents.length === 0) {
        const confirmationMessage = 'You have no upcoming events. Create one at funlet.ai';
        
        // Send confirmation SMS
        const Twilio = (await import('npm:twilio@4.22.0')).default;
        const twilioClient = new Twilio(
          Deno.env.get('TWILIO_ACCOUNT_SID'),
          Deno.env.get('TWILIO_AUTH_TOKEN')
        );

        try {
          await twilioClient.messages.create({
            body: confirmationMessage,
            from: '+18887787794',
            to: fromPhone,
            shortenUrls: true
          });
        } catch (smsError) {
          console.error('Failed to send no events message:', smsError);
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'No upcoming events response sent',
          response: 'no_events'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      // Get RSVP data for each event
      let eventsInfo = 'Your upcoming events:\n\n';
      
      for (const event of hostEvents) {
        // Get host invitation code for this event
        const { data: eventHostInvitation, error: hostInvitationError } = await supabase
          .from('invitations')
          .select('invitation_code')
          .eq('event_id', event.id)
          .is('contact_id', null)
          .eq('is_host', true)
          .single();

        // Get all invitations for this event
        const { data: eventInvitations, error: invitationsError } = await supabase
          .from('invitations')
          .select(`
            response_note,
            contacts (first_name)
          `)
          .eq('event_id', event.id)
          .eq('status', 'sent')
          .not('is_host', 'eq', true); // Exclude host invitations

        if (invitationsError) {
          console.error('Error fetching invitations for event:', event.id, invitationsError);
          continue;
        }

        // Format date and time
        const formatDate = (dateString) => {
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

        const eventDate = formatDate(event.event_date);
        const eventTime = formatTime(event.start_time);
        
        // Count RSVP responses
        const inPeople = eventInvitations?.filter(inv => inv.response_note === 'in') || [];
        const maybePeople = eventInvitations?.filter(inv => inv.response_note === 'maybe') || [];
        const outPeople = eventInvitations?.filter(inv => inv.response_note === 'out') || [];
        const noResponsePeople = eventInvitations?.filter(inv => inv.response_note === 'no_response') || [];

        // Build RSVP breakdown with consistent formatting
        let rsvpLines = [];
        
        // Helper function to format names with ellipsis for long lists
        const formatNames = (people, maxNames = 3) => {
          const names = people.map(p => p.contacts?.first_name).filter(Boolean);
          if (names.length <= maxNames) {
            return names.join(', ');
          } else {
            const shownNames = names.slice(0, maxNames);
            return `${shownNames.join(', ')}...`;
          }
        };
        
        if (inPeople.length > 0) {
          const names = formatNames(inPeople);
          rsvpLines.push(`In!: ${names} (${inPeople.length})`);
        }
        if (maybePeople.length > 0) {
          const names = formatNames(maybePeople);
          rsvpLines.push(`Maybe: ${names} (${maybePeople.length})`);
        }
        if (outPeople.length > 0) {
          const names = formatNames(outPeople);
          rsvpLines.push(`Out: ${names} (${outPeople.length})`);
        }
        if (noResponsePeople.length > 0) {
          const names = formatNames(noResponsePeople);
          rsvpLines.push(`No Response: ${names} (${noResponsePeople.length})`);
        }

        // Add event info with clean formatting
        eventsInfo += `📅 ${event.title}\n`;
        eventsInfo += `   ${eventDate} at ${eventTime}\n`;
        if (event.location) {
          eventsInfo += `   📍 ${event.location}\n`;
        }
        
        // Add RSVP breakdown if there are any responses
        if (rsvpLines.length > 0) {
          eventsInfo += rsvpLines.join('\n') + '\n';
        }
        
        // Only add details URL if we have a valid invitation code
        if (eventHostInvitation?.invitation_code) {
          eventsInfo += `Details: www.funlet.ai/event/${eventHostInvitation.invitation_code}\n\n`;
        } else {
          eventsInfo += `Details: www.funlet.ai/events\n\n`;
        }
      }

      // Send events info SMS
      const Twilio = (await import('npm:twilio@4.22.0')).default;
      const twilioClient = new Twilio(
        Deno.env.get('TWILIO_ACCOUNT_SID'),
        Deno.env.get('TWILIO_AUTH_TOKEN')
      );

      try {
        await twilioClient.messages.create({
          body: eventsInfo.trim(),
          from: '+18887787794',
          to: fromPhone,
          shortenUrls: true
        });
      } catch (smsError) {
        console.error('Failed to send events info:', smsError);
      }

      // Log user action for viewing events
      await supabase
        .from('user_actions')
        .insert({
          user_id: hostProfile.id,
          action: 'view_events',
          event_id: null, // This is a general view events action, not specific to one event
          metadata: {
            phone_number: fromPhone,
            events_count: hostEvents.length,
            command: '9'
          }
        });

      return new Response(JSON.stringify({
        success: true,
        message: 'Events info sent to host',
        response: 'events_info',
        events_count: hostEvents.length
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    return;
    }

    // Check if this is an RSVP command (1, 2, 3)
    if (cleanBody === '1' || cleanBody === '2' || cleanBody === '3') {
      console.log('Processing RSVP command - checking if user is a host first');
      
      // First, check if this phone number belongs to a host (profile exists)
      let hostProfile = null;
      let profileError = null;
      
      for (const phoneVariation of phoneVariations) {
        console.log('Searching for host profile with phone:', phoneVariation);
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, phone_number')
          .eq('phone_number', phoneVariation)
          .single();
        
        if (data && !error) {
          hostProfile = data;
          profileError = null;
          console.log('Found host profile with phone variation:', phoneVariation);
          break;
        } else {
          console.log('No profile found for phone variation:', phoneVariation);
        }
      }

      if (hostProfile) {
        console.log('User is a host, forwarding to funlet-sms-handler');

        // Forward to funlet-sms-handler-v2 for AI processing
        try {
          const handlerResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/funlet-sms-handler-v2`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              message: body,
              phone_number: formattedFromPhone,
              is_host: true
            })
          });

          if (handlerResponse.ok) {
            const handlerData = await handlerResponse.json();
            console.log('funlet-sms-handler response:', handlerData);
            
            return new Response(JSON.stringify({
              success: true,
              message: 'Message forwarded to AI handler',
              handler_response: handlerData
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          } else {
            console.error('funlet-sms-handler failed:', handlerResponse.status, await handlerResponse.text());
          }
        } catch (error) {
          console.error('Failed to forward to funlet-sms-handler:', error);
        }
        
        // If forwarding fails, return a helpful message
        return new Response(JSON.stringify({
          success: false,
          message: 'Message received but could not be processed',
          suggestion: 'Try replying with 1=In, 2=Out, 3=Maybe, or 9 for events'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      
      // If not a host, forward to funlet-sms-handler-v2 for pattern matching
      console.log('User is not a host, forwarding to funlet-sms-handler-v2 for pattern matching');
      
      try {
        const handlerResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/funlet-sms-handler-v2`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            message: body,
            phone_number: formattedFromPhone,
            is_host: false
          })
        });

        if (handlerResponse.ok) {
          const handlerData = await handlerResponse.json();
          console.log('funlet-sms-handler-v2 response:', handlerData);
          
          return new Response(JSON.stringify({
            success: true,
            message: 'Message processed by pattern matching',
            handler_response: handlerData
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
          console.error('funlet-sms-handler-v2 failed:', handlerResponse.status, await handlerResponse.text());
        }
      } catch (error) {
        console.error('Failed to forward to funlet-sms-handler-v2:', error);
      }
      
      // If forwarding fails, return a helpful message
      return new Response(JSON.stringify({
        success: false,
        message: 'Message received but could not be processed',
        suggestion: 'Try replying with 1=In, 2=Out, 3=Maybe'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      // Not an RSVP command (1, 2, 3) and not "9" - forward to funlet-sms-handler
      console.log('Message is not a valid command, forwarding to funlet-sms-handler');

      // Determine if user is a host or crew member for proper AI processing
      let isHost = false;

      // Check each phone variation to see if user is a host
      for (const phoneVariation of phoneVariations) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id')
          .eq('phone_number', phoneVariation)
          .single();

        if (profileData) {
          isHost = true;
          console.log('User identified as host for AI processing');
          break;
        }
      }

      if (!isHost) {
        console.log('User identified as crew member for AI processing');
      }

      try {
        const handlerResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/funlet-sms-handler-v2`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            message: body,
            phone_number: formattedFromPhone,
            is_host: isHost
          })
        });

        if (handlerResponse.ok) {
          const handlerData = await handlerResponse.json();
          console.log('funlet-sms-handler response:', handlerData);
          
          return new Response(JSON.stringify({
            success: true,
            message: 'Message forwarded to AI handler',
            handler_response: handlerData
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
          console.error('funlet-sms-handler failed:', handlerResponse.status, await handlerResponse.text());
        }
      } catch (error) {
        console.error('Failed to forward to funlet-sms-handler:', error);
      }
      
      // If forwarding fails, return a helpful message
      return new Response(JSON.stringify({
        success: false,
        message: 'Message received but could not be processed',
        suggestion: 'Try replying with 1=In, 2=Out, 3=Maybe, or 9 for events'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

  } catch (error) {
    console.error('SMS webhook processing error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to process SMS webhook',
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