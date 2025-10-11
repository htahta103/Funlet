import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Helper function to send SMS messages
async function sendSMS(phoneNumber: string, message: string) {
  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = '+18887787794';

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Twilio credentials not configured');
      return { success: false, error: 'Twilio credentials not configured' };
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
    return { success: true, sid: smsResult.sid };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to handle ONBOARDING_CONTINUE actions
async function handleOnboardingContinue(userId: string, extractedParams: any, supabase: any, phoneNumber?: string, substep?: number) {
  try {
    console.log('Handling ONBOARDING_CONTINUE with extracted params:', extractedParams, 'substep:', substep);
    
    // Handle crew name extraction - create new crew
    if (extractedParams.crew_name) {
      console.log('Creating new crew:', extractedParams.crew_name);
      
      const { data: crewData, error: crewError } = await supabase
        .from('crews')
        .insert({
          creator_id: userId,
          name: extractedParams.crew_name,
          description: `Crew created during onboarding`,
          crew_type: 'social',
          settings: {
            visibility: 'private',
            auto_invite_new_members: false
          }
        })
        .select('id, name')
        .single();
      
      if (crewError) {
        console.error('Error creating crew:', crewError);
        return {
          action: 'CREW_CREATION_ERROR',
          content: 'Failed to create crew. Please try again.',
          error: crewError.message
        };
      } else {
        console.log('Successfully created crew:', crewData.id);
        
        // Wait for the trigger to complete and generate invite URL with retry logic
        console.log('Waiting for invite URL generation...');
        let inviteUrl = null;
        let retryCount = 0;
        const maxRetries = 5;
        
        while (retryCount < maxRetries && !inviteUrl) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          
          // Fetch the crew data again to get the generated invite URL
          const { data: updatedCrewData, error: fetchError } = await supabase
            .from('crews')
            .select('id, name, invite_url, invite_code')
            .eq('id', crewData.id)
            .single();
          
          if (fetchError) {
            console.error(`Error fetching crew data (attempt ${retryCount + 1}):`, fetchError);
          } else if (updatedCrewData.invite_url) {
            console.log('Fetched crew data with invite URL:', updatedCrewData.invite_url);
            inviteUrl = updatedCrewData.invite_url;
            crewData.invite_url = updatedCrewData.invite_url;
            break;
          } else {
            console.log(`Invite URL not ready yet (attempt ${retryCount + 1}/${maxRetries})`);
          }
          
          retryCount++;
        }
        
        if (!inviteUrl) {
          console.warn('Invite URL not generated after maximum retries, continuing without it');
        }
        
        // Get existing extracted_data and append new crew data
        const { data: currentState } = await supabase
          .from('conversation_state')
          .select('extracted_data')
          .eq('user_id', userId)
          .single();
        
        const existingData = currentState?.extracted_data || [];
        // Ensure existingData is an array
        const existingDataArray = Array.isArray(existingData) ? existingData : [];
        const extractedDataList = [...existingDataArray, {
          extracted_data: extractedParams,
          executed_data: {
            crew_id: crewData.id,
            crew_name: extractedParams.crew_name,
            action: 'CREW_CREATED',
            timestamp: new Date().toISOString()
          }
        }];
        
        // Generate crew link for the response
        // Update conversation state to member adding mode (step 2)
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'onboarding_step_2',
            onboarding_step: 2,
            waiting_for: 'member_adding_mode',
            extracted_data: extractedDataList
          })
          .eq('user_id', userId);
        
        // Send SMS response for crew creation
        if (phoneNumber) {
          const smsMessage = `${extractedParams.crew_name} crew created. Add members by sharing the crew link below or text member info (eg. Tom 4155551234). Crew link: ${crewData?.invite_url??""}. When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
          const smsResult = await sendSMS(phoneNumber, smsMessage);
          console.log('Crew creation SMS result:', smsResult);
        }
        
        // Return success message for crew creation
        return {
          action: 'CREW_CREATED',
          content: `${extractedParams.crew_name} crew created. Add members by sharing the crew link below or text member info (eg. Tom 4155551234). Crew link: ${crewData?.invite_url??""}. When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`,
          crew_id: crewData.id,
          crew_name: extractedParams.crew_name
        };
      }
    }
    
    
    // Handle member addition in "member adding mode"
    else if (extractedParams.crew_members || extractedParams.member_name || extractedParams.member_phone) {
      console.log('Handling member addition in member adding mode:', extractedParams);
      
      // Get existing conversation state to find the crew
      const { data: currentState } = await supabase
        .from('conversation_state')
        .select('extracted_data')
        .eq('user_id', userId)
        .single();
      
      let crewId = null;
      let crewName = 'crew';
      
      // Extract crew info from previous extracted_data (search from end for latest)
      if (currentState && currentState.extracted_data && Array.isArray(currentState.extracted_data)) {
        // Search from the end of the array to find the most recent crew
        for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
          const item = currentState.extracted_data[i];
          if (item.executed_data && item.executed_data.action === 'CREW_CREATED') {
            crewId = item.executed_data.crew_id;
            crewName = item.executed_data.crew_name;
            break;
          }
        }
      }
      
      // If no crew found, this is an error - should not happen
      if (!crewId) {
        console.error('No crew_id found during member adding mode - this should not happen');

          if (phoneNumber) {
          const smsMessage = 'Error: No crew found. Please start over by saying "hi".';
            const smsResult = await sendSMS(phoneNumber, smsMessage);
            console.log('Onboarding error SMS result:', smsResult);
          }
          
          return {
            action: 'ONBOARDING_ERROR',
          content: 'Error: No crew found. Please start over by saying "hi".'
          };
      }
      
      // Process crew members
      const crewMembers = extractedParams.crew_members || [];
      if (crewMembers.length === 0) {
        // Handle single member format
        if (extractedParams.member_name && extractedParams.member_phone) {
          crewMembers.push({
            name: extractedParams.member_name,
            phone: extractedParams.member_phone
          });
        }
      }
      
      if (crewMembers.length > 0) {
        const addedMembers = [];
        
        for (const member of crewMembers) {
          try {
            // Check if contact already exists
            const { data: existingContact } = await supabase
              .from('contacts')
              .select('id, first_name')
              .eq('user_id', userId)
              .eq('phone_number', member.phone)
              .single();

            let contactData;
            if (existingContact) {
              console.log('Using existing contact:', existingContact.id);
              contactData = existingContact;
            } else {
              // Create new contact record
              const { data: newContactData, error: contactError } = await supabase
                .from('contacts')
                .insert({
                  user_id: userId,
                  first_name: member.name,
                  phone_number: member.phone
                })
                .select()
                .single();

              if (contactError) {
                console.error('Error creating contact:', contactError);
                continue;
              }
              contactData = newContactData;
            }

            // Create crew_members record
            const { data: memberData, error: memberError } = await supabase
              .from('crew_members')
              .insert({
                crew_id: crewId,
                contact_id: contactData.id,
                role: 'member'
              })
              .select()
              .single();
            
            if (memberError) {
              console.error('Error adding crew member:', memberError);
              continue;
            }
            
            addedMembers.push({
              contact_id: contactData.id,
              member_id: memberData.id,
              name: member.name,
              phone: member.phone
            });
            
            console.log('Successfully added crew member:', memberData.id);
          } catch (error) {
            console.error('Error processing member:', member, error);
          }
        }
        
        if (addedMembers.length > 0) {
          // Update extracted_data with member addition
          const updatedExtractedData = Array.isArray(currentState?.extracted_data) ? currentState.extracted_data : [];
          updatedExtractedData.push({
            extracted_data: extractedParams,
            executed_data: {
              added_members: addedMembers,
              action: 'MEMBERS_ADDED',
              timestamp: new Date().toISOString()
            }
          });
          
          // Stay in member adding mode - update conversation state
          await supabase
            .from('conversation_state')
            .update({
              current_state: 'onboarding_step_2',
              onboarding_step: 2,
              waiting_for: 'member_adding_mode',
              extracted_data: updatedExtractedData
            })
            .eq('user_id', userId);
          
          // Send SMS response confirming member addition and staying in mode
          if (phoneNumber) {
            const memberNames = addedMembers.map(m => m.name).join(', ');
            const smsMessage = `Added ${memberNames} to "${crewName}"! You can add more members or type 'Create Event' to send invites, 'Sync Up' to find time to connect, or 'exit' to exit.`;
            const smsResult = await sendSMS(phoneNumber, smsMessage);
            console.log('Member addition SMS result:', smsResult);
          }
          
          // Return success message for member addition
          return {
            action: 'MEMBERS_ADDED',
            content: `Added ${addedMembers.map(m => m.name).join(', ')} to "${crewName}"! You can add more members or type 'Create Event' to send invites, 'Sync Up' to find time to connect, or 'exit' to exit.`,
            crew_name: crewName,
            crew_id: crewId,
            added_members: addedMembers
          };
        } else {
          return {
            action: 'MEMBER_ADDITION_ERROR',
            content: 'Failed to add crew members. Please try again.'
          };
        }
      } else {
        return {
          action: 'NO_MEMBERS_PROVIDED',
          content: 'No crew members provided. Please provide contact info like "tom +14155554321".'
        };
      }
    }
    
    
    // Unknown action - return "unknown message"
    else {
      console.log('Unknown ONBOARDING_CONTINUE action, no data extracted');
      return {
        action: 'UNKNOWN_MESSAGE',
        content: 'Unknown message'
      };
    }
    
  } catch (error) {
    console.error('Error in handleOnboardingContinue:', error);
    return {
      action: 'ONBOARDING_ERROR',
      content: 'An error occurred during onboarding. Please try again.',
      error: error.message
    };
  }
}

// Check RSVPs for a specific event with enhanced display
const checkRSVPsForEvent = async (supabase, eventId, userId, phoneNumber, responseContent, shouldSendSMS) => {
  try {
    // Get event details
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, location, notes, status')
      .eq('id', eventId)
      .single();

    if (eventError || !eventData) {
      responseContent = 'Sorry, I couldn\'t find that event. Please try again.';
      shouldSendSMS = true;
      return;
    }

    // Get all invitations for this event with contact details
    const { data: invitations, error: invitationsError } = await supabase
      .from('invitations')
      .select(`
        id,
        status,
        response_note,
        created_at,
        contact_id,
        contacts!inner (
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    console.log('DEBUG: invitations query result:', { invitations, invitationsError });

    // Initialize categorized responses for all cases
    const categorizedResponses = {
      in: { names: [], total: 0, notes: [] },
      out: { names: [], total: 0, notes: [] },
      maybe: { names: [], total: 0, notes: [] },
      no_response: { names: [], total: 0, notes: [] }
    };

    // Format event details
    const eventDate = new Date(`${eventData.event_date}T${eventData.start_time || '00:00:00'}`);
    const formattedDate = eventDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    let rsvpResponse = `📅 ${eventData.title}\n`;
    rsvpResponse += `📍 ${eventData.location || 'Location TBD'}\n`;
    rsvpResponse += `🕐 ${formattedDate}\n`;

    if (eventData.notes) {
      rsvpResponse += `📝 ${eventData.notes}\n`;
    }

    rsvpResponse += '\n';

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      responseContent = 'Sorry, I couldn\'t fetch the RSVP data. Please try again.';
      shouldSendSMS = true;
      console.log('DEBUG: Setting error response:', responseContent);
    } else if (!invitations || invitations.length === 0) {
      console.log('DEBUG: No invitations found for event');
      rsvpResponse += 'No invitations have been sent yet.\n\n';
      rsvpResponse += 'What would you like to do next?\n';
      rsvpResponse += '1. Send invitations to people\n';
      rsvpResponse += '2. Create a new event\n';
      rsvpResponse += '3. Check another event\'s RSVPs';
    } else {
      console.log('DEBUG: Processing invitations:', invitations.length, 'invitations found');

      // Debug: Log each invitation
      invitations.forEach((invitation, index) => {
        console.log(`DEBUG: Invitation ${index + 1}:`, {
          id: invitation.id,
          status: invitation.status,
          response_note: invitation.response_note,
          contact: invitation.contacts
        });
      });

      // Categorize responses
      const categorizedResponses = {
        in: { names: [], total: 0, notes: [] },
        out: { names: [], total: 0, notes: [] },
        maybe: { names: [], total: 0, notes: [] },
        no_response: { names: [], total: 0, notes: [] }
      };

      invitations.forEach(invitation => {
        const contact = invitation.contacts;
        const name = contact ? (contact.last_name ? `${contact.first_name} ${contact.last_name}` : contact.first_name) : 'Unknown';
        const status = invitation.status;

        if (status === 'responded') {
          const responseNote = invitation.response_note?.toLowerCase();
          if (responseNote === 'in' || responseNote === 'yes' || responseNote === '1') {
            categorizedResponses.in.names.push(name);
            categorizedResponses.in.total++;
            if (invitation.response_note && invitation.response_note !== 'in' && invitation.response_note !== 'yes' && invitation.response_note !== '1') {
              categorizedResponses.in.notes.push(`${name}: ${invitation.response_note}`);
            }
          } else if (responseNote === 'out' || responseNote === 'no' || responseNote === '2') {
            categorizedResponses.out.names.push(name);
            categorizedResponses.out.total++;
            if (invitation.response_note && invitation.response_note !== 'out' && invitation.response_note !== 'no' && invitation.response_note !== '2') {
              categorizedResponses.out.notes.push(`${name}: ${invitation.response_note}`);
            }
          } else if (responseNote === 'maybe' || responseNote === '3') {
            categorizedResponses.maybe.names.push(name);
            categorizedResponses.maybe.total++;
            if (invitation.response_note && invitation.response_note !== 'maybe' && invitation.response_note !== '3') {
              categorizedResponses.maybe.notes.push(`${name}: ${invitation.response_note}`);
            }
          }
        } else if (status === 'sent') {
          categorizedResponses.no_response.names.push(name);
          categorizedResponses.no_response.total++;
        }
      });

      // Format categorized responses with 3-name limit + total count
      const formatCategory = (category, label) => {
        if (category.total === 0) return '';

        const names = category.names.slice(0, 3).join(', ');
        const moreCount = category.total - 3;
        const nameDisplay = moreCount > 0 ? `${names}... (${moreCount} more)` : names;

        return `${label}: ${nameDisplay} (${category.total})\n`;
      };

      // Display natural language responses if any
      const hasNaturalLanguage = Object.values(categorizedResponses).some(cat =>
        cat.notes && cat.notes.length > 0
      );

      if (hasNaturalLanguage) {
        rsvpResponse += '📊 RSVP Summary:\n';
        rsvpResponse += formatCategory(categorizedResponses.in, '✅ In');
        rsvpResponse += formatCategory(categorizedResponses.out, '❌ Out');
        rsvpResponse += formatCategory(categorizedResponses.maybe, '❓ Maybe');
        rsvpResponse += formatCategory(categorizedResponses.no_response, '⏳ No Response');

        // Show natural language responses
        const allNotes = Object.values(categorizedResponses)
          .flatMap(cat => cat.notes)
          .slice(0, 5); // Limit to 5 examples

        if (allNotes.length > 0) {
          rsvpResponse += '\n💬 Natural Responses:\n';
          allNotes.forEach(note => {
            rsvpResponse += `• ${note}\n`;
          });
        }
      } else {
        rsvpResponse += '📊 RSVP Summary:\n';
        rsvpResponse += formatCategory(categorizedResponses.in, '✅ In');
        rsvpResponse += formatCategory(categorizedResponses.out, '❌ Out');
        rsvpResponse += formatCategory(categorizedResponses.maybe, '❓ Maybe');
        rsvpResponse += formatCategory(categorizedResponses.no_response, '⏳ No Response');
      }

      // Calculate total headcount
      const totalHeadcount = categorizedResponses.in.total + categorizedResponses.maybe.total;
      if (totalHeadcount > 0) {
        rsvpResponse += `\n👥 Total coming: ${totalHeadcount} people\n`;
      }

      // Add full details link
      rsvpResponse += `\n🔗 Full list: funlet.ai/event/${eventId}\n\n`;

      // Provide next steps options
      rsvpResponse += 'What would you like to do next?\n';
      rsvpResponse += '1. Send reminders to people who haven\'t responded\n';
      rsvpResponse += '2. Invite more people to this event\n';
      rsvpResponse += '3. Check another event\'s RSVPs';
    }

    // Send SMS directly with RSVP response
    console.log('DEBUG: Sending RSVP SMS with content length:', rsvpResponse.length);

    if (phoneNumber) {
      const smsResult = await sendSMS(phoneNumber, rsvpResponse);
      console.log('RSVP SMS sent successfully:', smsResult);
    }

    // Update conversation state and reset extracted data
    await supabase
      .from('conversation_state')
      .update({
        current_event_id: eventId,
        current_state: 'check_rsvps_complete',
        waiting_for: null,
        extracted_data: []
      })
      .eq('user_id', userId);

    // Set response content for API response (but SMS already sent)
    responseContent = 'RSVP data sent via SMS';
    shouldSendSMS = false; // Already sent

  } catch (error) {
    console.error('Error in checkRSVPsForEvent:', error);
    responseContent = 'Failed to check RSVPs. Please try again.';
    shouldSendSMS = true;
    console.log('DEBUG: Error in checkRSVPsForEvent, setting error response');
  }

  console.log('DEBUG: checkRSVPsForEvent completed, responseContent length:', responseContent?.length, 'shouldSendSMS:', shouldSendSMS);
};

// Send message for a specific event with targeting options
const sendMessageForEvent = async (supabase, eventId, userId, phoneNumber, responseContent, shouldSendSMS) => {
  try {
    console.log('DEBUG: sendMessageForEvent called with eventId:', eventId);

    // Get event details
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, location, notes, status')
      .eq('id', eventId)
      .single();

    console.log('DEBUG: Event query result:', { eventData, eventError });

    if (eventError || !eventData) {
      console.error('DEBUG: Event not found or error:', eventError);
      responseContent = 'Sorry, I couldn\'t find that event. Please try again.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, currentState: null };
    }

    // Get all invitations for this event with contact details
    const { data: invitations, error: invitationsError } = await supabase
      .from('invitations')
      .select(`
        id,
        status,
        response_note,
        created_at,
        contact_id
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    console.log('DEBUG: sendMessageForEvent - invitations query result:', { invitations, invitationsError });

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      responseContent = 'Sorry, I couldn\'t fetch the invitation data. Please try again.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, currentState: null };
    }

    // Get contact details for invitations that have contact_id
    const contactIds = invitations
      .map(inv => inv.contact_id)
      .filter(id => id !== null);

    let contactMap = {};
    if (contactIds.length > 0) {
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone_number')
        .in('id', contactIds);

      if (!contactsError && contacts) {
        contactMap = contacts.reduce((acc, contact) => {
          acc[contact.id] = contact;
          return acc;
        }, {});
      }
    }

    // Filter out host invitations and get valid contacts
    const validInvitations = invitations
      .filter(invitation => invitation.contact_id && contactMap[invitation.contact_id])
      .map(invitation => ({
        ...invitation,
        contacts: contactMap[invitation.contact_id]
      }));
    console.log('DEBUG: Valid invitations count:', validInvitations.length);

    if (validInvitations.length === 0) {
      console.log('DEBUG: No valid invitations found');
      responseContent = 'No valid contacts found for this event. Please invite some people first.';
      shouldSendSMS = true;
      return { responseContent, shouldSendSMS, currentState: null };
    }

    // Calculate targeting options
    const targetingOptionsData = {
      everyone: validInvitations.length,
      non_responders: validInvitations.filter(inv => inv.status === 'sent' || (inv.status === 'failed' && inv.response_note === 'no_response')).length,
      coming: validInvitations.filter(inv => inv.response_note === 'in' || inv.response_note === 'yes' || inv.response_note === '1').length,
      maybe: validInvitations.filter(inv => inv.response_note === 'maybe' || inv.response_note === '3').length,
      out: validInvitations.filter(inv => inv.response_note === 'out' || inv.response_note === 'no' || inv.response_note === '2').length
    };

    // Show targeting options
    const targetingOptions = `Who should we message about "${eventData.title}"?\n\n1. Everyone (${targetingOptionsData.everyone} people)\n2. Non-responders (${targetingOptionsData.non_responders} people)\n3. Coming (In!) (${targetingOptionsData.coming} people)\n4. Maybe (${targetingOptionsData.maybe} people)\n5. Can't come (Out) (${targetingOptionsData.out} people)\n\nReply with the number of your choice.`;

    console.log('DEBUG: Setting targeting options, length:', targetingOptions.length);
    responseContent = targetingOptions;
    shouldSendSMS = true;

    // Update conversation state for targeting selection
    console.log('DEBUG: Updating conversation state for targeting selection');
    await supabase
      .from('conversation_state')
      .update({
        current_event_id: eventId,
        current_state: 'send_message_step_2',
        waiting_for: 'targeting_selection',
        extracted_data: [
          {
            action: 'SEND_MESSAGE',
            substep: 2,
            event_id: eventId,
            event_title: eventData.title,
            event_date: eventData.event_date,
            event_time: eventData.start_time,
            event_location: eventData.location,
            available_invitations: validInvitations.map(inv => ({
              id: inv.id,
              status: inv.status,
              response_note: inv.response_note,
              contacts: inv.contacts
            })),
            targeting_options: targetingOptionsData
          }
        ]
      })
      .eq('user_id', userId);

    console.log('DEBUG: Conversation state updated successfully');

    // Get the updated current state to return
    const { data: updatedState } = await supabase
      .from('conversation_state')
      .select('current_state, waiting_for, extracted_data')
      .eq('user_id', userId)
      .single();

    return { responseContent, shouldSendSMS, currentState: updatedState };

  } catch (error) {
    console.error('Error in sendMessageForEvent:', error);
    responseContent = 'Failed to process message targeting. Please try again.';
    shouldSendSMS = true;
    return { responseContent, shouldSendSMS, currentState: null };
  }
};

Deno.serve(async (req) => {
  const startTime = Date.now();
  console.log(`🚀 [${new Date().toISOString()}] Request started`);
  
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
    const parseTime = Date.now();
    const { message, phone_number, model = 'gpt-4o-mini', is_host = true } = await req.json();
    console.log(`📝 [${Date.now() - startTime}ms] Request parsed`);

    // Initialize response variables early
    let responseContent = '';
    let shouldSendSMS = false;

    // Validate input
    if (!message) {
      return new Response(JSON.stringify({
        error: 'Message is required'
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

    // Get assistant ID from constants table
    const { data: constantData, error: constantError } = await supabase
      .from('constants')
      .select('value')
      .eq('key', 'assistant_id')
      .single();

    if (constantError || !constantData) {
      return new Response(JSON.stringify({
        error: 'Assistant not found. Please create an assistant first.'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const assistantId = constantData.value;
    console.log('Using assistant ID:', assistantId);

    // Get or create thread for the user with 2-hour context window
    let threadId = null;
    let shouldCreateNewThread = false;
    let isFirstTimeUser = false;
    let userId = null;

    // Check if this is a first-time user BEFORE processing the message
    if (phone_number) {
      const normalizedPhone = phone_number.replace(/\D/g, '');
      console.log('Looking up user for phone:', normalizedPhone);
      
      // Create multiple phone number variations to search for (same as handle-sms-response)
      const phoneVariations = [];
      
      // Original formatted phone (e.g., "18777804236")
      phoneVariations.push(normalizedPhone);
      
      // If it's 11 digits and starts with 1, also try without the leading 1 (e.g., "8777804236")
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      
      // If it's 10 digits, also try with leading 1 (e.g., "18777804236")
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      
      // Add + prefix variations for all existing variations
      const plusVariations = phoneVariations.map(phone => '+' + phone);
      phoneVariations.push(...plusVariations);
      
      console.log('Phone variations to search:', phoneVariations);
      
      // Optimized: Try all phone variations in a single query using OR conditions
      let existingProfile = null;
      let profileError = null;
      let foundPhoneVariation = null;
      
      console.log('Searching for profile with phone variations:', phoneVariations);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, subscription_status, is_onboarded, phone_number')
        .in('phone_number', phoneVariations)
        .limit(1);
      
      if (data && data.length > 0 && !error) {
        existingProfile = data[0];
        foundPhoneVariation = existingProfile.phone_number;
        console.log('Found profile with phone variation:', foundPhoneVariation);
      } else {
        console.log('No profile found for any phone variation');
      }

      if (existingProfile) {
        userId = existingProfile.id;
        console.log('Found user:', userId, 'with plan:', existingProfile.subscription_status, 'is_onboarded:', existingProfile.is_onboarded, 'using phone:', foundPhoneVariation);
        
        // Check if user is not onboarded - force them into onboarding
        if (existingProfile.is_onboarded === false) {
          isFirstTimeUser = true;
          console.log('User not onboarded (is_onboarded = false), forcing onboarding');
        } else {
          // User is onboarded, check if they have conversation history
        const { data: conversationHistory } = await supabase
          .from('conversation_state')
          .select('id, last_action')
          .eq('phone_number', foundPhoneVariation)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!conversationHistory || conversationHistory.length === 0) {
            // Even if no conversation history, don't force onboarding for onboarded users
            isFirstTimeUser = false;
            console.log('Onboarded user with no conversation history - not forcing onboarding');
        } else {
            console.log('Onboarded user with conversation history found');
          }
        }
      } else {
        console.log('No existing user found for any phone variation:', phoneVariations);
        isFirstTimeUser = true;
        console.log('First-time user detected - no profile found');
      }
      
      // Also check if there's any conversation history for any phone variation
      // But only if user is NOT onboarded (is_onboarded = false or null)
      // NEVER force onboarded users into onboarding flow regardless of conversation history
      if (!isFirstTimeUser && foundPhoneVariation && existingProfile && existingProfile.is_onboarded !== true) {
        const { data: anyConversationHistory } = await supabase
          .from('conversation_state')
          .select('id')
          .eq('phone_number', foundPhoneVariation)
          .limit(1);
        
        if (!anyConversationHistory || anyConversationHistory.length === 0) {
          isFirstTimeUser = true;
          console.log('First-time user detected - no conversation history for phone number');
        }
      }
    }
    
    if (phone_number) {
      // Use the same phone variation approach for conversation state lookup
      const normalizedPhone = phone_number.replace(/\D/g, '');
      const phoneVariations = [];
      phoneVariations.push(normalizedPhone);
      
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        phoneVariations.push(normalizedPhone.substring(1));
      }
      
      if (normalizedPhone.length === 10) {
        phoneVariations.push('1' + normalizedPhone);
      }
      
      // Optimized: Try all phone variations in a single query
      let conversationState = null;
      const { data } = await supabase
        .from('conversation_state')
        .select('thread_id, thread_created_at, expires_at, phone_number, current_state')
        .in('phone_number', phoneVariations)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (data && data.length > 0) {
        conversationState = data[0];
        console.log('Found conversation state for phone:', conversationState.phone_number);
      }
      
      if (conversationState?.thread_id) {
        // Check if user is in onboarding - if so, don't expire thread
        const isInOnboarding = conversationState.current_state?.startsWith('onboarding_');
        
        if (isInOnboarding) {
          // Keep existing thread during onboarding
          threadId = conversationState.thread_id;
          console.log('User in onboarding, keeping existing thread:', threadId);
        } else {
          // Check if thread has expired (2 hours) - only for non-onboarding users
          const now = new Date();
          const threadCreatedAt = conversationState.thread_created_at ? new Date(conversationState.thread_created_at) : null;
          const expiresAt = conversationState.expires_at ? new Date(conversationState.expires_at) : null;
          
          // If thread is older than 2 hours or conversation state has expired, create new thread
          if (threadCreatedAt && (now.getTime() - threadCreatedAt.getTime() > 2 * 60 * 60 * 1000)) {
            console.log('Thread expired (older than 2 hours), will create new thread');
            shouldCreateNewThread = true;
            
            // Delete the old thread from OpenAI
            try {
              await fetch(`https://api.openai.com/v1/threads/${conversationState.thread_id}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                  'OpenAI-Beta': 'assistants=v2'
                }
              });
              console.log('Deleted expired thread:', conversationState.thread_id);
            } catch (error) {
              console.error('Error deleting expired thread:', error);
            }
          } else if (expiresAt && now > expiresAt) {
            console.log('Conversation state expired, will create new thread');
            shouldCreateNewThread = true;
          } else {
            threadId = conversationState.thread_id;
            console.log('Using existing thread:', threadId);
          }
        }
      } else {
        shouldCreateNewThread = true;
      }
    } else {
      shouldCreateNewThread = true;
    }

    if (!threadId || shouldCreateNewThread) {
      const threadResponse = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({})
      });

      if (!threadResponse.ok) {
        const errorText = await threadResponse.text();
        console.error('OpenAI Thread Creation Error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to create thread',
          details: errorText
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const threadData = await threadResponse.json();
      threadId = threadData.id;
      console.log('Created new thread:', threadId);
      
      // Store thread creation time for 2-hour context window
      const threadCreatedAt = new Date().toISOString();
    }

    // EMERGENCY ESCAPE COMMANDS - Execute before AI classification
    const cleanMessage = message.toLowerCase().trim();
    
 

    // Handle reset confirmation responses
    const { data: resetState } = await supabase
          .from('conversation_state')
          .select('waiting_for')
          .eq('user_id', userId)
          .single();
        
    if (resetState?.waiting_for === 'reset_confirmation') {
      if (cleanMessage === 'yes') {
        // User confirmed reset - execute full reset
        console.log('RESET confirmed by user, executing full reset...');
          
          // Get current thread ID before deletion
          const { data: stateData } = await supabase
            .from('conversation_state')
            .select('thread_id')
            .eq('user_id', userId)
            .single();
          
          const currentThreadId = stateData?.thread_id;
          
          // Delete OpenAI thread if it exists
          if (currentThreadId) {
            try {
              const deleteResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                  'OpenAI-Beta': 'assistants=v2'
                }
              });
              
              if (deleteResponse.ok) {
                console.log('OpenAI thread deleted successfully:', currentThreadId);
              } else {
                console.log('OpenAI thread deletion failed, continuing with reset:', await deleteResponse.text());
              }
            } catch (threadError) {
              console.error('Error deleting OpenAI thread, continuing with reset:', threadError);
            }
          }
          
          // Delete conversation state
          await supabase
            .from('conversation_state')
            .delete()
            .eq('user_id', userId);
          
          // Create new OpenAI thread
          const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
              'Content-Type': 'application/json',
              'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({})
          });

          if (!threadResponse.ok) {
            const errorText = await threadResponse.text();
            console.error('Failed to create OpenAI thread:', errorText);
            throw new Error('Failed to create new thread');
          }

          const threadData = await threadResponse.json();
          const newThreadId = threadData.id;
          
          // Create new conversation state
          const { data: newState, error: insertError } = await supabase
            .from('conversation_state')
            .insert({
              user_id: userId,
              phone_number: phone_number,
              thread_id: newThreadId,
              current_state: 'normal',
              thread_created_at: new Date().toISOString(),
              last_action: 'RESET_COMMAND',
              last_action_timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (insertError) {
            throw insertError;
          }
          
          const resetResponse = 'Reset complete. What would you like to do?';
          
          // Send SMS response
          if (phone_number) {
            const smsResult = await sendSMS(phone_number, resetResponse);
            console.log('RESET SMS sent successfully:', smsResult);
          }
          
          console.log('RESET: Complete reset executed for user:', userId, 'with new thread:', newThreadId);
          
          return new Response(JSON.stringify({
            action: 'RESET',
            content: resetResponse,
            success: true,
            new_thread_id: newThreadId
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } else {
        // User cancelled reset
        console.log('RESET cancelled by user');
        
          await supabase
            .from('conversation_state')
            .update({
            waiting_for: null,
            last_action: 'RESET_CANCELLED',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
        const cancelResponse = 'Reset cancelled.';
          
          // Send SMS response
          if (phone_number) {
          const smsResult = await sendSMS(phone_number, cancelResponse);
          console.log('RESET cancellation SMS sent successfully:', smsResult);
          }
          
          return new Response(JSON.stringify({
          action: 'RESET_CANCELLED',
          content: cancelResponse,
            success: true
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
    }

    // Get conversation context before adding message to thread
    let conversationContext = '';
    let userOnboardedStatus = false;
    let currentState = null;
    
    if (userId) {
      // Get user's onboarded status
      const { data: profileData } = await supabase
        .from('profiles')
        .select('is_onboarded')
        .eq('id', userId)
        .single();
      
      userOnboardedStatus = profileData?.is_onboarded || false;
      
      // Get current conversation state with extracted_data
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('current_state, onboarding_step, waiting_for, last_action, last_action_timestamp, extracted_data')
        .eq('user_id', userId)
        .single();
      
      currentState = currentStateData;
      
      console.log('DEBUG: currentState from database:', JSON.stringify(currentState, null, 2));
   // Handle "cancel" command - immediate execution
   if ( userOnboardedStatus && cleanMessage === 'exit') {
    console.log('EMERGENCY CANCEL command detected, clearing workflow state...');
    
    try {
      // Log system command
      await supabase.from('sms_log').insert({
        user_id: userId,
        phone_number: phone_number,
        direction: 'inbound',
        message_type: 'system_command',
        content: message,
        timestamp: new Date().toISOString()
      });
      
      // Clear workflow-specific state, keep thread and history
      await supabase
        .from('conversation_state')
        .update({
          waiting_for: null,
          current_state: 'normal',
          extracted_data: null,
          last_action: 'CANCEL_COMMAND',
          last_action_timestamp: new Date().toISOString()
        })
        .eq('user_id', userId);
      
      const cancelResponse = 'Cancelled. What would you like to do?';
      
      // Send SMS response
      if (phone_number) {
        const smsResult = await sendSMS(phone_number, cancelResponse);
        console.log('CANCEL SMS sent successfully:', smsResult);
      }
      
      console.log('CANCEL: Cleared workflow state for user:', userId);
      
      return new Response(JSON.stringify({
        action: 'CANCEL',
        content: cancelResponse,
        success: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
      } catch (error) {
      console.error('Error executing cancel command:', error);
        return new Response(JSON.stringify({
        action: 'CANCEL',
        content: 'Failed to cancel. Please try again.',
          success: false,
          error: error.message
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }

  // Handle "reset" command - with confirmation flow
  if (cleanMessage === 'reset') {
    console.log('EMERGENCY RESET command detected, starting confirmation flow...');
    
    try {
      // Log system command
      await supabase.from('sms_log').insert({
        user_id: userId,
        phone_number: phone_number,
        direction: 'inbound',
        message_type: 'system_command',
        content: message,
        timestamp: new Date().toISOString()
      });
      
      // Check if already in reset confirmation
      const { data: currentState } = await supabase
      .from('conversation_state')
      .select('waiting_for')
      .eq('user_id', userId)
      .single();
    
      if (currentState?.waiting_for === 'reset_confirmation') {
        // User is confirming reset with 'yes' or treating 'reset' as confirmation
        console.log('RESET confirmation detected, executing full reset...');
        
        // Get current thread ID before deletion
        const { data: stateData } = await supabase
          .from('conversation_state')
          .select('thread_id')
          .eq('user_id', userId)
          .single();
        
        const currentThreadId = stateData?.thread_id;
        
        // Delete OpenAI thread if it exists
        if (currentThreadId) {
          try {
            const deleteResponse = await fetch(`https://api.openai.com/v1/threads/${currentThreadId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            });
            
            if (deleteResponse.ok) {
              console.log('OpenAI thread deleted successfully:', currentThreadId);
            } else {
              console.log('OpenAI thread deletion failed, continuing with reset:', await deleteResponse.text());
            }
          } catch (threadError) {
            console.error('Error deleting OpenAI thread, continuing with reset:', threadError);
          }
        }
        
        // Delete conversation state
        await supabase
          .from('conversation_state')
          .delete()
          .eq('user_id', userId);
        
        // Create new OpenAI thread
        const threadResponse = await fetch('https://api.openai.com/v1/threads', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({})
        });

        if (!threadResponse.ok) {
          const errorText = await threadResponse.text();
          console.error('Failed to create OpenAI thread:', errorText);
          throw new Error('Failed to create new thread');
        }

        const threadData = await threadResponse.json();
        const newThreadId = threadData.id;
        
        // Create new conversation state
        const { data: newState, error: insertError } = await supabase
          .from('conversation_state')
          .insert({
            user_id: userId,
            phone_number: phone_number,
            thread_id: newThreadId,
            current_state: 'normal',
            thread_created_at: new Date().toISOString(),
            last_action: 'RESET_COMMAND',
            last_action_timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (insertError) {
          throw insertError;
        }
        
        const resetResponse = 'Reset complete. What would you like to do?';
        
        // Send SMS response
        if (phone_number) {
          const smsResult = await sendSMS(phone_number, resetResponse);
          console.log('RESET SMS sent successfully:', smsResult);
        }
        
        console.log('RESET: Complete reset executed for user:', userId, 'with new thread:', newThreadId);
        
        return new Response(JSON.stringify({
          action: 'RESET',
          content: resetResponse,
          success: true,
          new_thread_id: newThreadId
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } else {
        // Start reset confirmation flow
        await supabase
          .from('conversation_state')
          .update({
            waiting_for: 'reset_confirmation',
            last_action: 'RESET_CONFIRMATION_PROMPT',
            last_action_timestamp: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        const resetPrompt = 'This will clear all conversation history and start fresh. Reply \'yes\' to confirm or anything else to cancel.';
        
        // Send SMS response
        if (phone_number) {
          const smsResult = await sendSMS(phone_number, resetPrompt);
          console.log('RESET confirmation SMS sent successfully:', smsResult);
        }
        
        console.log('RESET: Confirmation prompt sent for user:', userId);
        
        return new Response(JSON.stringify({
          action: 'RESET_CONFIRMATION',
          content: resetPrompt,
          success: true
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error) {
      console.error('Error executing reset command:', error);
      return new Response(JSON.stringify({
        action: 'RESET',
        content: 'Failed to reset. Please try again.',
        success: false,
        error: error.message
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
      
      // Handle crew member addition after crew selection
      if (currentState?.waiting_for === 'crew_member_info' && !userOnboardedStatus) {
        // User is providing member information after selecting a crew
        const crewData = currentState.extracted_data?.[0];
        if (crewData?.crew_id && crewData?.crew_name) {
          // Extract member info from message using flexible pattern
          const memberMatch = message.match(/([a-zA-Z]+)\s*\+?1?(\d{9,11})/);
          if (memberMatch) {
            const memberName = memberMatch[1];
            let memberPhone = memberMatch[2];
            
            // Format phone number properly
            if (memberPhone.length === 9) {
              // Add leading 1 for 9-digit numbers
              memberPhone = '+1' + memberPhone;
            } else if (memberPhone.length === 10) {
              // Add +1 prefix for 10-digit numbers
              memberPhone = '+1' + memberPhone;
            } else if (memberPhone.length === 11 && memberPhone.startsWith('1')) {
              // Already has country code, just add +
              memberPhone = '+' + memberPhone;
            } else {
              // Default format
              memberPhone = '+1' + memberPhone;
            }
            
            // Show confirmation before adding member
            const confirmationMessage = `Add ${memberName} (${memberPhone}) to ${crewData.crew_name}? Reply 'yes' to confirm or 'no' to cancel.`;
            
            // Update conversation state with member confirmation data
            await supabase
              .from('conversation_state')
              .update({
                extracted_data: [{
                  crew_id: crewData.crew_id,
                  crew_name: crewData.crew_name,
                  member_name: memberName,
                  member_phone: memberPhone,
                  action: 'MEMBER_CONFIRMATION_PROMPT',
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
            
            // Send confirmation SMS
            if (phone_number) {
              const smsResult = await sendSMS(phone_number, confirmationMessage);
              console.log('Member confirmation SMS result:', smsResult);
            }
            
            return new Response(JSON.stringify({
              action: 'MEMBER_CONFIRMATION_PROMPT',
              content: confirmationMessage,
              crew_id: crewData.crew_id,
              crew_name: crewData.crew_name,
              member_name: memberName,
              member_phone: memberPhone
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            // Send invalid format message via SMS
            const invalidFormatMessage = `Please provide member information in the correct format: "[name] [phone number]" (e.g., "Andy 4155551234")`;
            if (phone_number) {
              const smsResult = await sendSMS(phone_number, invalidFormatMessage);
              console.log('Invalid format SMS result:', smsResult);
            }
            
            return new Response(JSON.stringify({
              action: 'INVALID_MEMBER_FORMAT',
              content: invalidFormatMessage
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } else {
          // Send crew data missing message via SMS
          const missingDataMessage = 'Crew information missing. Please start over by saying "add members".';
          if (phone_number) {
            const smsResult = await sendSMS(phone_number, missingDataMessage);
            console.log('Missing crew data SMS result:', smsResult);
          }
          
          return new Response(JSON.stringify({
            action: 'CREW_DATA_MISSING',
            content: missingDataMessage
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
      
      // Handle crew selection for CHECK_CREW_MEMBERS
      if (currentState?.waiting_for === 'crew_selection_for_check_members') {
        // User is responding to crew selection prompt for checking members
        const storedCrewList = currentState.extracted_data?.[currentState.extracted_data.length - 1]?.crew_list;
        
        if (storedCrewList && Array.isArray(storedCrewList) && storedCrewList.length > 0) {
          // Check for "Create Crew" exit command first
          if (message.toLowerCase().includes('create crew')) {
            // Clear conversation state and let user create a new crew
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                last_action: 'EXIT_TO_CREATE_CREW',
                last_action_timestamp: new Date().toISOString()
              })
              .eq('user_id', userId);

            responseContent = 'What should we name your crew?';
            shouldSendSMS = true;
          } else {
          let selectedCrew = null;
          
          // Check if user provided a number
          const crewNumber = parseInt(message.trim());
          if (!isNaN(crewNumber) && crewNumber > 0 && crewNumber <= storedCrewList.length) {
            selectedCrew = storedCrewList[crewNumber - 1];
          } else {
            // Check if user provided a crew name
            selectedCrew = storedCrewList.find(crew => 
              crew.name.toLowerCase().includes(message.toLowerCase()) || 
              message.toLowerCase().includes(crew.name.toLowerCase())
            );
          }
          
          if (selectedCrew) {
            // Clear the waiting state and show crew members
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                last_action: 'CREW_MEMBERS_CHECKED',
                last_action_timestamp: new Date().toISOString()
              })
              .eq('user_id', userId);
            
            // Get crew members with contact details
            const { data: crewMembers } = await supabase
              .from('crew_members')
              .select(`
                role,
                contacts (
                  first_name,
                  last_name,
                  phone_number
                )
              `)
              .eq('crew_id', selectedCrew.id);
            
            let membersMessage;
            if (crewMembers && crewMembers.length > 0) {
              const totalMembers = crewMembers.length;
              const crewDisplayName = selectedCrew.name;
              
              if (totalMembers <= 5) {
                // Show all names for ≤5 members
                const memberNames = crewMembers.map(member => {
                  const contact = member.contacts;
                  return contact.last_name ? 
                    `${contact.first_name} ${contact.last_name}` : 
                    contact.first_name;
                });
                
                membersMessage = `${crewDisplayName} (${totalMembers}): ${memberNames.join(', ')}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
              } else {
                // Show first 5 + link for >5 members
                const firstFiveNames = crewMembers.slice(0, 5).map(member => {
                  const contact = member.contacts;
                  return contact.last_name ? 
                    `${contact.first_name} ${contact.last_name}` : 
                    contact.first_name;
                });
                
                membersMessage = `${crewDisplayName}: ${firstFiveNames.join(', ')}... (${totalMembers} total). Full list: funlet.ai/crew/${selectedCrew.id}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
              }
            } else {
              membersMessage = `${selectedCrew.name} has no members yet. Add some by saying "add members".`;
            }
            
            // Send SMS with crew members list
            if (phone_number) {
              const smsResult = await sendSMS(phone_number, membersMessage);
              console.log('Crew members list SMS result:', smsResult);
            }
            
            // Update conversation state - clear extracted_data and save crew info for future actions
            await supabase
              .from('conversation_state')
              .upsert({
                user_id: userId,
                phone_number: phone_number.replace(/\D/g, ''),
                thread_id: threadId,
                current_state: 'normal',
                waiting_for: null,
                last_action: 'CHECK_CREW_MEMBERS',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: [{
                  crew_id: selectedCrew.id,
                  crew_name: selectedCrew.name,
                  member_count: crewMembers ? crewMembers.length : 0,
                  action: 'CREW_MEMBERS_SHOWN',
                  timestamp: new Date().toISOString()
                }]
              }, {
                onConflict: 'user_id'
              });

            return new Response(JSON.stringify({
              action: 'CREW_MEMBERS_CHECKED',
              content: membersMessage,
              crew_id: selectedCrew.id,
              crew_name: selectedCrew.name,
              members_count: crewMembers ? crewMembers.length : 0
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          } else {
            return new Response(JSON.stringify({
              action: 'CREW_SELECTION_ERROR',
                content: `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
            }
          }
        } else {
          return new Response(JSON.stringify({
            action: 'CREW_SELECTION_ERROR',
            content: 'Error retrieving crews. Please try again.'
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      // Handle crew selection for ADD_CREW_MEMBERS
      else if (currentState?.waiting_for === 'crew_selection_for_members') {
        // Check for "Create Crew" exit command first
        if (message.toLowerCase().includes('create crew')) {
          // Clear conversation state and let user create a new crew
          await supabase
            .from('conversation_state')
            .update({
              waiting_for: null,
              last_action: 'EXIT_TO_CREATE_CREW',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
          responseContent = 'What should we name your crew?';
          shouldSendSMS = true;
        } else {
        // User is responding to crew selection prompt - use stored crew list from conversation state
        const storedCrewList = currentState.extracted_data?.[currentState.extracted_data.length - 1]?.crew_list;
        
        if (storedCrewList && Array.isArray(storedCrewList) && storedCrewList.length > 0) {
          let selectedCrew = null;
          
          // Check if user provided a number
          const crewNumber = parseInt(message.trim());
          if (!isNaN(crewNumber) && crewNumber > 0 && crewNumber <= storedCrewList.length) {
            selectedCrew = storedCrewList[crewNumber - 1];
          } else {
            // Check if user provided a crew name
            selectedCrew = storedCrewList.find(crew => 
              crew.name.toLowerCase().includes(message.toLowerCase()) || 
              message.toLowerCase().includes(crew.name.toLowerCase())
            );
          }
          
          if (selectedCrew) {
            // Clear the waiting state and prompt for member info
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: null,
                last_action: 'CREW_SELECTED',
                last_action_timestamp: new Date().toISOString()
              })
              .eq('user_id', userId);
            
            // Store the selected crew_id in conversation state for next message
              const { data: currentStateData } = await supabase
              .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
              const updatedExtractedData = [...existingData, {
                  action: 'CREW_SELECTED',
                  crew_id: selectedCrew.id,
                  crew_name: selectedCrew.name,
                  timestamp: new Date().toISOString()
              }];
              
              await supabase
                .from('conversation_state')
                .update({
                  waiting_for: 'crew_member_addition',
                  extracted_data: updatedExtractedData
              })
              .eq('user_id', userId);

              // Send SMS confirmation to user with new message format
              const confirmationMessage = `Add members to ${selectedCrew.name} by texting member info (eg. Tom 4155551234). When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
            if (phone_number) {
              const smsResult = await sendSMS(phone_number, confirmationMessage);
              console.log('Crew selection confirmation SMS result:', smsResult);
            }

            return new Response(JSON.stringify({
              action: 'CREW_SELECTED',
              content: confirmationMessage,
              crew_id: selectedCrew.id,
              crew_name: selectedCrew.name
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          } else {
              responseContent = `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
              shouldSendSMS = true;
          }
        } else {
            responseContent = 'Error retrieving crews. Please try again.';
            shouldSendSMS = true;
          }
        }
      }

      // Get last 2 user actions
      const { data: recentActions } = await supabase
        .from('user_actions')
        .select('action, created_at, metadata')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(2);

      // Build context string with onboarded status
      conversationContext += `User Status: ${userOnboardedStatus ? 'ONBOARDED' : 'NOT_ONBOARDED'}\n`;
      
      // Add specific instructions for onboarded users
      if (userOnboardedStatus) {
        conversationContext += '\nIMPORTANT: This user is ONBOARDED. DO NOT return any onboarding actions (ONBOARDING_START, ONBOARDING_CONTINUE, ONBOARDING_STEP_*).\n';
        conversationContext += 'Only return single actions like CREATE_CREW, ADD_CREW_MEMBERS, SEND_INVITATIONS, CHECK_CREW_MEMBERS, etc.\n';
        conversationContext += 'Review the current message and context, then return the appropriate single action based on what the user is trying to do.\n';
      }
      
      if (currentState) {
        conversationContext += `Current conversation state: ${currentState.current_state}`;
        if (currentState.onboarding_step) {
          conversationContext += ` (step ${currentState.onboarding_step})`;
        }
        if (currentState.waiting_for) {
          conversationContext += `, waiting for: ${currentState.waiting_for}`;
          
          // Add explicit confirmation context for crew creation
          if (currentState.waiting_for === 'crew_creation_confirmation') {
            conversationContext += '\nIMPORTANT: User is in crew creation confirmation state.';
            conversationContext += '\n- "yes" responses should return CREW_CONFIRMATION_YES';
            conversationContext += '\n- "no" responses should return CREW_CONFIRMATION_NO';
            conversationContext += '\n- Unclear responses should return CREW_CONFIRMATION_CLARIFY';
          }
          
          // Add explicit context for member adding mode
          if (currentState.waiting_for === 'member_adding_mode') {
            conversationContext += '\nIMPORTANT: User is in member adding mode after creating a crew.';
            conversationContext += '\n- Member info (name + phone) should return ADD_CREW_MEMBERS';
            conversationContext += '\n- "Create Event" should return SEND_INVITATIONS';
            conversationContext += '\n- "Sync Up" should return SYNC_UP';
            conversationContext += '\n- "exit" should return EXIT';
            conversationContext += '\n- Unrecognized messages should return ADD_CREW_MEMBERS with invalid_message: true';
          }
          
          // Add explicit context for crew name input
          if (currentState.waiting_for === 'crew_name_input') {
            conversationContext += '\nIMPORTANT: User is providing a crew name after being asked.';
            conversationContext += '\n- Extract the crew name from the message and return CREATE_CREW with crew_name in extractedParams';
            conversationContext += '\n- The user is responding to "What would you like to name your crew?"';
          }
          
          // Add explicit confirmation context for member addition
          if (currentState.waiting_for === 'member_confirmation') {
            conversationContext += '\nIMPORTANT: User is in member addition confirmation state.';
            conversationContext += '\n- "yes" responses should return MEMBER_CONFIRMATION_YES';
            conversationContext += '\n- "no" responses should return MEMBER_CONFIRMATION_NO';
            conversationContext += '\n- Unclear responses should return MEMBER_CONFIRMATION_CLARIFY';
          }
          
          // Add explicit confirmation context for SEND_INVITATIONS
          if (currentState.waiting_for === 'send_invitations_confirmation' || currentState.current_state === 'send_invitations_step_5') {
            conversationContext += '\nIMPORTANT: User is in SEND_INVITATIONS confirmation state.';
            
            // Get event details from extracted_data to provide context
            let eventDetails = {};
            if (currentState.extracted_data && Array.isArray(currentState.extracted_data)) {
              for (const item of currentState.extracted_data) {
                if (item.action === 'SEND_INVITATIONS_STEP_1' || item.action === 'SEND_INVITATIONS_STEP_2' || item.action === 'SEND_INVITATIONS') {
                  if (item.crew_name) eventDetails.crew_name = item.crew_name;
                  if (item.event_name) eventDetails.event_name = item.event_name;
                  if (item.event_date) eventDetails.event_date = item.event_date;
                  if (item.event_time) eventDetails.event_time = item.event_time;
                  if (item.event_location) eventDetails.event_location = item.event_location;
                  if (item.event_notes !== undefined) eventDetails.event_notes = item.event_notes;
                }
              }
            }
            
            if (Object.keys(eventDetails).length > 0) {
              conversationContext += `\n- Event details: ${JSON.stringify(eventDetails)}`;
              conversationContext += '\n- "yes" responses should return: {"action": "SEND_INVITATIONS", "substep": 6, "extractedParams": ' + JSON.stringify({...eventDetails, confirm: true, yes: true}) + '}';
              conversationContext += '\n- "no" responses should return: {"action": "SEND_INVITATIONS", "substep": 6, "extractedParams": ' + JSON.stringify({...eventDetails, confirm: false, no: true}) + '}';
            } else {
              conversationContext += '\n- "yes" responses should return: {"action": "SEND_INVITATIONS", "substep": 6, "extractedParams": {"confirm": true, "yes": true}}';
              conversationContext += '\n- "no" responses should return: {"action": "SEND_INVITATIONS", "substep": 6, "extractedParams": {"confirm": false, "no": true}}';
            }
            
            // Get member details from extracted_data
            const latestExtractedData = currentState.extracted_data?.[currentState.extracted_data.length - 1];
            if (latestExtractedData?.action === 'MEMBER_CONFIRMATION_PROMPT') {
              const members = latestExtractedData.members || [];
              if (members.length > 0) {
                const memberList = members.map(m => `${m.name} (${m.phone})`).join(', ');
                conversationContext += `\n- Members: ${memberList}`;
                conversationContext += `\n- Crew: ${latestExtractedData.crew_name} (ID: ${latestExtractedData.crew_id})`;
              }
            }
          }
          
          // Add explicit confirmation context for INVITE_MORE_PEOPLE
          if (currentState.waiting_for === 'invitation_confirmation') {
            conversationContext += '\nIMPORTANT: User is in INVITE_MORE_PEOPLE confirmation state.';
            
            // Extract all relevant data from the conversation context
            let eventId = null;
            let eventTitle = '';
            let eventDate = '';
            let eventTime = '';
            let eventLocation = '';
            let crewId = null;
            let crewName = '';
            let contacts = [];
            
            // Get data from extracted_data
            if (currentState.extracted_data && Array.isArray(currentState.extracted_data)) {
              for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
                const item = currentState.extracted_data[i];
                if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                  eventId = item.event_id;
                  eventTitle = item.event_title;
                  eventDate = item.event_date;
                  eventTime = item.event_time;
                  eventLocation = item.event_location;
                } else if (item.action === 'INVITE_MORE_PEOPLE_STEP_4' && item.contacts) {
                  contacts = item.contacts || [];
                } else if (item.crew_id) {
                  crewId = item.crew_id;
                  crewName = item.crew_name;
                }
              }
            }
            
            // Also check current extractedParams for missing data
            if (extractedParams) {
              if (extractedParams.event_id && !eventId) eventId = extractedParams.event_id;
              if (extractedParams.event_title && !eventTitle) eventTitle = extractedParams.event_title;
              if (extractedParams.event_date && !eventDate) eventDate = extractedParams.event_date;
              if (extractedParams.event_time && !eventTime) eventTime = extractedParams.event_time;
              if (extractedParams.event_location && !eventLocation) eventLocation = extractedParams.event_location;
              if (extractedParams.crew_id && !crewId) crewId = extractedParams.crew_id;
              if (extractedParams.crew_name && !crewName) crewName = extractedParams.crew_name;
              if (extractedParams.contacts && !contacts.length) contacts = extractedParams.contacts;
            }
            
            // Build the complete response structure with all available data
            const responseData = {
              action: "INVITE_MORE_PEOPLE_STEP_5",
              extractedParams: {
                confirm: true,
                yes: true,
                event_id: eventId,
                event_title: eventTitle,
                event_date: eventDate,
                event_time: eventTime,
                event_location: eventLocation,
                crew_id: crewId,
                crew_name: crewName,
                contacts: contacts
              }
            };
            
            conversationContext += '\n- "yes" responses should return: ' + JSON.stringify(responseData);
            conversationContext += '\n- "no" responses should return: {"action": "INVITE_MORE_PEOPLE_STEP_5", "extractedParams": {"confirm": false, "no": true}}';

            if (contacts.length > 0) {
              const contactList = contacts.map(c => `${c.name} (${c.phone})`).join(', ');
              conversationContext += `\n- Contacts to invite: ${contactList}`;
            }
            if (eventTitle) {
              conversationContext += `\n- Event: ${eventTitle} at ${eventLocation}`;
            }
          }

          // Add explicit confirmation context for member addition based on extracted_data
          const latestExtractedData = currentState.extracted_data?.[currentState.extracted_data.length - 1];
          console.log('DEBUG: latestExtractedData:', JSON.stringify(latestExtractedData, null, 2));
          if (latestExtractedData?.action === 'MEMBER_CONFIRMATION_PROMPT') {
            console.log('DEBUG: Detected MEMBER_CONFIRMATION_PROMPT in extracted_data:', latestExtractedData);
            conversationContext += '\nIMPORTANT: User is in member addition confirmation state.';
            conversationContext += '\n- "yes" responses should return MEMBER_CONFIRMATION_YES';
            conversationContext += '\n- "no" responses should return MEMBER_CONFIRMATION_NO';
            conversationContext += '\n- Unclear responses should return MEMBER_CONFIRMATION_CLARIFY';
            const members = latestExtractedData.members || [];
            if (members.length > 0) {
              const memberList = members.map(m => `${m.name} (${m.phone})`).join(', ');
              conversationContext += `\n- Members: ${memberList}`;
              conversationContext += `\n- Crew: ${latestExtractedData.crew_name} (ID: ${latestExtractedData.crew_id})`;
            }
          }


          // Add explicit context for event selection in CHECK_RSVPS
          if (currentState.waiting_for === 'event_selection') {
            conversationContext += '\nIMPORTANT: User is in event selection state for CHECK_RSVPS.';
            conversationContext += '\n- User needs to select an event by number (1, 2, 3, etc.)';
            conversationContext += '\n- Extract the selected event number and return it as: {"action": "CHECK_RSVPS", "extractedParams": {"event_id": <actual_uuid_from_mapping>}}';
            conversationContext += '\n- If user responds with just a number like "1", "2", "3", this is event selection, NOT next step selection';

            // Get available events from extracted_data
            const availableEvents = currentState.extracted_data?.[0]?.available_events || [];
            if (availableEvents.length > 0) {
              const eventsList = availableEvents.map((event, index) =>
                `${index + 1}. ${event.title} (ID: ${event.id})`
              ).join(', ');
              conversationContext += `\n- Available events: ${eventsList}`;
              conversationContext += '\n- Event ID mapping (use the actual UUID, not the number):';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  ${index + 1} → ${event.id}`;
              });
              conversationContext += '\n- CRITICAL: When user selects a number, return the corresponding UUID from the mapping above';
              conversationContext += '\n- EXAMPLE: If user says "1" and mapping shows "1 → e4fa48df-93b8-45d0-8f77-51f51b6d4607", return: {"action": "CHECK_RSVPS", "extractedParams": {"event_id": "e4fa48df-93b8-45d0-8f77-51f51b6d4607"}}';
              conversationContext += '\n- CURRENT EVENT MAPPING:';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  Selection "${index + 1}" = Event ID "${event.id}"`;
              });
            }
          }

          // Add explicit context for event selection in SEND_MESSAGE
          if (currentState.waiting_for === 'event_selection_send_message') {
            conversationContext += '\nIMPORTANT: User is in event selection state for SEND_MESSAGE.';
            conversationContext += '\n- User needs to select an event by number (1, 2, 3, etc.)';
            conversationContext += '\n- Extract the selected event number and return it as: {"action": "SEND_MESSAGE", "extractedParams": {"event_id": <actual_uuid_from_mapping>, "event_title": "<event_title>"}}';
            conversationContext += '\n- If user responds with just a number like "1", "2", "3", this is event selection, NOT targeting selection';

            // Get available events from extracted_data
            const availableEvents = currentState.extracted_data?.[0]?.available_events || [];
            if (availableEvents.length > 0) {
              const eventsList = availableEvents.map((event, index) =>
                `${index + 1}. ${event.title} (ID: ${event.id})`
              ).join(', ');
              conversationContext += `\n- Available events: ${eventsList}`;
              conversationContext += '\n- Event ID mapping (use the actual UUID, not the number):';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  ${index + 1} → ${event.id}`;
              });
            }
          }

          // Add explicit context for event selection in INVITE_MORE_PEOPLE
          if (currentState.waiting_for === 'invite_more_people_event_selection') {
            conversationContext += '\nIMPORTANT: User is in event selection state for INVITE_MORE_PEOPLE.';
            conversationContext += '\n- User needs to select an event by number (1, 2, 3, etc.)';
            conversationContext += '\n- Extract the selected event number and return it as: {"action": "INVITE_MORE_PEOPLE_STEP_2", "extractedParams": {"event_id": <actual_uuid_from_mapping>, "event_title": "<event_title>", "event_date": "<event_date>", "event_time": "<event_time>", "event_location": "<event_location>", "crew_id": "<crew_id>", "crew_name": "<crew_name>"}}';
            conversationContext += '\n- If user responds with just a number like "1", "2", "3", this is event selection for INVITE_MORE_PEOPLE workflow';

            // Get available events from extracted_data
            const availableEvents = currentState.extracted_data?.[0]?.available_events || [];
            if (availableEvents.length > 0) {
              const eventsList = availableEvents.map((event, index) =>
                `${index + 1}. ${event.title} (ID: ${event.id})`
              ).join(', ');
              conversationContext += `\n- Available events: ${eventsList}`;
              conversationContext += '\n- Event ID mapping (use the actual UUID, not the number):';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  ${index + 1} → ${event.id}`;
              });
              conversationContext += '\n- CRITICAL: When user selects a number, return the corresponding UUID from the mapping above';
              conversationContext += '\n- EXAMPLE: If user says "1" and mapping shows "1 → e4fa48df-93b8-45d0-8f77-51f51b6d4607", return: {"action": "INVITE_MORE_PEOPLE_STEP_2", "extractedParams": {"event_id": "e4fa48df-93b8-45d0-8f77-51f51b6d4607", "event_title": "<event_title>", "event_date": "<event_date>", "event_time": "<event_time>", "event_location": "<event_location>", "crew_id": "<crew_id>", "crew_name": "<crew_name>"}}';
              conversationContext += '\n- CURRENT EVENT MAPPING:';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  Selection "${index + 1}" = Event ID "${event.id}"`;
              });
            }
          }

          // Add explicit context for event selection in RECEIVE_MESSAGE
          if (currentState.waiting_for === 'event_selection_receive_message') {
            conversationContext += '\nIMPORTANT: User is in event selection state for RECEIVE_MESSAGE.';
            conversationContext += '\n- User needs to select an event by number (1, 2, 3, etc.)';
            conversationContext += '\n- Extract the selected event number and return it as: {"action": "RECEIVE_MESSAGE_EVENT_SELECTED", "extractedParams": {"event_id": <actual_uuid_from_mapping>, "event_title": "<event_title>"}}';
            conversationContext += '\n- If user responds with just a number like "1", "2", "3", this is event selection for RECEIVE_MESSAGE workflow';

            // Get available events from extracted_data
            const availableEvents = currentState.extracted_data?.[0]?.available_events || [];
            if (availableEvents.length > 0) {
              const eventsList = availableEvents.map((event, index) =>
                `${index + 1}. ${event.title} (ID: ${event.id})`
              ).join(', ');
              conversationContext += `\n- Available events: ${eventsList}`;
              conversationContext += '\n- Event ID mapping (use the actual UUID, not the number):';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  ${index + 1} → ${event.id}`;
              });
              conversationContext += '\n- CRITICAL: When user selects a number, return the corresponding UUID from the mapping above';
              conversationContext += '\n- EXAMPLE: If user says "1" and mapping shows "1 → e4fa48df-93b8-45d0-8f77-51f51b6d4607", return: {"action": "RECEIVE_MESSAGE_EVENT_SELECTED", "extractedParams": {"event_id": "e4fa48df-93b8-45d0-8f77-51f51b6d4607", "event_title": "<event_title>"}}';
              conversationContext += '\n- CURRENT EVENT MAPPING:';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  Selection "${index + 1}" = Event ID "${event.id}"`;
              });
            }
          }

          // Add explicit context for SYNC_UP time options collection
          if (currentState.current_state === 'sync_up_step_2' && currentState.waiting_for === 'time_options') {
            conversationContext += '\nIMPORTANT: User is in SYNC_UP step 2 - collecting time options.';
            conversationContext += '\n- User needs to provide time options in format: "Friday 6pm; Saturday 10am; Sunday 2pm"';
            conversationContext += '\n- CRITICAL: You MUST return BOTH time_options AND time_options_parsed with real ISO timestamps';
            conversationContext += '\n- CRITICAL: time_options_parsed must be an array of objects with: {"idx": number, "text": string, "start_time": "ISO_timestamp", "end_time": "ISO_timestamp_or_null"}';
            conversationContext += '\n- CRITICAL: Calculate actual dates for the next occurrence of each weekday';
            conversationContext += '\n- CRITICAL: For "Friday 6pm" → calculate the next Friday at 6pm in ISO format';
            conversationContext += '\n- CRITICAL: For "Saturday 10am" → calculate the next Saturday at 10am in ISO format';
            conversationContext += '\n- CRITICAL: For "Sunday 2pm" → calculate the next Sunday at 2pm in ISO format';
            conversationContext += '\n- Return: {"action": "SYNC_UP_OPTIONS_COLLECTED", "extractedParams": {"time_options": "[user_input]", "time_options_parsed": [{"idx":1,"text":"Friday 6pm","start_time":"2025-10-10T18:00:00.000Z","end_time":null},{"idx":2,"text":"Saturday 10am","start_time":"2025-10-11T10:00:00.000Z","end_time":null}]}}';
            conversationContext += '\n- If user provides time options, this is SYNC_UP_OPTIONS_COLLECTED, NOT a new SYNC_UP request';

            // Get event context from extracted_data
            const eventData = currentState.extracted_data?.find(item => item.action === 'SYNC_UP_EVENT_SELECTED');
            if (eventData) {
              conversationContext += `\n- Current event: "${eventData.event_title}" (ID: ${eventData.event_id})`;
              conversationContext += `\n- Crew: ${eventData.crew_name}`;
            }
          }

          // Add explicit context for event selection in SYNC_UP
          if (currentState.waiting_for === 'sync_up_event_selection') {
            conversationContext += '\nIMPORTANT: User is in event selection state for SYNC_UP.';
            conversationContext += '\n- User needs to select an event by number (1, 2, 3, etc.)';
            conversationContext += '\n- Extract the selected event number and return it as: {"action": "SYNC_UP_EVENT_SELECTED", "extractedParams": {"event_id": <actual_uuid_from_mapping>, "event_title": "<event_title>"}}';
            conversationContext += '\n- If user responds with just a number like "1", "2", "3", this is event selection for SYNC_UP workflow';

            // Get available events from extracted_data
            const availableEvents = currentState.extracted_data?.[0]?.event_list || [];
            if (availableEvents.length > 0) {
              const eventsList = availableEvents.map((event, index) =>
                `${index + 1}. ${event.title} (ID: ${event.id})`
              ).join(', ');
              conversationContext += `\n- Available events: ${eventsList}`;
              conversationContext += '\n- Event ID mapping (use the actual UUID, not the number):';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  ${index + 1} → ${event.id}`;
              });
              conversationContext += '\n- CRITICAL: When user selects a number, return the corresponding UUID from the mapping above';
              conversationContext += '\n- EXAMPLE: If user says "1" and mapping shows "1 → e4fa48df-93b8-45d0-8f77-51f51b6d4607", return: {"action": "SYNC_UP_EVENT_SELECTED", "extractedParams": {"event_id": "e4fa48df-93b8-45d0-8f77-51f51b6d4607", "event_title": "<event_title>"}}';
              conversationContext += '\n- CURRENT EVENT MAPPING:';
              availableEvents.forEach((event, index) => {
                conversationContext += `\n  Selection "${index + 1}" = Event ID "${event.id}"`;
              });
            }
          }

          // Add explicit context for targeting selection in SEND_MESSAGE
          if (currentState.waiting_for === 'targeting_selection') {
            conversationContext += '\n🎯 TARGETING SELECTION STATE (HIGHEST PRIORITY)';
            conversationContext += '\n⚠️  CRITICAL: User is currently selecting who to message for SEND_MESSAGE';
            conversationContext += '\n- User MUST select a targeting option by number (1, 2, 3, 4, 5)';
            conversationContext += '\n- Return: {"action": "SEND_MESSAGE", "extractedParams": {"targeting_selection": <number>, "event_id": <current_event_id>}}';
            conversationContext += '\n- Targeting options: 1=Everyone, 2=Non-responders, 3=Coming (In!), 4=Maybe, 5=Can\'t come (Out)';
            conversationContext += '\n- ALWAYS include the current event_id in extractedParams';
            conversationContext += '\n- If user sends "1", "2", "3", "4", or "5" → targeting selection';

            // Get current event_id from conversation state

            // Get targeting options from extracted_data
            const targetingOptions = currentState.extracted_data?.[0]?.targeting_options || {};
            if (targetingOptions) {
              conversationContext += '\n- Current targeting counts:';
              conversationContext += `\n  1. Everyone: ${targetingOptions.everyone || 0} people`;
              conversationContext += `\n  2. Non-responders: ${targetingOptions.non_responders || 0} people`;
              conversationContext += `\n  3. Coming (In!): ${targetingOptions.coming || 0} people`;
              conversationContext += `\n  4. Maybe: ${targetingOptions.maybe || 0} people`;
              conversationContext += `\n  5. Can't come (Out): ${targetingOptions.out || 0} people`;
            }
          }

          // Add explicit context for message collection in SEND_MESSAGE
          if (currentState.waiting_for === 'message_collection') {
            conversationContext += '\nIMPORTANT: User is in message collection state for SEND_MESSAGE.';
            conversationContext += '\n- User needs to provide the message text they want to send';
            conversationContext += '\n- Extract the message text and return it as: {"action": "SEND_MESSAGE", "extractedParams": {"message_text": <message_text>}}';
            conversationContext += '\n- Message limit: 160 characters';
            conversationContext += '\n- If message is too long, ask user to shorten it';

            // Get targeting info from extracted_data
            const targetInfo = currentState.extracted_data?.[0];
            if (targetInfo?.target_group) {
              conversationContext += `\n- Target group: ${targetInfo.target_group}`;
              conversationContext += `\n- Number of recipients: ${targetInfo.target_invitations?.length || 0}`;
            }
          }

          // Add explicit context for message confirmation in SEND_MESSAGE
          if (currentState.waiting_for === 'message_confirmation') {
            conversationContext += '\nIMPORTANT: User is in message confirmation state for SEND_MESSAGE.';
            conversationContext += '\n- User needs to confirm sending the message by replying "yes"';
            conversationContext += '\n- Extract the confirmation and return it as: {"action": "SEND_MESSAGE", "extractedParams": {"confirmation": "yes"}}';
            conversationContext += '\n- If user says "yes", proceed with sending';
            conversationContext += '\n- If user says anything else, ask for confirmation again';

            // Get message info from extracted_data
            const messageInfo = currentState.extracted_data?.[0];
            if (messageInfo?.message_text && messageInfo?.target_group) {
              conversationContext += `\n- Message: "${messageInfo.message_text}"`;
              conversationContext += `\n- Target: ${messageInfo.target_group} (${messageInfo.target_count} people)`;
            }
          }

        }
        if (currentState.last_action) {
          conversationContext += `, last action: ${currentState.last_action}`;
        }
        conversationContext += '\n';
        
        // Include extracted_data context (most recent first for current context)
        if (currentState.extracted_data && Array.isArray(currentState.extracted_data)) {
          // Get the latest crew_id and event_id from most recent actions
          let latestCrewId = null;
          let latestCrewName = null;
          let latestEventId = null;
          let latestEventName = null;
          
          // Scan from end to start to get latest context
          for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
            const item = currentState.extracted_data[i];
            if (item.executed_data) {
              if (item.executed_data.action === 'CREW_CREATED' && !latestCrewId) {
                latestCrewId = item.executed_data.crew_id;
                latestCrewName = item.executed_data.crew_name;
              }
              if (item.executed_data.action === 'EVENT_CREATED' && !latestEventId) {
                latestEventId = item.executed_data.event_id;
                latestEventName = item.executed_data.event_name;
              }
            } else if (item.action === 'EVENT_CREATED' && !latestEventId) {
              // Handle direct EVENT_CREATED actions (not nested under executed_data)
              latestEventId = item.event_id;
              latestEventName = item.event_name || item.event_title;
            }
          }

          // Also scan for complete event details in EVENT_CREATED actions
          let latestEventDetails = null;
          for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
            const item = currentState.extracted_data[i];
            if (item.action === 'EVENT_CREATED' && item.event_id) {
              latestEventDetails = item;
              break;
            }
          }
          
          // Add current context for assistant to use
          if (latestCrewId || latestEventId || latestEventDetails) {
            conversationContext += 'Current context:\n';
            if (latestCrewId) {
              conversationContext += `- Latest crew: "${latestCrewName}" (ID: ${latestCrewId})\n`;
            }
            if (latestEventId) {
              conversationContext += `- Latest event: "${latestEventName}" (ID: ${latestEventId})\n`;
            }
            if (latestEventDetails) {
              conversationContext += `- Recent event details: ${JSON.stringify(latestEventDetails)}\n`;
            }
          }
          
          // Add crew list context if available (for SEND_INVITATIONS crew selection)
          const latestCrewListAction = currentState.extracted_data?.find(item => 
            item.action === 'SEND_INVITATIONS_CREW_LIST_SHOWN' || 
            item.action === 'CREW_LIST_SHOWN' || 
            item.action === 'CHECK_CREW_LIST_SHOWN'
          );
          
          if (latestCrewListAction?.crew_list && Array.isArray(latestCrewListAction.crew_list)) {
            conversationContext += 'Available crews for selection:\n';
            // Limit to first 5 crews to reduce context size
            latestCrewListAction.crew_list.slice(0, 5).forEach((crew, index) => {
              conversationContext += `${index + 1}. ${crew.name} (ID: ${crew.id})\n`;
            });
            if (latestCrewListAction.crew_list.length > 5) {
              conversationContext += `... and ${latestCrewListAction.crew_list.length - 5} more crews\n`;
            }
            conversationContext += '\n';
          }
          
          // Add event list context if available (for INVITE_MORE_PEOPLE event selection)
          const latestEventListAction = currentState.extracted_data?.find(item => 
            item.action === 'INVITE_MORE_PEOPLE_EVENT_LIST_SHOWN'
          );
          
          if (latestEventListAction?.event_list && Array.isArray(latestEventListAction.event_list)) {
            conversationContext += 'Available events for selection:\n';
            latestEventListAction.event_list.forEach((event, index) => {
              const eventDate = new Date(event.event_date).toLocaleDateString();
              const eventTime = event.start_time ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
              conversationContext += `${index + 1}. ${event.title} - ${eventDate}${eventTime ? ` at ${eventTime}` : ''} (ID: ${event.id})\n`;
            });
            conversationContext += '\n';
          }
          
          // Add crew list context if available (for INVITE_MORE_PEOPLE crew selection)
          const latestInviteCrewListAction = currentState.extracted_data?.find(item => 
            item.action === 'INVITE_MORE_PEOPLE_CREW_LIST_SHOWN'
          );
          
          if (latestInviteCrewListAction?.crew_list && Array.isArray(latestInviteCrewListAction.crew_list)) {
            conversationContext += 'Available crews for selection:\n';
            // Limit to first 5 crews to reduce context size
            latestInviteCrewListAction.crew_list.slice(0, 5).forEach((crew, index) => {
              conversationContext += `${index + 1}. ${crew.name} (ID: ${crew.id})\n`;
            });
            if (latestInviteCrewListAction.crew_list.length > 5) {
              conversationContext += `... and ${latestInviteCrewListAction.crew_list.length - 5} more crews\n`;
            }
            conversationContext += '\n';
          }
          
          // Add method selection context if available (for INVITE_MORE_PEOPLE step 2)
          const latestEventSelection = currentState.extracted_data?.find(item => 
            item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id
          );
          
          if (latestEventSelection) {
            conversationContext += 'Current context:\n';
            conversationContext += `- Selected event: "${latestEventSelection.event_title}" (ID: ${latestEventSelection.event_id})\n`;
            conversationContext += `- Event date: ${latestEventSelection.event_date} at ${latestEventSelection.event_time}\n`;
            conversationContext += `- Method selection: Add people from: 1) Existing crew 2) New contacts (name+phone)\n`;
            conversationContext += '\n';
          }
          
          // Add recent action history
          conversationContext += 'Recent actions:\n';
          // Show last 3 actions in reverse order (most recent first)
          const recentActions = currentState.extracted_data.slice(-3).reverse();
          recentActions.forEach((item, index) => {
            if (item.executed_data) {
              if (item.executed_data.action === 'CREW_CREATED') {
              conversationContext += `${index + 1}. Crew created: "${item.executed_data.crew_name}" (ID: ${item.executed_data.crew_id})\n`;
              } else if (item.executed_data.action === 'LOCATION_ADDED') {
              conversationContext += `${index + 1}. Location added: ${item.executed_data.location} (ID: ${item.executed_data.location_id})\n`;
              } else if (item.executed_data.action === 'EVENT_CREATED') {
                conversationContext += `${index + 1}. Event created: "${item.executed_data.event_name}" (ID: ${item.executed_data.event_id})\n`;
              } else if (item.executed_data.action === 'MEMBERS_ADDED') {
                conversationContext += `${index + 1}. Members added: ${item.executed_data.added_members?.length || 0} members\n`;
              }
            } else if (item.action === 'EVENT_CREATED') {
              // Handle direct EVENT_CREATED actions
              conversationContext += `${index + 1}. Event created: "${item.event_name || item.event_title}" (ID: ${item.event_id})\n`;
            }
          });
        }
      }

      if (recentActions && recentActions.length > 0) {
        conversationContext += 'Recent user actions:\n';
        recentActions.forEach((action, index) => {
          conversationContext += `${index + 1}. ${action.action} at ${action.created_at}`;
          if (action.metadata && Object.keys(action.metadata).length > 0) {
            conversationContext += ` (${JSON.stringify(action.metadata)})`;
          }
          conversationContext += '\n';
        });
      }

      console.log('Conversation context:', conversationContext);
      console.log('User onboarded status:', userOnboardedStatus);
      console.log('Current state waiting_for:', currentState?.waiting_for);
    }

    // Add the user message to the thread with context and onboarded status
    const messageWithContext = conversationContext ? `${conversationContext}\nUser message: ${message}` : message;
    
    // Create a structured message object with onboarded status and host status
    const structuredMessage = {
      message: message,
      is_onboarded: userOnboardedStatus,
      is_host: is_host,
      context: conversationContext || ''
    };
    
    console.log('Structured message being sent to Assistant:', JSON.stringify(structuredMessage, null, 2));
    
    // HARD-CODED EXIT COMMAND DETECTION for non-onboarded users
    // This takes absolute priority over AI assistant processing
    if (!userOnboardedStatus) {
      const cleanMessage = message.toLowerCase().trim();

      // Check for exact exit commands (case-insensitive)
      if (cleanMessage === 'create event') {
        console.log('HARD DETECTION: "Create Event" exit command detected for non-onboarded user');

        // Get crew name from the conversation state BEFORE clearing it
        const { data: currentState } = await supabase
          .from('conversation_state')
          .select('extracted_data')
          .eq('user_id', userId)
          .single();
        
        let crewName = 'your crew';
        let crewId = null;
        
        console.log('DEBUG: currentState extracted_data:', JSON.stringify(currentState?.extracted_data, null, 2));
        
        if (currentState?.extracted_data && currentState.extracted_data.length > 0) {
          // Look for crew data in the extracted_data array
          // The crew data is stored in executed_data field
          const crewData = currentState.extracted_data.find(item => 
            item.executed_data?.crew_name || item.executed_data?.crew_id ||
            item.crew_name || item.crew_id
          );
          if (crewData) {
            // Check executed_data first, then fall back to direct fields
            if (crewData.executed_data) {
              crewName = crewData.executed_data.crew_name || 'your crew';
              crewId = crewData.executed_data.crew_id || null;
            } else {
              crewName = crewData.crew_name || 'your crew';
              crewId = crewData.crew_id || null;
            }
            console.log('DEBUG: Found crew data:', { crewName, crewId });
          }
        }

        // Mark user as onboarded
        await supabase
          .from('profiles')
          .update({
            is_onboarded: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        // Set up conversation state for SEND_INVITATIONS workflow
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'send_invitations_step_1',
            onboarding_step: null,
            waiting_for: null,
            last_action: 'SEND_INVITATIONS_STEP_1',
            last_action_timestamp: new Date().toISOString(),
            extracted_data: [{
              action: 'SEND_INVITATIONS_STEP_1',
              crew_id: crewId,
              crew_name: crewName,
              timestamp: new Date().toISOString()
            }]
          })
          .eq('user_id', userId);

        if (phone_number) {
          const smsMessage = `Creating event for "${crewName}". What's the event name?`;
          const smsResult = await sendSMS(phone_number, smsMessage);
          console.log('Onboarding exit SMS result:', smsResult);
        }

        return new Response(JSON.stringify({
          action: 'SEND_INVITATIONS_STEP_1',
          content: `Creating event for "${crewName}". What's the event name?`,
          crew_id: crewId,
          crew_name: crewName
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (cleanMessage === 'sync up') {
        console.log('HARD DETECTION: "Sync Up" exit command detected for non-onboarded user');

        // Mark user as onboarded
        await supabase
          .from('profiles')
          .update({
            is_onboarded: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        // Clear conversation state and exit onboarding
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'normal',
            onboarding_step: null,
            waiting_for: null,
            extracted_data: []
          })
          .eq('user_id', userId);

        if (phone_number) {
          const smsMessage = 'Great! Onboarding complete. Now finding time to connect...';
          const smsResult = await sendSMS(phone_number, smsMessage);
          console.log('Onboarding exit SMS result:', smsResult);
        }

        return new Response(JSON.stringify({
          action: 'ONBOARDING_EXIT_SYNC_UP',
          content: 'Great! Onboarding complete. Now finding time to connect...',
          exit_action: 'SYNC_UP'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (cleanMessage === 'exit') {
        console.log('HARD DETECTION: "exit" exit command detected for non-onboarded user');

        // Mark user as onboarded (even if they cancel, they're done with onboarding)
        await supabase
          .from('profiles')
          .update({
            is_onboarded: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        // Clear conversation state and exit onboarding
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'normal',
            onboarding_step: null,
            waiting_for: null,
            extracted_data: []
          })
          .eq('user_id', userId);

        if (phone_number) {
          const smsMessage = 'Onboarding exited. You can start over anytime by saying "hi" or use any other commands.';
          const smsResult = await sendSMS(phone_number, smsMessage);
          console.log('Onboarding exit SMS result:', smsResult);
        }

        return new Response(JSON.stringify({
          action: 'ONBOARDING_EXIT_EXIT',
          content: 'Onboarding exited. You can start over anytime by saying "hi" or use any other commands.',
          exit_action: 'NORMAL'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // DIRECT CONFIRMATION HANDLER - Bypass Assistant for confirmation responses
    // Direct member confirmation handler removed - member addition flow now handled by Assistant via MEMBER_CONFIRMATION_YES action
    if (false && currentState?.waiting_for === 'member_addition_confirmation') {
      // Removed direct member confirmation handler - let Assistant handle member addition flow naturally
    }
    
    // Direct confirmation handler removed - crew creation flow now handled by Assistant via CREW_CONFIRMATION_YES action
    if (false && currentState?.waiting_for === 'crew_creation_confirmation') {
      const cleanMessage = message.toLowerCase().trim();
      
      if (cleanMessage === 'yes' || cleanMessage === 'y' || cleanMessage === 'create' || 
          cleanMessage === 'confirm' || cleanMessage === 'ok' || cleanMessage === 'sure') {
        console.log('Direct confirmation handler: Processing CREW_CONFIRMATION_YES');
        
        // Process crew creation directly
        const crewName = currentState.extracted_data?.[currentState.extracted_data.length - 1]?.crew_name;
        if (!crewName) {
          console.error('No crew name found in extracted_data');
          await sendSMS(phone_number, 'Error: Crew name not found. Please try creating a crew again.');
          return new Response(JSON.stringify({ success: false, error: 'Crew name not found' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        try {
          // Create the crew
          const { data: crewData, error: crewError } = await supabase
            .from('crews')
            .insert({
              creator_id: userId,
              name: crewName,
              description: `Crew created via confirmation`,
              crew_type: 'social',
              settings: {
                visibility: 'private',
                auto_invite_new_members: false
              }
            })
            .select()
            .single();
            
          if (crewError) {
            console.error('Error creating crew:', crewError);
            
            if (crewError.code === '23505') {
              // Duplicate crew name - handle gracefully
              await sendSMS(phone_number, `A crew named "${crewName}" already exists. Please choose a different name by saying "create crew [new name]".`);
              
              // Clear the waiting state
              const { error: updateError } = await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number,
                  thread_id: threadId,
                  current_state: 'normal',
                  waiting_for: null,
                  last_action: 'CREW_CREATION_DUPLICATE',
                  last_action_timestamp: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                });
                
              return new Response(JSON.stringify({
                success: false,
                action: 'CREW_CREATION_DUPLICATE',
                error: 'Crew name already exists'
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            } else {
              await sendSMS(phone_number, 'Failed to create crew. Please try again.');
              return new Response(JSON.stringify({ success: false, error: crewError }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
          
          // Get existing extracted_data to preserve it
          const { data: currentStateData } = await supabase
            .from('conversation_state')
            .select('extracted_data')
            .eq('user_id', userId)
            .single();
          
          // Add crew creation data to extracted_data
          const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
          const updatedExtractedData = [...existingData, {
            action: 'CREW_CREATED',
            crew_id: crewData.id,
            crew_name: crewName,
            timestamp: new Date().toISOString(),
            extracted_params: { crew_name: crewName }
          }];
          
          // Update conversation state to clear waiting_for and save crew data
          const { error: updateError } = await supabase
            .from('conversation_state')
            .update({
              current_state: 'normal',
              waiting_for: null,
              last_action: 'CREW_CREATED',
              last_action_timestamp: new Date().toISOString(),
              extracted_data: updatedExtractedData,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
            
          if (updateError) {
            console.error('Error updating conversation state:', updateError);
          }
          
          // Send success message
          await sendSMS(phone_number, `✅ Crew "${crewName}" created successfully! Your crew is ready to use.`);
          
          return new Response(JSON.stringify({
            success: true,
            action: 'CREW_CREATED',
            crew_id: crewData.id,
            crew_name: crewName
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          
        } catch (error) {
          console.error('Error in crew creation:', error);
          await sendSMS(phone_number, 'Failed to create crew. Please try again.');
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      if (cleanMessage === 'no' || cleanMessage === 'n' || cleanMessage === 'cancel' || 
          cleanMessage === 'stop') {
        console.log('Direct confirmation handler: Processing CREW_CONFIRMATION_NO');
        
        // Cancel crew creation
        const { error: updateError } = await supabase
          .from('conversation_state')
          .upsert({
            user_id: userId,
            phone_number: phoneNumber,
            thread_id: threadId,
            current_state: 'normal',
            waiting_for: null,
            last_action: 'CREW_CREATION_CANCELLED',
            last_action_timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          
        if (updateError) {
          console.error('Error updating conversation state:', updateError);
        }
        
        await sendSMS(phone_number, 'Crew creation cancelled. You can create a crew anytime by saying "create crew".');
        
        return new Response(JSON.stringify({
          success: true,
          action: 'CREW_CREATION_CANCELLED'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // For unclear responses, ask for clarification
      console.log('Direct confirmation handler: Processing CREW_CONFIRMATION_CLARIFY');
      await sendSMS(phone_number, 'Please respond with "yes" to create the crew or "no" to cancel.');
      
      return new Response(JSON.stringify({
        success: true,
        action: 'CREW_CONFIRMATION_CLARIFY'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Check if this is a crew member (is_host = false) sending a non-standard message
    // If so, handle RECEIVE_MESSAGE directly instead of sending to assistant
    if (is_host === false) {
      console.log('Crew member detected, checking for RECEIVE_MESSAGE...');

      // Check if message is a non-standard crew member response (not RSVP, not numbers, not AI commands)
      const isStandardResponse = /^(in|out|maybe|1|2|3|4|5|\d+)$/i.test(message.trim());
      // For crew members, only block obvious host commands, not general words like "help"
      const isAICommand = /^(create crew|send invitations|check rsvps|add members|invite people|sync up)/i.test(message.trim());

      if (!isStandardResponse && !isAICommand) {
        console.log('Non-standard crew member message detected, processing as RECEIVE_MESSAGE');

        // Check if crew member has event context
        const { data: currentState } = await supabase
          .from('conversation_state')
          .select('current_event_id, extracted_data')
          .eq('user_id', userId)
          .single();

        if (!currentState?.current_event_id) {
          // No event context - show available events for crew member to select
          console.log('No event context found, showing available events for crew member selection');
          
          // Normalize phone number for database lookup (same as other workflows)
          const normalizedPhone = phone_number.replace(/\D/g, '');
          const phoneVariations = [];
          phoneVariations.push(normalizedPhone);
          if (normalizedPhone.length === 10) {
            phoneVariations.push('+1' + normalizedPhone);
          } else if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
            phoneVariations.push('+' + normalizedPhone);
          }
          
          console.log('DEBUG: RECEIVE_MESSAGE phone variations:', phoneVariations);
          console.log('DEBUG: Original phone_number:', phone_number);
          
          // Get events where this crew member is invited - try each phone variation
          let invitations = null;
          let invitationsError = null;
          
          for (const phoneVar of phoneVariations) {
            console.log('DEBUG: Trying phone variation:', phoneVar);
            const { data, error } = await supabase
              .from('invitations')
              .select(`
                event_id,
                events!inner(
                  id,
                  title,
                  event_date,
                  start_time,
                  location,
                  status
                ),
                contacts!inner(
                  phone_number
                )
              `)
              .eq('contacts.phone_number', phoneVar)
              .eq('events.status', 'active');
              
            if (data && data.length > 0) {
              invitations = data;
              console.log('DEBUG: Found invitations with phone variation:', phoneVar, data.length);
              break;
            }
            if (error) {
              console.log('DEBUG: Error with phone variation:', phoneVar, error);
              invitationsError = error;
            }
          }

          console.log('DEBUG: RECEIVE_MESSAGE query result:', { invitations, invitationsError });
          console.log('DEBUG: RECEIVE_MESSAGE invitations length:', invitations?.length || 0);

          if (invitationsError || !invitations || invitations.length === 0) {
            const responseContent = 'You are not currently invited to any active events. Please contact the event organizer.';
            const smsResult = await sendSMS(phone_number, responseContent);
            console.log('No events found for crew member:', smsResult);
            
            return new Response(JSON.stringify({
              action: 'RECEIVE_MESSAGE_NO_EVENTS',
              content: responseContent,
              confidence: 0.95,
              extracted_params: { received_message: message },
              model_used: 'direct-processing',
              assistant_id: assistantId,
              thread_id: threadId,
              assistant_response: `{"action":"RECEIVE_MESSAGE_NO_EVENTS","received_message":"${message}"}`,
              is_structured_response: true,
              crew_name: null,
              location: null,
              timezone: null
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Show available events for selection
          let eventOptions = 'Which event is your message about?\n\n';
          invitations.forEach((invitation, index) => {
            const event = invitation.events;
            eventOptions += `${index + 1}. ${event.title} - ${event.event_date} at ${event.start_time}\n`;
          });
          eventOptions += '\nReply with the number of your choice.';

          // Update conversation state to wait for event selection
          await supabase
            .from('conversation_state')
            .update({
              current_state: 'receive_message_event_selection',
              waiting_for: 'event_selection_receive_message',
              extracted_data: [{
                action: 'RECEIVE_MESSAGE_EVENT_SELECTION',
                available_events: invitations.map(inv => ({
                  id: inv.event_id,
                  title: inv.events.title,
                  date: inv.events.event_date,
                  time: inv.events.start_time,
                  location: inv.events.location
                })),
                pending_message: message,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);

          const smsResult = await sendSMS(phone_number, eventOptions);
          console.log('Event selection prompt sent to crew member:', smsResult);

          return new Response(JSON.stringify({
            action: 'RECEIVE_MESSAGE_EVENT_SELECTION',
            content: eventOptions,
            confidence: 0.95,
            extracted_params: { received_message: message },
            model_used: 'direct-processing',
            assistant_id: assistantId,
            thread_id: threadId,
            assistant_response: `{"action":"RECEIVE_MESSAGE_EVENT_SELECTION","received_message":"${message}"}`,
            is_structured_response: true,
            crew_name: null,
            location: null,
            timezone: null
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Handle RECEIVE_MESSAGE with event context
        const responseContent = `Message received: "${message}". This will be forwarded to the event organizer.`;
        const shouldSendSMS = true;

        // Send SMS response to crew member
        if (phone_number) {
          const smsResult = await sendSMS(phone_number, responseContent);
          console.log('RECEIVE_MESSAGE SMS sent to crew member:', smsResult);
        }

        // Log message reception for analytics
        if (phone_number) {
          await supabase.from('message_reception_log').insert({
            user_id: userId,
            phone_number: phone_number,
            original_message: message,
            received_message: message,
            is_host: is_host,
            event_id: currentState.current_event_id,
            timestamp: new Date().toISOString()
          });
        }

        // TODO: Send notification to host about received message
        // This would require finding the host's phone number and sending them a notification
        // For now, we'll just log that a message was received
        console.log(`Message from crew member ${phone_number} for event ${currentState.current_event_id}: "${message}" - needs to be forwarded to host`);

        return new Response(JSON.stringify({
          action: 'RECEIVE_MESSAGE',
          content: responseContent,
          confidence: 0.95,
          extracted_params: { received_message: message },
          model_used: 'direct-processing',
          assistant_id: assistantId,
          thread_id: threadId,
          assistant_response: `{"action":"RECEIVE_MESSAGE","received_message":"${message}"}`,
          is_structured_response: true,
          crew_name: null,
          location: null,
          timezone: null
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    const addMessageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: JSON.stringify(structuredMessage)
      })
    });

    if (!addMessageResponse.ok) {
      const errorText = await addMessageResponse.text();
      console.error('Failed to add message to thread:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to add message to thread',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Run the assistant on the thread (without function calls for simplicity)
    const aiStartTime = Date.now();
    console.log(`🤖 [${Date.now() - startTime}ms] Starting AI assistant call`);
    
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        model: model // Override model at thread level as discussed
      })
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('OpenAI Run Error:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to run assistant',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const runData = await runResponse.json();
    const runId = runData.id;
    console.log('Started run:', runId);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    let runStatus = 'queued';

    while (runStatus === 'queued' || runStatus === 'in_progress') {
      if (attempts >= maxAttempts) {
        return new Response(JSON.stringify({
          error: 'Assistant run timed out'
        }), {
          status: 408,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;

      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        runStatus = statusData.status;
        console.log('Run status:', runStatus);
      }
    }

    if (runStatus === 'requires_action') {
      // Get the run details to see what function calls are needed
      const runDetailsResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (runDetailsResponse.ok) {
        const runDetails = await runDetailsResponse.json();
        console.log('Run details:', JSON.stringify(runDetails, null, 2));

        // Submit the function call results
        const submitResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            tool_outputs: runDetails.required_action.submit_tool_outputs.tool_calls.map((toolCall: any) => ({
              tool_call_id: toolCall.id,
              output: JSON.stringify({
                action: 'ONBOARDING_START',
                confidence: 0.95,
                extracted_params: { message: message }
              })
            }))
          })
        });

        if (submitResponse.ok) {
          // Wait for completion after submitting tool outputs
          let submitAttempts = 0;
          const maxSubmitAttempts = 30;
          let submitStatus = 'queued';

          while (submitStatus === 'queued' || submitStatus === 'in_progress') {
            if (submitAttempts >= maxSubmitAttempts) {
              return new Response(JSON.stringify({
                error: 'Assistant run timed out after tool submission'
              }), {
                status: 408,
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json'
                }
              });
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            submitAttempts++;

            const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
              headers: {
                'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            });

            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              submitStatus = statusData.status;
              console.log('Submit status:', submitStatus);
            }
          }

          if (submitStatus !== 'completed') {
            return new Response(JSON.stringify({
              error: 'Assistant run failed after tool submission',
              status: submitStatus
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
        }
      }
    } else if (runStatus !== 'completed') {
      return new Response(JSON.stringify({
        error: 'Assistant run failed',
        status: runStatus
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get the function call result
    console.log(`✅ [${Date.now() - startTime}ms] AI assistant completed, fetching response`);
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error('Failed to get messages:', errorText);
      return new Response(JSON.stringify({
        error: 'Failed to get assistant response'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const messagesData = await messagesResponse.json();
    console.log('Messages data:', JSON.stringify(messagesData, null, 2));


    // Extract the action from the assistant's response with enhanced parsing
    let action = 'INVALID';
    let confidence = 0.8; // Default confidence
    let extractedParams = {};
    let assistantResponse = '';
    let shouldSkipRest = false;
    let substep = undefined;

    if (messagesData.data && messagesData.data.length > 0) {
      const lastMessage = messagesData.data[0];
      if (lastMessage.content && lastMessage.content.length > 0) {
        const content = lastMessage.content[0];
        if (content.type === 'text' && content.text.value) {
          assistantResponse = content.text.value.trim();
          
          // Try to parse as structured JSON response first
          try {
            const parsedResponse = JSON.parse(assistantResponse);
            if (parsedResponse.action) {
              action = parsedResponse.action;
              extractedParams = parsedResponse.extractedParams || parsedResponse.extracted_data || {};
              substep = parsedResponse.substep;
              confidence = 0.95; // Higher confidence for structured responses
              console.log('Parsed structured response:', { action, extractedParams, substep });
              
              // If we have a structured response, skip the rest of the logic
              if (action && (Object.keys(extractedParams).length > 0 || action === 'HELP')) {
                console.log('Using structured response, skipping keyword matching');
                // Skip to the end of the action extraction logic
                // Set a flag to skip the rest of the logic
                shouldSkipRest = true;
              } else {
                // Continue with the rest of the logic for simple actions
                console.log('Structured response but no extracted data, continuing with logic');
              }
            }
          } catch (e) {
            // Fall back to simple action word parsing
            const responseUpper = assistantResponse.toUpperCase();
            action = responseUpper; // Direct action word
            console.log('Parsed simple action:', action);
          }
          
          // Skip the rest of the logic if we have a structured response with extracted data
          if (shouldSkipRest) {
            console.log('Skipping rest of action extraction logic due to structured response');
          } else {
            // Auto-trigger onboarding for first-time users (only if no structured response)
            console.log('isFirstTimeUser:', isFirstTimeUser, 'userOnboardedStatus:', userOnboardedStatus, 'message:', message, 'assistantResponse:', assistantResponse);
          if (isFirstTimeUser && !userOnboardedStatus && Object.keys(extractedParams).length === 0 && action !== 'HELP') {
            action = 'ONBOARDING_START';
            console.log('Auto-triggering onboarding for first-time user');
          } else {
            // Check if user is in onboarding flow first
            if (userId) {
              const { data: currentState } = await supabase
                .from('conversation_state')
                .select('current_state, onboarding_step')
                .eq('user_id', userId)
                .single();
              
              if (currentState && currentState.current_state?.startsWith('onboarding_') && !userOnboardedStatus) {
                // Force onboarding completion - block all other actions (only for non-onboarded users)
                action = 'ONBOARDING_CONTINUE';
                console.log('User in onboarding flow, forcing onboarding completion');
                
                // If no data extracted from structured response, try to extract from user message
                if (action === 'ONBOARDING_CONTINUE' && Object.keys(extractedParams).length === 0) {
                  // Try to extract crew name
                  const crewNameMatch = message.match(/(?:crew name is|my crew is|crew is)\s+(.+)/i);
                  if (crewNameMatch) {
                    extractedParams.crew_name = crewNameMatch[1].trim();
                    console.log('Extracted crew name from message:', extractedParams.crew_name);
                  }
                  
                  // Try to extract location
                  const locationMatch = message.match(/(?:i'm in|i am in|location is|i live in)\s+(.+)/i);
                  if (locationMatch) {
                    extractedParams.location = locationMatch[1].trim();
                    console.log('Extracted location from message:', extractedParams.location);
                  }
                  
                  // Try to extract crew members
                  const memberMatch = message.match(/([a-zA-Z]+)\s*\+?1?(\d{10})/);
                  if (memberMatch) {
                    extractedParams.crew_members = [{
                      name: memberMatch[1],
                      phone: '+1' + memberMatch[2]
                    }];
                    console.log('Extracted crew member from message:', extractedParams.crew_members);
                  }
                  
                  // Try to extract event name
                  const eventNameMatch = message.match(/(?:event name is|event is|my event is)\s+(.+)/i);
                  if (eventNameMatch) {
                    extractedParams.event_name = eventNameMatch[1].trim();
                    console.log('Extracted event name from message:', extractedParams.event_name);
                  }
                  
                  // Try to extract event location
                  const eventLocationMatch = message.match(/(?:location is|at|in)\s+(.+)/i);
                  if (eventLocationMatch) {
                    extractedParams.event_location = eventLocationMatch[1].trim();
                    console.log('Extracted event location from message:', extractedParams.event_location);
                  }
                  
                  // Try to extract event date/time
                  const eventDateTimeMatch = message.match(/(?:date is|time is|on)\s+(.+)/i);
                  if (eventDateTimeMatch) {
                    const dateTimeStr = eventDateTimeMatch[1].trim();
                    // Simple parsing - could be enhanced
                    extractedParams.event_date = dateTimeStr;
                    extractedParams.event_time = dateTimeStr;
                    console.log('Extracted event date/time from message:', dateTimeStr);
                  }
                  
                  // Try to extract event notes
                  const eventNotesMatch = message.match(/(?:notes|description|details)\s*:?\s*(.+)/i);
                  if (eventNotesMatch) {
                    extractedParams.event_notes = eventNotesMatch[1].trim();
                    console.log('Extracted event notes from message:', extractedParams.event_notes);
                  }
                  
                  // Try to extract confirmation
                  if (message.toLowerCase().includes('yes') || message.toLowerCase().includes('confirm') || message.toLowerCase().includes('send')) {
                    extractedParams.confirm = true;
                    console.log('Extracted confirmation from message');
                  }
                }
              }
              // Trust the assistant's action detection - no fallback keyword matching needed
            } else {
              action = 'INVALID';
            }
          }
        }
      }
    }
    } // Close the else block for shouldSkipRest
    //Note Remove when we need to check limit 
    // Check usage limits before processing AI request
    if (false) {
      // Normalize phone number for database lookup
      const normalizedPhone = phone_number.replace(/\D/g, '');
      
      const usageCheckResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-usage-limits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: normalizedPhone,
          action_type: 'ai_message'
        })
      });

      if (usageCheckResponse.ok) {
        const usageData = await usageCheckResponse.json();
        
        if (!usageData.allowed) {
          // User has exceeded limits, return upgrade message
          return new Response(JSON.stringify({
            action: 'UPGRADE_REQUIRED',
            content: usageData.upgrade_message,
            usage_data: usageData,
            blocked: true
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }
    }

    // User profile lookup already done above

    // Update or create conversation state with thread_id using user_id
    // Skip updating conversation state for INVALID actions to preserve existing state
    if (phone_number && userId && action !== 'INVALID') {
      const normalizedPhone = phone_number.replace(/\D/g, '');
      console.log('Upserting conversation state for userId:', userId, 'phone:', normalizedPhone, 'threadId:', threadId);
      
      // Check if user is in onboarding to determine expiration
      const isInOnboarding = action === 'ONBOARDING_START' || action === 'ONBOARDING_CONTINUE' || 
                           action.startsWith('ONBOARDING_STEP_') || 
                           (action === 'ONBOARDING_STEP_4') || (action === 'ONBOARDING_STEP_5') || 
                           (action === 'ONBOARDING_STEP_6') || (action === 'ONBOARDING_STEP_7') || 
                           (action === 'ONBOARDING_STEP_8') || (action === 'ONBOARDING_STEP_9');
      
      // Check if user is already in onboarding
      const { data: existingState } = await supabase
        .from('conversation_state')
        .select('current_state, onboarding_step')
        .eq('user_id', userId)
        .single();
      
      const isAlreadyInOnboarding = existingState && existingState.current_state?.startsWith('onboarding_');
      
      // Combined onboarding detection
      const isInOnboardingFlow = isInOnboarding || isAlreadyInOnboarding;
      
      // Update conversation state for all users (onboarded and non-onboarded)
      if (action !== 'INVALID') {
        // Get current conversation state to preserve waiting_for if it's already set
        const { data: currentConversationState } = await supabase
          .from('conversation_state')
          .select('waiting_for')
          .eq('user_id', userId)
          .single();
        
        // Get existing extracted_data to preserve it
        const { data: existingConversationState } = await supabase
          .from('conversation_state')
          .select('extracted_data')
          .eq('user_id', userId)
          .single();
        
        // Preserve existing extracted_data and append new data if available
        let updatedExtractedData = existingConversationState?.extracted_data || [];
        if (!Array.isArray(updatedExtractedData)) {
          updatedExtractedData = [];
        }
        
        // Only append new data if we have extracted_params and we're not in onboarding (onboarding handles its own extracted_data)
        if (Object.keys(extractedParams).length > 0 && !isInOnboarding) {
          updatedExtractedData.push({
            extracted_data: extractedParams,
            executed_data: {
              action: action,
              timestamp: new Date().toISOString()
            }
          });
        }
        
        // Build the update object
        const updateData: any = {
          user_id: userId,
          phone_number: normalizedPhone,
          thread_id: threadId,
          thread_created_at: shouldCreateNewThread ? new Date().toISOString() : undefined,
          current_state: (action === 'ONBOARDING_START' || isFirstTimeUser) ? 'onboarding_step_1' : 'normal',
          onboarding_step: (action === 'ONBOARDING_START' || isFirstTimeUser) ? 1 : null,
          waiting_for: (action === 'ONBOARDING_START' || isFirstTimeUser) ? 'onboarding_crew_name' : (currentConversationState?.waiting_for || null),
          last_action: action,
          last_action_timestamp: new Date().toISOString(),
          // Don't set expiration for onboarding users - keep thread and state until completion
          expires_at: isInOnboardingFlow ? null : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        };
        
        // Only update extracted_data if we're not in onboarding (onboarding handles its own extracted_data)
        if (!isInOnboardingFlow) {
          updateData.extracted_data = updatedExtractedData;
        }
        
        const { data: conversationData, error: upsertError } = await supabase
          .from('conversation_state')
          .upsert(updateData, {
            onConflict: 'user_id'
          })
          .select()
          .single();
        
        if (upsertError) {
          console.error('Error upserting conversation state:', upsertError);
        } else {
          console.log('Successfully upserted conversation state:', conversationData?.id);
        }
      }
        
        // Handle ONBOARDING_CONTINUE actions based on extracted data
        if (action === 'ONBOARDING_CONTINUE' && Object.keys(extractedParams).length > 0) {
          console.log('Calling handleOnboardingContinue with:', { userId, extractedParams, phone_number, substep });
          const onboardingResult = await handleOnboardingContinue(userId, extractedParams, supabase, phone_number, substep);
          console.log('handleOnboardingContinue result:', onboardingResult);
          
          // If onboarding handler returned a response, use it
          if (onboardingResult) {
            // Handle crew creation error specifically
            if (onboardingResult.action === 'CREW_CREATION_ERROR') {
              console.log('Crew creation error detected, sending error message to user');
              
              // Send error message to user
              if (phone_number) {
                const errorMessage = `Sorry, a crew named "${extractedParams.crew_name}" already exists. Please try a different name.`;
                const smsResult = await sendSMS(phone_number, errorMessage);
                console.log('Crew creation error SMS result:', smsResult);
              }
              
              return new Response(JSON.stringify({
                action: 'CREW_CREATION_ERROR',
                content: `Sorry, a crew named "${extractedParams.crew_name}" already exists. Please try a different name.`,
                confidence: 0.95,
                extracted_params: extractedParams,
                model_used: model,
                assistant_id: assistantId,
                thread_id: threadId,
                assistant_response: assistantResponse,
                is_structured_response: true,
                crew_name: extractedParams.crew_name || null,
                location: null,
                timezone: null,
                crew_id: null,
                location_id: null
              }), {
                headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
            
            // Handle normal onboarding success
            return new Response(JSON.stringify({
              action: onboardingResult.action,
              content: onboardingResult.content,
              confidence: 0.95,
              extracted_params: extractedParams,
              model_used: model,
              assistant_id: assistantId,
              thread_id: threadId,
              assistant_response: assistantResponse,
              is_structured_response: true,
              crew_name: onboardingResult.crew_name || extractedParams.crew_name || null,
              location: onboardingResult.location || extractedParams.location || null,
              timezone: extractedParams.timezone || null,
              crew_id: onboardingResult.crew_id || null,
              location_id: onboardingResult.location_id || null
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
        }
    } else if (phone_number && !userId) {
      console.log('No userId available, cannot create conversation state');
    }

    // Increment usage counters after successful AI processing
    if (phone_number) {
      // Normalize phone number for database lookup
      const normalizedPhone = phone_number.replace(/\D/g, '');
      
      // Increment AI message usage
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/increment-usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: normalizedPhone,
          action_type: 'ai_message'
        })
      });

      // Increment SMS message usage
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/increment-usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: normalizedPhone,
          action_type: 'sms_message'
        })
      });
    }

    // Log the interaction
    if (phone_number) {
      await supabase.from('sms_log').insert({
        phone_number: phone_number,
        message_body: message,
        direction: 'inbound',
        message_type: 'ai_classification',
        user_id: userId,
        intent_classification: {
          action: action,
          confidence: confidence,
          extracted_params: extractedParams,
          model_used: model,
          assistant_id: assistantId,
          thread_id: threadId
        }
      });
    }


    // Handle different action types
    
    if (action === 'ONBOARDING_CONTINUE' && Object.keys(extractedParams).length === 0) {
      responseContent = 'Unknown message';
    } else if (action === 'CREATE_CREW') {
      // Handle CREATE_CREW for onboarded users - simplified flow like onboarding
      if (phone_number && userId) {
        // Extract crew name from assistant or message
          let crewName = extractedParams.crew_name;
          
          // Fallback: Try to extract crew name from the message if not provided by assistant
          if (!extractedParams.crew_name) {
            const crewNameMatch = message.match(/(?:crew name is|my crew is|crew is|name is)\s+(.+)/i);
            if (crewNameMatch) {
              crewName = crewNameMatch[1].trim();
            } else if (message.toLowerCase().includes('create crew') && message.length > 12) {
              // If message is longer than just "create crew", try to extract name
              const words = message.split(' ');
              const crewIndex = words.findIndex(word => word.toLowerCase() === 'crew');
              if (crewIndex !== -1 && words[crewIndex + 1] && words[crewIndex + 1].toLowerCase() !== 'name') {
                crewName = words.slice(crewIndex + 1).join(' ').trim();
              }
            }
          }
          
          // If no crew name was extracted, ask the user for one
          if (!crewName || crewName.trim() === '') {
          responseContent = 'What should we name your crew?';
            shouldSendSMS = true;
            
            // Update conversation state to wait for crew name
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                onboarding_step: null,
                waiting_for: 'crew_name_input',
                last_action: 'CREATE_CREW',
                last_action_timestamp: new Date().toISOString()
              })
              .eq('user_id', userId);
          } else {
          // We have a crew name, proceed with validation and creation (no confirmation)
            // Validate crew name length and characters
            if (crewName.length < 2) {
              responseContent = 'Crew name must be at least 2 characters long. Please provide a valid crew name.';
              shouldSendSMS = true;
            } else if (crewName.length > 50) {
              responseContent = 'Crew name must be 50 characters or less. Please provide a shorter name.';
              shouldSendSMS = true;
            } else {
              // Check for duplicate crew name
              const { data: existingCrew } = await supabase
                .from('crews')
                .select('id, name')
                .eq('creator_id', userId)
                .eq('name', crewName)
                .single();
              
              if (existingCrew) {
              responseContent = `Sorry, a crew named "${crewName}" already exists. Please try a different name.`;
                shouldSendSMS = true;
              } else {
              // Create crew immediately (no confirmation)
              const { data: crewData, error: crewError } = await supabase
                .from('crews')
                .insert({
                  creator_id: userId,
                  name: crewName,
                  description: `Crew created via CREATE_CREW command`,
                  crew_type: 'social',
                  settings: {
                    visibility: 'private',
                    auto_invite_new_members: false
                  }
                })
                .select('id, name')
                .single();

              if (crewError) {
                console.error('Error creating crew:', crewError);
                
                // Handle specific error types
                if (crewError.code === '23505') {
                  responseContent = `Sorry, a crew named "${crewName}" already exists. Please try a different name.`;
                } else {
                  responseContent = 'Failed to create crew. Please try again.';
                }
                shouldSendSMS = true;
              } else {
                console.log('Successfully created crew:', crewData.id);
                
                // Wait for the trigger to complete and generate invite URL with retry logic
                console.log('Waiting for invite URL generation...');
                let inviteUrl = null;
                let retryCount = 0;
                const maxRetries = 5;
                
                while (retryCount < maxRetries && !inviteUrl) {
                  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                  
                  // Fetch the crew data again to get the generated invite URL
                  const { data: updatedCrewData, error: fetchError } = await supabase
                    .from('crews')
                    .select('id, name, invite_url, invite_code')
                    .eq('id', crewData.id)
                    .single();
                  
                  if (fetchError) {
                    console.error(`Error fetching crew data (attempt ${retryCount + 1}):`, fetchError);
                  } else if (updatedCrewData.invite_url) {
                    console.log('Fetched crew data with invite URL:', updatedCrewData.invite_url);
                    inviteUrl = updatedCrewData.invite_url;
                    crewData.invite_url = updatedCrewData.invite_url;
                    break;
                  } else {
                    console.log(`Invite URL not ready yet (attempt ${retryCount + 1}/${maxRetries})`);
                  }
                  
                  retryCount++;
                }
                
                if (!inviteUrl) {
                  console.warn('Invite URL not generated after maximum retries, continuing without it');
                }
                
                // Get existing extracted_data and append new crew data
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();

                const existingData = currentStateData?.extracted_data || [];
                // Ensure existingData is an array
                const existingDataArray = Array.isArray(existingData) ? existingData : [];
                const extractedDataList = [...existingDataArray, {
                  extracted_data: { crew_name: crewName },
                  executed_data: {
                    action: 'CREW_CREATED',
                    crew_id: crewData.id,
                      crew_name: crewName,
                      timestamp: new Date().toISOString()
                  }
                }];

                // Update conversation state to member adding mode (like onboarding step 2)
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'onboarding_step_2',
                    onboarding_step: 2,
                    waiting_for: 'member_adding_mode',
                    extracted_data: extractedDataList,
                    last_action: 'CREW_CREATED',
                    last_action_timestamp: new Date().toISOString()
                  })
                  .eq('user_id', userId);
                
                // Send SMS response for crew creation (same as onboarding)
                responseContent = `${crewName} crew created. Add members by sharing the crew link below or text member info (eg. Tom 4155551234). Crew link: ${crewData?.invite_url??""}. When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
                shouldSendSMS = true;
              }
            }
          }
        }
      } else {
        responseContent = 'Unable to create crew. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'CREATE_CREW' && currentState?.waiting_for === 'crew_name_input') {
      // User is providing crew name after being asked - simplified flow (no confirmation)
      const crewName = message.trim();
      
      if (!crewName || crewName.length < 2) {
        responseContent = 'Crew name must be at least 2 characters long. Please provide a valid crew name.';
        shouldSendSMS = true;
      } else if (crewName.length > 50) {
        responseContent = 'Crew name must be 50 characters or less. Please provide a shorter name.';
        shouldSendSMS = true;
      } else {
        // Check for duplicate crew name
        const { data: existingCrew } = await supabase
          .from('crews')
          .select('id, name')
          .eq('creator_id', userId)
          .eq('name', crewName)
          .single();
        
        if (existingCrew) {
          responseContent = `Sorry, a crew named "${crewName}" already exists. Please try a different name.`;
          shouldSendSMS = true;
        } else {
          // Create crew immediately (no confirmation)
          const { data: crewData, error: crewError } = await supabase
            .from('crews')
            .insert({
              creator_id: userId,
              name: crewName,
              description: `Crew created via CREATE_CREW command`,
              crew_type: 'social',
              settings: {
                visibility: 'private',
                auto_invite_new_members: false
              }
            })
            .select('id, name')
            .single();

          if (crewError) {
            console.error('Error creating crew:', crewError);
            
            // Handle specific error types
            if (crewError.code === '23505') {
              responseContent = `Sorry, a crew named "${crewName}" already exists. Please try a different name.`;
            } else {
              responseContent = 'Failed to create crew. Please try again.';
            }
            shouldSendSMS = true;
          } else {
            console.log('Successfully created crew:', crewData.id);
            
            // Wait for the trigger to complete and generate invite URL with retry logic
            console.log('Waiting for invite URL generation...');
            let inviteUrl = null;
            let retryCount = 0;
            const maxRetries = 5;
            
            while (retryCount < maxRetries && !inviteUrl) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
              
              // Fetch the crew data again to get the generated invite URL
              const { data: updatedCrewData, error: fetchError } = await supabase
                .from('crews')
                .select('id, name, invite_url, invite_code')
                .eq('id', crewData.id)
                .single();
              
              if (fetchError) {
                console.error(`Error fetching crew data (attempt ${retryCount + 1}):`, fetchError);
              } else if (updatedCrewData.invite_url) {
                console.log('Fetched crew data with invite URL:', updatedCrewData.invite_url);
                inviteUrl = updatedCrewData.invite_url;
                crewData.invite_url = updatedCrewData.invite_url;
                break;
              } else {
                console.log(`Invite URL not ready yet (attempt ${retryCount + 1}/${maxRetries})`);
              }
              
              retryCount++;
            }
            
            if (!inviteUrl) {
              console.warn('Invite URL not generated after maximum retries, continuing without it');
            }
            
            // Get existing extracted_data and append new crew data
            const { data: currentStateData } = await supabase
            .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();

            const existingData = currentStateData?.extracted_data || [];
            // Ensure existingData is an array
            const existingDataArray = Array.isArray(existingData) ? existingData : [];
            const extractedDataList = [...existingDataArray, {
              extracted_data: { crew_name: crewName },
              executed_data: {
                action: 'CREW_CREATED',
                crew_id: crewData.id,
                crew_name: crewName,
                timestamp: new Date().toISOString()
              }
            }];

            // Update conversation state to member adding mode (like onboarding step 2)
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'onboarding_step_2',
                onboarding_step: 2,
                waiting_for: 'member_adding_mode',
                extracted_data: extractedDataList,
                last_action: 'CREW_CREATED',
              last_action_timestamp: new Date().toISOString()
            })
            .eq('user_id', userId);
          
            // Send SMS response for crew creation (same as onboarding)
            responseContent = `${crewName} crew created. Add members by sharing the crew link below or text member info (eg. Tom 4155551234). Crew link: ${crewData?.invite_url??""}. When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
          shouldSendSMS = true;
          }
        }
      }
    } else if (action === 'CREW_CONFIRMATION_YES') {
      // Handle crew creation confirmation - user said yes
      console.log('Processing CREW_CONFIRMATION_YES - creating crew');
      
      // Get current conversation state to find the crew name
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('extracted_data')
        .eq('user_id', userId)
        .single();
        
      // Get crew name from the most recent extracted_data
      let crewName = null;
      if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
        // Look for the most recent crew name in extracted_data
        for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
          const item = currentStateData.extracted_data[i];
          if (item.crew_name) {
            crewName = item.crew_name;
            break;
          }
        }
      }
      
      if (crewName) {
        try {
          const { data: crewDataResult, error: crewError } = await supabase
            .from('crews')
            .insert({
              creator_id: userId,
              name: crewName,
              description: `Crew created via confirmation`,
              crew_type: 'social',
              settings: {
                visibility: 'private',
                auto_invite_new_members: false
              }
            })
            .select()
            .single();
          
          if (crewError) {
            console.error('Error creating crew:', crewError);
            
            if (crewError.code === '23505') {
              // Duplicate crew name - handle gracefully
              responseContent = `A crew named "${crewName}" already exists. Please choose a different name by saying "create crew [new name]".`;
              
              // Clear the waiting state
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'normal',
                  waiting_for: null,
                  last_action: 'CREW_CREATION_DUPLICATE',
                  last_action_timestamp: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);
            } else {
              responseContent = 'Failed to create crew. Please try again.';
            }
            shouldSendSMS = true;
          } else {
            console.log('Successfully created crew:', crewDataResult.id);
            
            // Get existing extracted_data to preserve it
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();
            
            // Add crew creation data to extracted_data
            const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
            const updatedExtractedData = [...existingData, {
              action: 'CREW_CREATED',
              crew_id: crewDataResult.id,
              crew_name: crewName,
              timestamp: new Date().toISOString(),
              extracted_params: { crew_name: crewName }
            }];
            
            // Update conversation state to clear waiting_for and save crew data
            const { error: updateError } = await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                last_action: 'CREW_CREATED',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: updatedExtractedData,
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId);
              
            if (updateError) {
              console.error('Error updating conversation state:', updateError);
            }
            
            responseContent = `✅ Crew "${crewName}" created successfully! Your crew is ready to use.`;
            shouldSendSMS = true;
          }
        } catch (error) {
          console.error('Error in crew creation:', error);
          responseContent = 'Failed to create crew. Please try again.';
          shouldSendSMS = true;
        }
      } else {
        responseContent = 'Crew data not found. Please try creating a crew again.';
        shouldSendSMS = true;
      }
    } else if (action === 'CREW_CONFIRMATION_NO') {
      // Handle crew creation confirmation - user said no
      console.log('Processing CREW_CONFIRMATION_NO - cancelling crew creation');
      
      // Get current conversation state
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('waiting_for, extracted_data')
        .eq('user_id', userId)
        .single();
        
      if (currentStateData?.waiting_for === 'crew_creation_confirmation') {
        // Clear the conversation state and extracted data
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'normal',
            onboarding_step: null,
            waiting_for: null,
            extracted_data: [], // Clear extracted data
            last_action: 'CREW_CREATION_CANCELLED',
            last_action_timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        responseContent = 'Crew creation cancelled. You can create a crew anytime by saying "create crew [name]".';
        shouldSendSMS = true;
      } else {
        responseContent = 'No crew creation in progress. You can create a crew by saying "create crew [name]".';
        shouldSendSMS = true;
      }
    } else if (action === 'CREW_CONFIRMATION_CLARIFY') {
      // Handle unclear crew creation confirmation response
      // Get current conversation state
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('waiting_for')
        .eq('user_id', userId)
        .single();
        
      if (currentStateData?.waiting_for === 'crew_creation_confirmation') {
        responseContent = 'Please respond with "yes" to create the crew or "no" to cancel.';
        shouldSendSMS = true;
      } else {
        responseContent = 'No crew creation in progress. You can create a crew by saying "create crew [name]".';
        shouldSendSMS = true;
      }
    } else if (action === 'MEMBER_CONFIRMATION_YES') {
      // Handle member addition confirmation - user said yes
      console.log('Processing MEMBER_CONFIRMATION_YES - adding member to crew');
      
      // Get current conversation state
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('waiting_for, extracted_data')
        .eq('user_id', userId)
        .single();
        
      const latestExtractedData = currentStateData?.extracted_data?.[currentStateData.extracted_data.length - 1];
      if (latestExtractedData?.action === 'MEMBER_CONFIRMATION_PROMPT') {
        const members = latestExtractedData.members || [];
        const crewId = latestExtractedData.crew_id;
        const crewName = latestExtractedData.crew_name;
        
        if (members && members.length > 0 && crewId) {
          try {
            let addedMembers = [];
            let duplicateMembers = [];
            let failedMembers = [];
            
            for (const member of members) {
              try {
                // Check if contact already exists
                let contactData;
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id, first_name')
                  .eq('user_id', userId)
                  .eq('phone_number', member.phone)
                  .single();
                
                if (existingContact) {
                  console.log('Using existing contact:', existingContact.id);
                  contactData = existingContact;
                } else {
                  // Create new contact record
                  const { data: newContactData, error: contactError } = await supabase
                    .from('contacts')
                    .insert({
                      user_id: userId,
                      first_name: member.name,
                      phone_number: member.phone
                    })
                    .select()
                    .single();
                    
                  if (contactError) {
                    console.error('Error creating contact:', contactError);
                    failedMembers.push(member.name);
                    continue;
                  } else {
                    contactData = newContactData;
                  }
                }
                
                if (contactData) {
                  // Check if contact is already in this crew
                  const { data: existingCrewMember } = await supabase
                    .from('crew_members')
                    .select('id')
                    .eq('crew_id', crewId)
                    .eq('contact_id', contactData.id)
                    .single();
                  
                  if (existingCrewMember) {
                    console.log('Contact is already in this crew:', member.name);
                    duplicateMembers.push(member.name);
                  } else {
                    // Create crew_member record
                    const { data: crewMemberData, error: crewMemberError } = await supabase
                      .from('crew_members')
                      .insert({
                        crew_id: crewId,
                        contact_id: contactData.id,
                        role: 'member'
                      })
                      .select()
                      .single();
                      
                    if (crewMemberError) {
                      console.error('Error adding member to crew:', crewMemberError);
                      failedMembers.push(member.name);
                    } else {
                      console.log('Successfully added member to crew:', member.name);
                      addedMembers.push(member.name);
                    }
                  }
                }
              } catch (error) {
                console.error('Error processing member:', member.name, error);
                failedMembers.push(member.name);
              }
            }
            
            // Update conversation state to clear waiting_for
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                last_action: 'MEMBER_ADDED',
                last_action_timestamp: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId);
            
            // Generate response based on results
            let response = `✅ Added ${addedMembers.length} member(s) to ${crewName}!`;
            if (addedMembers.length > 0) {
              response += `\nAdded: ${addedMembers.join(', ')}`;
            }
            if (duplicateMembers.length > 0) {
              response += `\nAlready in crew: ${duplicateMembers.join(', ')}`;
            }
            if (failedMembers.length > 0) {
              response += `\nFailed to add: ${failedMembers.join(', ')}`;
            }
            response += `\nYou can add more members or create events.`;
            
            responseContent = response;
            shouldSendSMS = true;
            console.log('MEMBER_CONFIRMATION_YES: Set shouldSendSMS = true, responseContent =', responseContent);
            
            // Clean up extracted_data - keep only first 2 items
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();
            
            if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
              const cleanedExtractedData = currentStateData.extracted_data.slice(0, 2);
              
              await supabase
                .from('conversation_state')
                .update({
                  extracted_data: cleanedExtractedData,
                  current_state: 'normal',
                  waiting_for: null,
                  last_action: 'MEMBER_ADDITION_COMPLETED',
                  last_action_timestamp: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);
            }
          } catch (error) {
            console.error('Error in member addition:', error);
            responseContent = 'Failed to add members. Please try again.';
            shouldSendSMS = true;
          }
        } else {
          responseContent = 'Member data not found. Please try adding the member(s) again.';
          shouldSendSMS = true;
        }
      } else {
        responseContent = 'No member addition in progress. You can add members by saying "add member [name] [phone]".';
        shouldSendSMS = true;
      }
    } else if (action === 'MEMBER_CONFIRMATION_NO') {
      // Handle member addition confirmation - user said no
      console.log('Processing MEMBER_CONFIRMATION_NO - cancelling member addition');
      
      // Get current conversation state
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('waiting_for, extracted_data')
        .eq('user_id', userId)
        .single();
        
      const latestExtractedData = currentStateData?.extracted_data?.[currentStateData.extracted_data.length - 1];
      if (latestExtractedData?.action === 'MEMBER_CONFIRMATION_PROMPT') {
        // Clear the conversation state and extracted data
        await supabase
          .from('conversation_state')
          .update({
            current_state: 'normal',
            waiting_for: null,
            extracted_data: [], // Clear extracted data
            last_action: 'MEMBER_ADDITION_CANCELLED',
            last_action_timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        responseContent = 'Member addition cancelled. You can add members anytime by saying "add member [name] [phone]".';
        shouldSendSMS = true;
      } else {
        responseContent = 'No member addition in progress. You can add members by saying "add member [name] [phone]".';
        shouldSendSMS = true;
      }
    } else if (action === 'MEMBER_CONFIRMATION_CLARIFY') {
      // Handle unclear member addition confirmation response
      // Get current conversation state
      const { data: currentStateData } = await supabase
        .from('conversation_state')
        .select('waiting_for, extracted_data')
        .eq('user_id', userId)
        .single();
        
      const latestExtractedData = currentStateData?.extracted_data?.[currentStateData.extracted_data.length - 1];
      if (latestExtractedData?.action === 'MEMBER_CONFIRMATION_PROMPT') {
        responseContent = 'Please respond with "yes" to add the member or "no" to cancel.';
        shouldSendSMS = true;
      } else {
        responseContent = 'No member addition in progress. You can add members by saying "add member [name] [phone]".';
        shouldSendSMS = true;
      }
    } else if (action === 'ADD_CREW_MEMBERS') {
      // Handle ADD_CREW_MEMBERS action - enhanced crew selection flow
      try {
        // Check if there's a crew_id in the Assistant response first
        let crewId = extractedParams.crew_id || null;
        let crewName = extractedParams.crew_name || null;
        
        // If not in Assistant response, check current context (from extracted_data)
        if (!crewId && currentState?.extracted_data && Array.isArray(currentState.extracted_data)) {
          // Search from the end of the array to find the most recent crew_id
          for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
            const item = currentState.extracted_data[i];
            if (item.crew_id || item.executed_data?.crew_id) {
              crewId = item.crew_id || item.executed_data.crew_id;
              crewName = item.crew_name || item.executed_data?.crew_name;
              break;
            }
          }
        }
        
        if (crewId) {
          // Use the crew from Assistant response or context - proceed directly to member addition (no confirmation)
          console.log('Using crew from Assistant response or context:', crewId, crewName);
          
          // Process member data from Assistant response
          if (extractedParams.crew_members && extractedParams.crew_members.length > 0) {
            const members = extractedParams.crew_members;
            
            // Add members immediately (no confirmation) - add to existing crew
            try {
              const addedMembers = [];
              for (const member of members) {
                // Check if contact already exists
                const { data: existingContact } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('phone_number', member.phone)
                  .single();
                
                let contactId;
                if (existingContact) {
                  contactId = existingContact.id;
                } else {
                  // Create new contact
                  const { data: newContact, error: contactError } = await supabase
                    .from('contacts')
                    .insert({
                      first_name: member.name,
                      phone_number: member.phone,
                      user_id: userId
                    })
                    .select('id')
                    .single();
                  
                  if (contactError) {
                    console.error('Error creating contact:', contactError);
                    continue;
                  }
                  contactId = newContact.id;
                }
                
                // Add to crew_members
                const { error: memberError } = await supabase
                  .from('crew_members')
                  .insert({
              crew_id: crewId,
                    contact_id: contactId
                  });
                
                if (memberError) {
                  console.error('Error adding member to crew:', memberError);
                  continue;
                }
                
                addedMembers.push(member.name);
              }
              
              if (addedMembers.length > 0) {
                responseContent = `Added ${addedMembers.join(', ')} to ${crewName}! You can add more members or type 'Create Event' to send invites, 'Sync Up' to find time to connect, or 'exit' to exit.`;
                shouldSendSMS = true;
              } else {
                responseContent = `Failed to add members to ${crewName}. Please try again.`;
                shouldSendSMS = true;
              }
            } catch (error) {
              console.error('Error adding members to crew:', error);
              responseContent = `Failed to add members to ${crewName}. Please try again.`;
            shouldSendSMS = true;
          }
        } else {
            // No member data provided - check if user is in member adding mode
            if (currentState?.waiting_for === 'member_adding_mode') {
              // User is in member adding mode but sent unrecognized message
              responseContent = `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
              shouldSendSMS = true;
            } else {
              // Ask for member info
              responseContent = `Add members to ${crewName} by texting member info (eg. Tom 4155551234). When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
              shouldSendSMS = true;
            }
          }
        } else {
          // No crew_id in context - show crew selection
          console.log('No crew_id in context, showing crew list for selection');
          
          // Get user's crews to choose from
          const { data: userCrews } = await supabase
            .from('crews')
            .select('id, name')
            .eq('creator_id', userId)
            .order('name');
          
          if (userCrews && userCrews.length === 0) {
            // No crews found - ask to create one first
            responseContent = 'No crews found. Type "Create Crew" to create your first crew.';
            shouldSendSMS = true;
          } else if (userCrews && userCrews.length === 1) {
            // User has exactly one crew - auto-select and proceed
            const crew = userCrews[0];
            responseContent = `Add members to ${crew.name} by texting member info (eg. Tom 4155551234). When ready, type 'Create Event' to send invites or 'Sync Up' to find time to connect.`;
            shouldSendSMS = true;
            
            // Store the selected crew in conversation state
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'crew_member_addition',
                extracted_data: [{
                  action: 'CREW_SELECTED',
                  crew_id: crew.id,
                  crew_name: crew.name,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);
          } else {
            // User has multiple crews - show numbered list for selection
            let crewList = 'Add members to which crew?\n';
            userCrews.forEach((crew, index) => {
              crewList += `${index + 1}. ${crew.name}\n`;
            });
            crewList += 'Reply with the crew number or "Create Crew" to make a new one.';
            
            responseContent = crewList;
            shouldSendSMS = true;
            
            // Get existing extracted_data to preserve it
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();
            
            // Append to existing extracted_data
            const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
            const updatedExtractedData = [...existingData, {
              crew_list: userCrews,
              crew_list_message: crewList,
              action: 'CREW_LIST_SHOWN',
              timestamp: new Date().toISOString()
            }];
            
            // Update or create conversation state to wait for crew selection and store crew list
            await supabase
              .from('conversation_state')
              .upsert({
                user_id: userId,
                phone_number: phone_number.replace(/\D/g, ''),
                thread_id: threadId,
                current_state: 'normal',
                waiting_for: 'crew_selection_for_members',
                last_action: action,
                last_action_timestamp: new Date().toISOString(),
                extracted_data: updatedExtractedData
              }, {
                onConflict: 'user_id'
              });
          }
        }
        
        // Handle unrecognized message in member adding mode for ADD_CREW_MEMBERS
        if (!extractedParams.crew_members && !extractedParams.member_name && !extractedParams.member_phone && currentState?.waiting_for === 'member_adding_mode') {
          responseContent = `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error in ADD_CREW_MEMBERS:', error);
        responseContent = 'Failed to add members. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'CHECK_CREW_MEMBERS') {
      // Handle CHECK_CREW_MEMBERS action - enhanced workflow with smart crew selection
      try {
        if (phone_number && userId) {
          // Check if there's a crew_name in the Assistant's response first (for direct crew name specification)
          let crewName = extractedParams.crew_name || null;
          
          if (crewName) {
            // User specified crew name directly - validate it exists and show members
            console.log('Direct crew name specified:', crewName);

            // Check if crew exists for this user
            const { data: crewData } = await supabase
              .from('crews')
              .select('id, name')
              .eq('creator_id', userId)
              .eq('name', crewName)
              .single();

            if (crewData) {
              // Crew exists - show members directly
              console.log('Crew found, showing members for:', crewName);
            
            // Get crew members with contact details
            const { data: crewMembers } = await supabase
              .from('crew_members')
              .select(`
                role,
                contacts (
                  first_name,
                  last_name,
                  phone_number
                )
              `)
                .eq('crew_id', crewData.id);
            
            if (crewMembers && crewMembers.length > 0) {
              const totalMembers = crewMembers.length;
                const crewDisplayName = crewName;
              
              if (totalMembers <= 5) {
                // Show all names for ≤5 members
                const memberNames = crewMembers.map(member => {
                  const contact = member.contacts;
                  return contact.last_name ? 
                    `${contact.first_name} ${contact.last_name}` : 
                    contact.first_name;
                });
                
                responseContent = `${crewDisplayName} (${totalMembers}): ${memberNames.join(', ')}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
              } else {
                  // Show first 5 + count for >5 members
                const firstFiveNames = crewMembers.slice(0, 5).map(member => {
                  const contact = member.contacts;
                  return contact.last_name ? 
                    `${contact.first_name} ${contact.last_name}` : 
                    contact.first_name;
                });
                
                  responseContent = `${crewDisplayName}: ${firstFiveNames.join(', ')}... (${totalMembers} total). Full list: funlet.ai/crew/${crewData.id}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
              }
            } else {
                responseContent = `${crewName} has no members yet. Add some by saying "add members".`;
            }
            
            // Update conversation state - clear extracted_data and save crew info for future actions
            await supabase
              .from('conversation_state')
              .upsert({
                user_id: userId,
                phone_number: phone_number.replace(/\D/g, ''),
                thread_id: threadId,
                current_state: 'normal',
                waiting_for: null,
                last_action: action,
                last_action_timestamp: new Date().toISOString(),
                extracted_data: [{
                  crew_id: crewData.id,
                  crew_name: crewName,
                  member_count: crewMembers ? crewMembers.length : 0,
                  action: 'CREW_MEMBERS_SHOWN',
                  timestamp: new Date().toISOString()
                }]
              }, {
                onConflict: 'user_id'
              });
          } else {
              // Crew name not found - show error and crew list
              console.log('Crew name not found, showing crew list for selection');
            
            // Get user's crews to choose from
            const { data: userCrews } = await supabase
              .from('crews')
              .select('id, name')
              .eq('creator_id', userId)
              .order('name');
            
            if (userCrews && userCrews.length > 0) {
                let crewList = `I couldn't find a crew named "${crewName}". Which crew do you want to check members for?\n`;
              userCrews.forEach((crew, index) => {
                crewList += `${index + 1}. ${crew.name}\n`;
              });
                crewList += 'Reply with the crew number or "Create Crew" to make a new one.';
              
              responseContent = crewList;
              
                // Update conversation state to wait for crew selection
                await supabase
                .from('conversation_state')
                  .upsert({
                    user_id: userId,
                    phone_number: phone_number.replace(/\D/g, ''),
                    thread_id: threadId,
                    current_state: 'normal',
                    waiting_for: 'crew_selection_for_check_members',
                    last_action: action,
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: [{
                crew_list: userCrews,
                crew_list_message: crewList,
                      invalid_crew_name: crewName,
                action: 'CHECK_CREW_LIST_SHOWN',
                timestamp: new Date().toISOString()
                    }]
                  }, {
                    onConflict: 'user_id'
                  });
              } else {
                // No crews found - ask to create one first
                responseContent = 'No crews found. Please create a crew first by saying "create crew".';
              }
            }
          } else {
            // No crew_name in Assistant response - show crew selection based on crew count
            console.log('No crew name specified, checking crew count for smart selection');

            // Get user's crews to determine selection logic
            const { data: userCrews } = await supabase
              .from('crews')
              .select('id, name')
              .eq('creator_id', userId)
              .order('name');

            if (userCrews && userCrews.length === 0) {
              // Zero crews - ask to create one first
              responseContent = 'No crews found. Type "Create Crew" to create your first crew.';
              shouldSendSMS = true;
            } else if (userCrews && userCrews.length === 1) {
              // Single crew - auto-select and show members
              const crew = userCrews[0];
              console.log('Single crew found, auto-selecting:', crew.name);

              // Get crew members with contact details
              const { data: crewMembers } = await supabase
                .from('crew_members')
                .select(`
                  role,
                  contacts (
                    first_name,
                    last_name,
                    phone_number
                  )
                `)
                .eq('crew_id', crew.id);

              if (crewMembers && crewMembers.length > 0) {
                const totalMembers = crewMembers.length;
                const crewDisplayName = crew.name;

                if (totalMembers <= 5) {
                  // Show all names for ≤5 members
                  const memberNames = crewMembers.map(member => {
                    const contact = member.contacts;
                    return contact.last_name ?
                      `${contact.first_name} ${contact.last_name}` :
                      contact.first_name;
                  });

                  responseContent = `${crewDisplayName} (${totalMembers}): ${memberNames.join(', ')}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
                } else {
                  // Show first 5 + count for >5 members
                  const firstFiveNames = crewMembers.slice(0, 5).map(member => {
                    const contact = member.contacts;
                    return contact.last_name ?
                      `${contact.first_name} ${contact.last_name}` :
                      contact.first_name;
                  });

                  responseContent = `${crewDisplayName}: ${firstFiveNames.join(', ')}... (${totalMembers} total). Full list: funlet.ai/crew/${crew.id}\n\nType 'Add Members' to add people to ${crewDisplayName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
                }
              } else {
                responseContent = `${crew.name} has no members yet. Add some by saying "add members".`;
              }
              
              // Update conversation state - clear extracted_data and save crew info for future actions
              await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number.replace(/\D/g, ''),
                  thread_id: threadId,
                  current_state: 'normal',
                  waiting_for: null,
                  last_action: action,
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: [{
                    crew_id: crew.id,
                    crew_name: crew.name,
                    member_count: crewMembers ? crewMembers.length : 0,
                    action: 'CREW_MEMBERS_SHOWN',
                    timestamp: new Date().toISOString()
                  }]
                }, {
                  onConflict: 'user_id'
                });
            } else {
              // Multiple crews - show numbered list for selection
              console.log('Multiple crews found, showing selection list');
              let crewList = 'Which crew do you want to check members for?\n';
              userCrews.forEach((crew, index) => {
                crewList += `${index + 1}. ${crew.name}\n`;
              });
              crewList += 'Reply with the crew number or "Create Crew" to make a new one.';

              responseContent = crewList;
              
              // Update conversation state to wait for crew selection
              await supabase
                .from('conversation_state')
                .upsert({
                  user_id: userId,
                  phone_number: phone_number.replace(/\D/g, ''),
                  thread_id: threadId,
                  current_state: 'normal',
                  waiting_for: 'crew_selection_for_check_members',
                  last_action: action,
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: [{
                    crew_list: userCrews,
                    crew_list_message: crewList,
                    action: 'CHECK_CREW_LIST_SHOWN',
                    timestamp: new Date().toISOString()
                  }]
                }, {
                  onConflict: 'user_id'
                });
            }
          }
          
          shouldSendSMS = true;
        } else {
          responseContent = 'Unable to check crew members. Please try again.';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error in CHECK_CREW_MEMBERS:', error);
        responseContent = 'Failed to check crew members. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'GET_CREW_LINK') {
      // Handle GET_CREW_LINK action - provide crew link for user
      console.log('GET_CREW_LINK action detected, processing...');

      try {
        // Get user's most recent crew
        const { data: userCrews } = await supabase
          .from('crews')
          .select('id, name, invite_url')
          .eq('creator_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (userCrews && userCrews.length > 0) {
          const crew = userCrews[0];

          responseContent = `Share this link to add people to "${crew.name}": ${crew.invite_url}`;
          shouldSendSMS = true;

          // Log crew link request
          if (phone_number) {
            await supabase.from('crew_link_requests').insert({
              user_id: userId,
              crew_id: crew.id,
              crew_name: crew.name,
              phone_number: phone_number,
              link_generated: crew.invite_url,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          responseContent = 'No crews found. Create a crew first by saying "create crew".';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error getting crew link:', error);
        responseContent = 'Failed to get crew link. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'UNKNOWN_MESSAGE') {
      // Handle UNKNOWN_MESSAGE action - check if user was just viewing crew members
      console.log('Processing UNKNOWN_MESSAGE action');
      
      // Check if user was just viewing crew members (CREW_MEMBERS_SHOWN in extracted_data)
      if (currentState?.extracted_data && 
          currentState.extracted_data.length > 0 && 
          currentState.extracted_data[currentState.extracted_data.length - 1]?.action === 'CREW_MEMBERS_SHOWN') {
        
        const crewInfo = currentState.extracted_data[currentState.extracted_data.length - 1];
        const crewName = crewInfo.crew_name;
        
        responseContent = `I didn't understand that. Type 'Add Members' to add people to ${crewName}, 'Create Event' to send invitations, or 'exit' to do something else.`;
        shouldSendSMS = true;
      } else {
        // Generic unknown message response
        responseContent = `I didn't understand that. You can send me member info, type 'Create Event', 'Sync Up' or 'exit' to do something else.`;
        shouldSendSMS = true;
      }
      // } else {
      //   // Generic unknown message response
      //   responseContent = 'Unknown message';
      //   shouldSendSMS = false;
      // }
    } else if (action === 'INVALID') {
      // Handle INVALID action with subtype detection
      console.log('Processing INVALID action - analyzing subtype for appropriate response');
      
      const invalidSubtype = extractedParams.invalid_subtype || 'unknown';
      let response = '';
      
      // Check if user is in the middle of SEND_INVITATIONS workflow for context-aware error messages
      if (phone_number && userId) {
        const { data: currentStateData } = await supabase
          .from('conversation_state')
          .select('current_state, extracted_data')
          .eq('user_id', userId)
          .single();
        
        if (currentStateData?.current_state && currentStateData.current_state.includes('send_invitations')) {
          // Determine current step for context-aware error messages
          let currentStep = 1;
          if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
            let hasCrew = false;
            let hasEventName = false;
            let hasEventDate = false;
            let hasEventTime = false;
            let hasEventLocation = false;
            
            for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
              const item = currentStateData.extracted_data[i];
              if (item.action === 'SEND_INVITATIONS_STEP_1' && item.crew_id) {
                hasCrew = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_2' && item.event_name) {
                hasEventName = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_3' && item.event_date) {
                hasEventDate = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_4' && item.event_time) {
                hasEventTime = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_5' && item.event_location) {
                hasEventLocation = true;
              }
            }
            
            if (hasEventLocation) {
              currentStep = 6; // Need confirmation
            } else if (hasEventTime) {
              currentStep = 5; // Need location
            } else if (hasEventDate) {
              currentStep = 4; // Need start time
            } else if (hasEventName) {
              currentStep = 3; // Need date
            } else if (hasCrew) {
              currentStep = 2; // Need event name
            } else {
              currentStep = 1; // Need crew selection
            }
          }
          
          // Provide context-specific error messages based on current step
          if (currentStep === 1) {
            response = 'I didn\'t understand that. Reply with a crew number, \'Create Crew\', or \'exit\' to do something else.';
          } else if (currentStep === 2) {
            response = 'I didn\'t understand that. What\'s the event name? Type \'exit\' to cancel.';
          } else if (currentStep === 3) {
            response = 'I didn\'t understand that. What\'s the date? Type \'exit\' to cancel.';
          } else if (currentStep === 4) {
            response = 'I didn\'t understand that. What\'s the start time? Type \'exit\' to cancel.';
          } else if (currentStep === 5) {
            response = 'I didn\'t understand that. What\'s the location? Type \'exit\' to cancel.';
          } else if (currentStep === 6) {
            response = 'I didn\'t understand that. Reply \'yes\' to send invites, \'no\' to make changes, or \'exit\' to cancel.';
          } else {
            response = 'I didn\'t understand that. Provide event details (name, date, time, location) or type \'exit\' to cancel.';
          }
        } else {
          // Use generic error messages for other workflows
      switch (invalidSubtype) {
        case 'off_topic':
          console.log('INVALID subtype: off_topic - weather, math, personal questions, general conversation');
          response = 'I only help coordinate events! Text \'help\' to see what I can do or \'assist\' to get started.';
          break;
        case 'inappropriate':
          console.log('INVALID subtype: inappropriate - profanity, offensive language, hostile messages');
          response = 'I\'m here to help with event coordination. Please keep messages appropriate. Try \'help\' for valid options.';
          break;
        case 'gibberish':
          console.log('INVALID subtype: gibberish - random characters, repeated text, no letters');
          response = 'I didn\'t understand that. Text \'help\' to see what I can do!';
          break;
        case 'unclear_command':
          console.log('INVALID subtype: unclear_command - partial Funlet terms without clear action');
          response = 'Not sure what you mean! Try \'create crew\', \'sync up\', or \'help\' for options.';
          break;
        case 'unknown':
        default:
          console.log('INVALID subtype: unknown - everything else that doesn\'t fit above categories');
          response = 'I didn\'t understand that. Please try "create crew", "add members", or "help" for options.';
          break;
          }
        }
      } else {
        // Fallback for when no user context
        response = 'I didn\'t understand that. Please try "create crew", "add members", or "help" for options.';
      }
      
      // Log invalid request for pattern analysis
      console.log(`INVALID request analysis:`, {
        message: message,
        invalidSubtype: invalidSubtype,
        response: response,
        timestamp: new Date().toISOString()
      });
      
      responseContent = response;
      shouldSendSMS = true;
    } else if (action === 'SEND_INVITATIONS') {
      // Handle SEND_INVITATIONS action with multi-step workflow using substeps
      try {
        // Determine current step based on state and extracted_data
        let currentStep = 1;
        
        if (phone_number && userId) {
          // Check current state to determine which step we should be at
          const { data: currentStateData } = await supabase
            .from('conversation_state')
            .select('current_state, extracted_data')
            .eq('user_id', userId)
            .single();
          
          if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
            // Check if we have all the required data for each step
            let hasCrew = false;
            let hasEventName = false;
            let hasEventDate = false;
            let hasEventTime = false;
            let hasEventLocation = false;
            let hasEventNotes = false;
            
            for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
              const item = currentStateData.extracted_data[i];
              if (item.action === 'SEND_INVITATIONS_STEP_1' && item.crew_id) {
                hasCrew = true;
                // Check for event details in STEP_1 as well
                if (item.event_name) hasEventName = true;
                if (item.event_date) hasEventDate = true;
                if (item.event_time) hasEventTime = true;
                if (item.event_location) hasEventLocation = true;
                if (item.event_notes !== undefined) hasEventNotes = true;
              } else if (item.action === 'SEND_INVITATIONS_STEP_2') {
                // All event details are now in STEP_2
                if (item.event_name) hasEventName = true;
                if (item.event_date) hasEventDate = true;
                if (item.event_time) hasEventTime = true;
                if (item.event_location) hasEventLocation = true;
                if (item.event_notes !== undefined) hasEventNotes = true;
              }
            }
            
            // Determine current step based on what data we have (2-step flow)
            if (hasCrew && hasEventName && hasEventDate && hasEventTime && hasEventLocation) {
              currentStep = 2; // Ready for confirmation
            } else if (hasCrew) {
              currentStep = 2; // Need event details (all-at-once with sequential fallback)
            } else {
              currentStep = 1; // Need crew selection
            }
            
            console.log('Step detection:', { hasCrew, hasEventName, hasEventDate, hasEventTime, hasEventLocation, currentStep });
          }
          
          console.log('SEND_INVITATIONS current step:', currentStep, 'substep:', substep, 'extractedParams:', extractedParams);
          
          // Handle different substeps based on current step and extractedParams
          // Check for confirmation first (substep 6 or confirm/yes parameters)
          if (substep === 6 || extractedParams.confirm === true || extractedParams.yes || extractedParams.confirmation) {
            // Step 6: Confirmation and event creation
            console.log('Processing SEND_INVITATIONS step 6: Confirmation and event creation');
            
            // Get all event details from extracted_data
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();
            
            let eventName = '';
            let eventLocation = '';
            let eventDate = '';
            let eventTime = '';
            let eventNotes = '';
            let crewId = null;
            let crewName = '';
            
            // Extract all details from extracted_data
            if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
              for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
                const item = currentStateData.extracted_data[i];
                if (item.action === 'SEND_INVITATIONS_STEP_1' && item.crew_id) {
                  crewId = item.crew_id;
                  crewName = item.crew_name;
                } else if (item.action === 'SEND_INVITATIONS_STEP_2') {
                  // All event details are now in STEP_2
                  if (item.event_name) eventName = item.event_name;
                  if (item.event_date) eventDate = item.event_date;
                  if (item.event_time) eventTime = item.event_time;
                  if (item.event_location) eventLocation = item.event_location;
                  if (item.event_notes !== undefined) eventNotes = item.event_notes || '';
                }
              }
            }
            
            if (!crewId) {
              responseContent = 'No crew found. Please start over by saying "send invitations".';
              shouldSendSMS = true;
            } else {
              try {
                // Parse date and time for the events table structure
                let eventDateStr, startTimeStr, endTimeStr;
                
                if (eventDate && eventTime) {
                  // Parse the date (handle "Tomorrow" format)
                  let parsedDate;
                  if (eventDate.toLowerCase() === 'tomorrow') {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    parsedDate = tomorrow;
                  } else if (eventDate.includes('/')) {
                    // Handle "12/20" or "Friday 12/27" format - extract just the date part
                    const dateMatch = eventDate.match(/(\d{1,2})\/(\d{1,2})/);
                    if (dateMatch) {
                      const [, month, day] = dateMatch;
                      const currentYear = new Date().getFullYear();
                      parsedDate = new Date(currentYear, parseInt(month) - 1, parseInt(day));
                    } else {
                      // Fallback to tomorrow
                      parsedDate = new Date();
                      parsedDate.setDate(parsedDate.getDate() + 1);
                    }
                  } else {
                    // Fallback to tomorrow
                    parsedDate = new Date();
                    parsedDate.setDate(parsedDate.getDate() + 1);
                  }
                  
                  eventDateStr = parsedDate.toISOString().split('T')[0];
                  
                  // Parse the time (handle formats like "7pm", "7:00pm", "7:30pm", "7pm-9pm", etc.)
                  const timeMatch = eventTime.match(/(\d{1,2})(?::(\d{2}))?(am|pm)(?:\s*-\s*(\d{1,2})(?::(\d{2}))?(am|pm))?/i);
                  if (timeMatch) {
                    let startHour = parseInt(timeMatch[1]);
                    const startMinutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                    const startPeriod = timeMatch[3].toLowerCase();
                    
                    // Handle start time
                    if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
                    if (startPeriod === 'am' && startHour === 12) startHour = 0;
                    
                    startTimeStr = `${startHour.toString().padStart(2, '0')}:${startMinutes.toString().padStart(2, '0')}:00`;
                    
                    // Check if there's an end time specified
                    if (timeMatch[4]) {
                      // End time is specified
                      let endHour = parseInt(timeMatch[4]);
                      const endMinutes = timeMatch[5] ? parseInt(timeMatch[5]) : 0;
                      const endPeriod = timeMatch[6].toLowerCase();
                      
                      if (endPeriod === 'pm' && endHour !== 12) endHour += 12;
                      if (endPeriod === 'am' && endHour === 12) endHour = 0;
                      
                      endTimeStr = `${endHour.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}:00`;
                    } else {
                      // No end time specified
                      endTimeStr = null;
                    }
                  } else {
                    // Fallback time
                    startTimeStr = '18:00:00';
                    endTimeStr = '20:00:00';
                  }
                } else {
                  // Fallback to tomorrow
                  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
                  eventDateStr = tomorrow.toISOString().split('T')[0];
                  startTimeStr = '18:00:00';
                  endTimeStr = '20:00:00';
                }
                
                console.log('Event data:', { eventDateStr, startTimeStr, endTimeStr, eventName, eventLocation, eventNotes });
                
                // Create the event
                const { data: eventData, error: eventError } = await supabase
                  .from('events')
                  .insert({
                    creator_id: userId,
                    crew_id: crewId,
                    title: eventName,
                    location: eventLocation,
                    event_date: eventDateStr,
                    start_time: startTimeStr,
                    end_time: endTimeStr,
                    notes: eventNotes,
                    status: 'active'
                  })
                  .select()
                  .single();
                
                if (eventError) {
                  console.error('Error creating event:', eventError);
                  responseContent = 'Failed to create event. Please try again.';
                  shouldSendSMS = true;
                } else {
                  console.log('Event created successfully:', eventData.id);
                  
                  // Trigger send invitations for the newly created event
                  try {
                    const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        event_id: eventData.id,
                        inviting_user_id: userId,
                        crew_id: crewId
                      })
                    });
                    
                    if (sendInvitationsResponse.ok) {
                      const invitationsResult = await sendInvitationsResponse.json();
                      console.log('Invitations sent successfully:', invitationsResult);
                    } else {
                      console.error('Failed to send invitations:', await sendInvitationsResponse.text());
                    }
                  } catch (invitationError) {
                    console.error('Error sending invitations:', invitationError);
                    // Don't fail the event creation if invitations fail
                  }
                  
                  // Get crew members count for the completion message
                  const { data: crewMembers } = await supabase
                    .from('crew_members')
                    .select('id')
                    .eq('crew_id', crewId);
                  
                  const memberCount = crewMembers ? crewMembers.length : 0;
                  
                  // Update conversation state to completed - clear extracted_data and save only event_id
                  await supabase
                    .from('conversation_state')
                    .update({
                      current_state: 'normal',
                      waiting_for: null, // Clear waiting_for state
                      last_action: 'SEND_INVITATIONS_COMPLETED',
                      last_action_timestamp: new Date().toISOString(),
                      extracted_data: [{
                        action: 'EVENT_CREATED',
                        event_id: eventData.id,
                        timestamp: new Date().toISOString()
                      }] // Store only event_id for the newly created event
                    })
                    .eq('user_id', userId);
                  
                  responseContent = `${memberCount} invites sent to ${crewName}! Text 'RSVPs' to see responses, 'invite more' to add people, or text me anything to organize more events!`;
                  shouldSendSMS = true;
                }
              } catch (error) {
                console.error('Error in event creation:', error);
                responseContent = 'Failed to create event. Please try again.';
                shouldSendSMS = true;
              }
            }
          } else if (currentStep === 1 || (substep === 1 || (!substep && !extractedParams.event_name && !extractedParams.event_location && !extractedParams.event_date && !extractedParams.event_time && !extractedParams.event_notes))) {
            // Step 1: Crew selection and ask for all event details
            let crewId = extractedParams.crew_id || null;
            let crewName = extractedParams.crew_name || null;
            
            // If crew name provided by assistant, look up the crew_id
            if (crewName && !crewId) {
              console.log('Looking up crew by name:', crewName);
              const { data: crewData } = await supabase
                .from('crews')
                .select('id, name')
                .eq('creator_id', userId)
                .eq('name', crewName)
                .single();
              
              if (crewData) {
                crewId = crewData.id;
                console.log('Found crew:', crewId, crewName);
              } else {
                console.log('Crew not found:', crewName);
                crewName = null; // Reset if not found
              }
            }
            
            // If not in Assistant response, check current context (from extracted_data)
            if (!crewId && currentState?.extracted_data && Array.isArray(currentState.extracted_data)) {
              // Search from the end of the array to find the most recent crew_id
              for (let i = currentState.extracted_data.length - 1; i >= 0; i--) {
                const item = currentState.extracted_data[i];
                if (item.crew_id || item.executed_data?.crew_id) {
                  crewId = item.crew_id || item.executed_data.crew_id;
                  crewName = item.crew_name || item.executed_data?.crew_name;
                  break;
                }
              }
            }
            
            if (crewId) {
              // Use the crew from Assistant response or context - proceed to event details collection
              console.log('Using crew from Assistant response or context:', crewId, crewName);
              
              // Get existing extracted_data to preserve it
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              // Append to existing extracted_data with ALL extracted parameters
              const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
              const step1Data = {
                action: 'SEND_INVITATIONS_STEP_1',
                crew_id: crewId,
                crew_name: crewName,
                timestamp: new Date().toISOString()
              };
              
              // Add any event details that were extracted by the Assistant
              if (extractedParams.event_name) step1Data.event_name = extractedParams.event_name;
              if (extractedParams.event_date) step1Data.event_date = extractedParams.event_date;
              if (extractedParams.event_time) step1Data.event_time = extractedParams.event_time;
              if (extractedParams.event_location) step1Data.event_location = extractedParams.event_location;
              if (extractedParams.event_notes !== undefined) step1Data.event_notes = extractedParams.event_notes;
              
              const updatedExtractedData = [...existingData, step1Data];
              
              // Update conversation state
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'send_invitations_step_1',
                  last_action: 'SEND_INVITATIONS_STEP_1',
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                })
                .eq('user_id', userId);
              
              responseContent = `Creating event for "${crewName}". What's the event name?`;
              shouldSendSMS = true;
            } else {
              // No crew_id in context - check if crew_name was provided to search for existing crew
              if (extractedParams.crew_name) {
                console.log('Crew name provided, searching for existing crew:', extractedParams.crew_name);
                
                // Search for crew by name for this user
                const { data: existingCrew } = await supabase
                  .from('crews')
                  .select('id, name')
                  .eq('creator_id', userId)
                  .eq('name', extractedParams.crew_name)
                  .single();
                
                if (existingCrew) {
                  // Crew exists - use it and proceed to event details
                  console.log('Found existing crew:', existingCrew.name);
                  
                  // Get existing extracted_data to preserve it
                  const { data: currentStateData } = await supabase
                    .from('conversation_state')
                    .select('extracted_data')
                    .eq('user_id', userId)
                    .single();
                  
                  // Append to existing extracted_data with ALL extracted parameters
                  const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                  const step1Data = {
                    action: 'SEND_INVITATIONS_STEP_1',
                    crew_id: existingCrew.id,
                    crew_name: existingCrew.name,
                    timestamp: new Date().toISOString()
                  };
                  
                  // Add any event details that were extracted by the Assistant
                  if (extractedParams.event_name) step1Data.event_name = extractedParams.event_name;
                  if (extractedParams.event_date) step1Data.event_date = extractedParams.event_date;
                  if (extractedParams.event_time) step1Data.event_time = extractedParams.event_time;
                  if (extractedParams.event_location) step1Data.event_location = extractedParams.event_location;
                  if (extractedParams.event_notes !== undefined) step1Data.event_notes = extractedParams.event_notes;
                  
                  const updatedExtractedData = [...existingData, step1Data];
                  
                  // Update conversation state
                  await supabase
                    .from('conversation_state')
                    .update({
                      current_state: 'send_invitations_step_1',
                      last_action: 'SEND_INVITATIONS_STEP_1',
                      last_action_timestamp: new Date().toISOString(),
                      extracted_data: updatedExtractedData
                    })
                    .eq('user_id', userId);
                  
                  // Check what fields are missing and ask for the first missing one
                  let missingField = null;
                  if (!extractedParams.event_name) {
                    missingField = 'event_name';
                  } else if (!extractedParams.event_date) {
                    missingField = 'event_date';
                  } else if (!extractedParams.event_time) {
                    missingField = 'event_time';
                  } else if (!extractedParams.event_location) {
                    missingField = 'event_location';
                  }
                  
                  if (missingField) {
                    const fieldMessages = {
                      event_name: "What's the event name?",
                      event_date: "What's the date?",
                      event_time: "What's the start time?",
                      event_location: "What's the location?"
                    };
                    responseContent = `Creating event for "${existingCrew.name}". ${fieldMessages[missingField]}`;
                  } else {
                    // All required fields provided, show confirmation
                    responseContent = `Confirm: ${extractedParams.event_name} at ${extractedParams.event_location} on ${extractedParams.event_date}, ${extractedParams.event_time}${extractedParams.event_notes ? `. Note: ${extractedParams.event_notes}` : ''}. Send invites?`;
                    
                    // Update conversation state to indicate we're waiting for confirmation
                    await supabase
                      .from('conversation_state')
                      .update({
                        current_state: 'send_invitations_step_5',
                        waiting_for: 'send_invitations_confirmation',
                        last_action: 'SEND_INVITATIONS_CONFIRMATION_SHOWN',
                        last_action_timestamp: new Date().toISOString()
                      })
                      .eq('user_id', userId);
                  }
                  shouldSendSMS = true;
                } else {
                  // Crew doesn't exist - show crew list to let user choose or create new crew
                  console.log('Crew not found, showing crew list');
                  
                  // Get user's crews to choose from
                  const { data: userCrews } = await supabase
                    .from('crews')
                    .select('id, name')
                    .eq('creator_id', userId)
                    .order('name');
                  
                  if (userCrews && userCrews.length === 0) {
                    // ZERO crews: Ask to create first crew
                    responseContent = 'No crews found. Type \'Create Crew\' to create your first crew.';
                    shouldSendSMS = true;
                  } else if (userCrews && userCrews.length === 1) {
                    // ONE crew: Auto-select and skip to event details
                    const singleCrew = userCrews[0];
                    console.log('Auto-selecting single crew:', singleCrew.name);
                    
                    // Get existing extracted_data to preserve it
                    const { data: currentStateData } = await supabase
                      .from('conversation_state')
                      .select('extracted_data')
                      .eq('user_id', userId)
                      .single();
                    
                    // Append to existing extracted_data
                    const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                    const updatedExtractedData = [...existingData, {
                      action: 'SEND_INVITATIONS_STEP_1',
                      crew_id: singleCrew.id,
                      crew_name: singleCrew.name,
                      timestamp: new Date().toISOString()
                    }];
                    
                    // Update conversation state
                    await supabase
                      .from('conversation_state')
                      .update({
                        current_state: 'send_invitations_step_1',
                        last_action: 'SEND_INVITATIONS_STEP_1',
                        last_action_timestamp: new Date().toISOString(),
                        extracted_data: updatedExtractedData
                      })
                      .eq('user_id', userId);
                    
                    responseContent = `Creating event for "${singleCrew.name}". What's the event name?`;
                    shouldSendSMS = true;
                  } else {
                    // MULTIPLE crews: Show numbered list for selection
                    let crewList = 'Which crew do you want to create an event for?\n';
                    userCrews.forEach((crew, index) => {
                      crewList += `${index + 1}. ${crew.name}\n`;
                    });
                    crewList += '\nReply with the crew number or \'Create Crew\' to make a new one.';
                    
                    responseContent = crewList;
                    shouldSendSMS = true;
                    
                    // Get existing extracted_data to preserve it
                    const { data: currentStateData } = await supabase
                      .from('conversation_state')
                      .select('extracted_data')
                      .eq('user_id', userId)
                      .single();
                    
                    // Append to existing extracted_data
                    const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                    const updatedExtractedData = [...existingData, {
                      crew_list: userCrews,
                      crew_list_message: crewList,
                      action: 'SEND_INVITATIONS_CREW_LIST_SHOWN',
                      timestamp: new Date().toISOString()
                    }];
                    
                    // Update conversation state
                    await supabase
                      .from('conversation_state')
                      .update({
                        current_state: 'normal',
                        last_action: 'SEND_INVITATIONS_CREW_LIST_SHOWN',
                        last_action_timestamp: new Date().toISOString(),
                        extracted_data: updatedExtractedData
                      })
                      .eq('user_id', userId);
                  }
                }
              } else {
                // No crew_name provided - implement smart crew selection logic
                console.log('No crew_name provided, implementing smart crew selection');
                
                // Get user's crews to choose from
                const { data: userCrews } = await supabase
                  .from('crews')
                  .select('id, name')
                  .eq('creator_id', userId)
                  .order('name');
              
              if (userCrews && userCrews.length === 0) {
                // ZERO crews: Ask to create first crew
                responseContent = 'No crews found. Type \'Create Crew\' to create your first crew.';
                shouldSendSMS = true;
              } else if (userCrews && userCrews.length === 1) {
                // ONE crew: Auto-select and skip to event details
                const singleCrew = userCrews[0];
                console.log('Auto-selecting single crew:', singleCrew.name);
                
                // Get existing extracted_data to preserve it
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Append to existing extracted_data
                const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                const updatedExtractedData = [...existingData, {
                  action: 'SEND_INVITATIONS_STEP_1',
                  crew_id: singleCrew.id,
                  crew_name: singleCrew.name,
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'send_invitations_step_1',
                    last_action: 'SEND_INVITATIONS_STEP_1',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedData
                  })
                  .eq('user_id', userId);
                
                responseContent = `Add event details for ${singleCrew.name}: Event name, date, start time, end time (optional), location, notes (optional).`;
                shouldSendSMS = true;
              } else {
                // MULTIPLE crews: Show numbered list for selection
                let crewList = 'Which crew do you want to create an event for?\n';
                userCrews.forEach((crew, index) => {
                  crewList += `${index + 1}. ${crew.name}\n`;
                });
                crewList += '\nReply with the crew number or \'Create Crew\' to make a new one.';
                
                responseContent = crewList;
                shouldSendSMS = true;
                
                // Get existing extracted_data to preserve it
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Append to existing extracted_data
                const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                const updatedExtractedData = [...existingData, {
                  crew_list: userCrews,
                  crew_list_message: crewList,
                  action: 'SEND_INVITATIONS_CREW_LIST_SHOWN',
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'normal',
                    last_action: 'SEND_INVITATIONS_CREW_LIST_SHOWN',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedData
                  })
                  .eq('user_id', userId);
              }
              }
            }
          } else if (substep === 2 || extractedParams.event_name || extractedParams.event_date || extractedParams.event_time || extractedParams.event_location || extractedParams.event_notes) {
            // Step 2: Event details collection (all-at-once with sequential fallback)
            console.log('Processing SEND_INVITATIONS step 2: Event details');

            // Get existing extracted_data to preserve it
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();

            // Merge new parameters with existing data from conversation state
            const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
            
            // Find existing event details from previous messages
            let existingEventDetails = {};
            for (const item of existingData) {
              if (item.action === 'SEND_INVITATIONS' || item.action === 'SEND_INVITATIONS_STEP_1' || item.action === 'SEND_INVITATIONS_STEP_2') {
                if (item.event_name) existingEventDetails.event_name = item.event_name;
                if (item.event_date) existingEventDetails.event_date = item.event_date;
                if (item.event_time) existingEventDetails.event_time = item.event_time;
                if (item.event_location) existingEventDetails.event_location = item.event_location;
                if (item.event_notes !== undefined) existingEventDetails.event_notes = item.event_notes;
                if (item.crew_id) existingEventDetails.crew_id = item.crew_id;
                if (item.crew_name) existingEventDetails.crew_name = item.crew_name;
              }
            }

            // Merge new parameters with existing ones
            const mergedEventDetails = {
              ...existingEventDetails,
              ...extractedParams,
              action: 'SEND_INVITATIONS_STEP_2',
              timestamp: new Date().toISOString()
            };

            const updatedExtractedData = [...existingData, mergedEventDetails];

            // Check for missing required fields in order - check all accumulated data
            let missingField = null;
            
            // Get all event details from the conversation state
            let hasEventName = false;
            let hasEventDate = false;
            let hasEventTime = false;
            let hasEventLocation = false;
            
            // Check all extracted_data for event details
            for (const item of updatedExtractedData) {
              if (item.action === 'SEND_INVITATIONS_STEP_1' || item.action === 'SEND_INVITATIONS_STEP_2' || item.action === 'SEND_INVITATIONS') {
                if (item.event_name) hasEventName = true;
                if (item.event_date) hasEventDate = true;
                if (item.event_time) hasEventTime = true;
                if (item.event_location) hasEventLocation = true;
              }
            }
            
            // Check for missing fields in order
            if (!hasEventName) {
              missingField = 'event_name';
            } else if (!hasEventDate) {
              missingField = 'event_date';
            } else if (!hasEventTime) {
              missingField = 'event_time';
            } else if (!hasEventLocation) {
              missingField = 'event_location';
            }

            // Update conversation state
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'send_invitations_step_2',
                last_action: 'SEND_INVITATIONS_STEP_2',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: updatedExtractedData
              })
              .eq('user_id', userId);

            if (missingField) {
              // Ask for the next missing field
              const fieldMessages = {
                event_name: "What's the event name?",
                event_date: "What's the date?",
                event_time: "What's the start time?",
                event_location: "What's the location?"
              };

              responseContent = fieldMessages[missingField];
              shouldSendSMS = true;
            } else {
              // All required fields provided, proceed to confirmation
              // Get all event details from accumulated data
              let eventName = '';
              let eventLocation = '';
              let eventDate = '';
              let eventTime = '';
              let eventNotes = '';
              
              for (const item of updatedExtractedData) {
                if (item.action === 'SEND_INVITATIONS_STEP_1' || item.action === 'SEND_INVITATIONS_STEP_2' || item.action === 'SEND_INVITATIONS') {
                  if (item.event_name) eventName = item.event_name;
                  if (item.event_date) eventDate = item.event_date;
                  if (item.event_time) eventTime = item.event_time;
                  if (item.event_location) eventLocation = item.event_location;
                  if (item.event_notes) eventNotes = item.event_notes;
                }
              }

              responseContent = `Confirm: ${eventName} at ${eventLocation} on ${eventDate}, ${eventTime}${eventNotes ? `. Note: ${eventNotes}` : ''}. Send invites?`;
              shouldSendSMS = true;
              
              // Update conversation state to indicate we're waiting for confirmation
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'send_invitations_step_5',
                  waiting_for: 'send_invitations_confirmation',
                  last_action: 'SEND_INVITATIONS_CONFIRMATION_SHOWN',
                  last_action_timestamp: new Date().toISOString()
                })
                .eq('user_id', userId);
            }
          } else if (extractedParams.no || extractedParams.confirm === false) {
            // User declined to create event
            console.log('Processing SEND_INVITATIONS: User declined event creation');
            
            // Clear conversation state
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                last_action: 'SEND_INVITATIONS_DECLINED',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: []
              })
              .eq('user_id', userId);
            
            responseContent = 'No problem! Event not created. You can start over anytime by saying "create event" or "send invitations".';
            shouldSendSMS = true;
          } else if (extractedParams.no || extractedParams.confirm === false) {
            // Step 6: User declined to create event
            console.log('Processing SEND_INVITATIONS step 6: User declined event creation');
            
            // Clear conversation state
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                last_action: 'SEND_INVITATIONS_DECLINED',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: []
              })
              .eq('user_id', userId);
            
            responseContent = 'No problem! Event not created. You can start over anytime by saying "create event" or "send invitations".';
            shouldSendSMS = true;
          } else {
            // Context-aware error handling for SEND_INVITATIONS workflow
            // Provide specific error messages for missing fields
            if (currentStep === 1) {
              responseContent = 'I didn\'t understand that. Reply with a crew number, \'Create Crew\', or \'exit\' to do something else.';
            } else if (currentStep === 2) {
              // Check what field we're waiting for based on existing data
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();

              if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
                const latestData = currentStateData.extracted_data[currentStateData.extracted_data.length - 1];

                // Determine which field we're waiting for
                if (latestData.action === 'SEND_INVITATIONS_STEP_2' && latestData.event_name && !latestData.event_date) {
                  responseContent = 'I didn\'t understand that. What\'s the date? Type \'exit\' to cancel.';
                } else if (latestData.action === 'SEND_INVITATIONS_STEP_2' && latestData.event_name && latestData.event_date && !latestData.event_time) {
                  responseContent = 'I didn\'t understand that. What\'s the start time? Type \'exit\' to cancel.';
                } else if (latestData.action === 'SEND_INVITATIONS_STEP_2' && latestData.event_name && latestData.event_date && latestData.event_time && !latestData.event_location) {
                  responseContent = 'I didn\'t understand that. What\'s the location? Type \'exit\' to cancel.';
                } else {
                  responseContent = 'I didn\'t understand that. What\'s the event name? Type \'exit\' to cancel.';
                }
              } else {
                responseContent = 'I didn\'t understand that. What\'s the event name? Type \'exit\' to cancel.';
              }
            } else {
              responseContent = 'I didn\'t understand that. Provide event details (name, date, time, location) or type \'exit\' to cancel.';
            }
            shouldSendSMS = true;
          }
        } else {
          responseContent = 'Unable to create event. Please try again.';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error in SEND_INVITATIONS:', error);
        responseContent = 'Failed to create event. Please try again.';
        shouldSendSMS = true;
      }
        } else if (action === 'INVITE_MORE_PEOPLE' || action.startsWith('INVITE_MORE_PEOPLE_STEP_')) {
          // Handle INVITE_MORE_PEOPLE action with multi-step workflow
          console.log('INVITE_MORE_PEOPLE action detected, starting workflow');
          try {
        if (phone_number && userId) {
          // Check current state to determine which step we should be at
          const { data: currentStateData } = await supabase
            .from('conversation_state')
            .select('current_state, extracted_data')
            .eq('user_id', userId)
            .single();
          
          // Determine current step based on state and extracted_data
          let currentStep = 1;
          if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
            
            // Simple step detection based on assistant response
            // Check specific actions first, then fallbacks
            if (action === 'INVITE_MORE_PEOPLE_STEP_5') {
              currentStep = 5; // Confirmation
            } else if (action === 'INVITE_MORE_PEOPLE_STEP_4') {
              currentStep = 4; // Crew/contacts selected
            } else if (action === 'INVITE_MORE_PEOPLE_STEP_3') {
              currentStep = 3; // Method selected
            } else if (action === 'INVITE_MORE_PEOPLE_STEP_2') {
              currentStep = 2; // Event selected
            } else if (extractedParams.event_id) {
              currentStep = 2; // Event selected (fallback)
            } else if (extractedParams.invite_method) {
              currentStep = 3; // Method selected (fallback)
            } else if (extractedParams.crew_id || extractedParams.contacts) {
              currentStep = 4; // Crew/contacts selected (fallback)
            } else {
              currentStep = 1; // Need event selection
            }
            
          }
          
          console.log('INVITE_MORE_PEOPLE current step:', currentStep, 'extractedParams:', extractedParams);
          console.log('INVITE_MORE_PEOPLE step 1 condition check:', {
            currentStep,
            hasEventId: !!extractedParams.event_id,
            hasInviteMethod: !!extractedParams.invite_method,
            hasCrewId: !!extractedParams.crew_id,
            hasContacts: !!extractedParams.contacts
          });
          
          // Handle different steps based on action only
          if (action === 'INVITE_MORE_PEOPLE' || action === 'INVITE_MORE_PEOPLE_STEP_1') {
            // Step 1: Event selection
            console.log('Processing INVITE_MORE_PEOPLE step 1: Event selection');
            
            // Get user's active events
            const { data: userEvents } = await supabase
              .from('events')
              .select(`
                id,
                title,
                event_date,
                start_time,
                location,
                crews (name)
              `)
              .eq('creator_id', userId)
              .eq('status', 'active')
              .gte('event_date', new Date().toISOString().split('T')[0])
              .order('event_date', { ascending: true });
            
            if (!userEvents || userEvents.length === 0) {
              responseContent = 'No active events found. Create an event first by saying "create event".';
              shouldSendSMS = true;
            } else if (userEvents.length === 1) {
              // Only one event - use it automatically and move to step 2 (method selection)
              const event = userEvents[0];
              const eventDate = new Date(event.event_date).toLocaleDateString();
              const eventTime = event.start_time ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
              
              // Get existing extracted_data to preserve it
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              // Append to existing extracted_data
              const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
              const updatedExtractedData = [...existingData, {
                action: 'INVITE_MORE_PEOPLE_STEP_2',
                event_id: event.id,
                event_title: event.title,
                event_date: eventDate,
                event_time: eventTime,
                event_location: event.location,
                crew_name: event.crews?.name,
                timestamp: new Date().toISOString()
              }];
              
              // Update conversation state to step 2 (method selection)
              const { error: updateError } = await supabase
                .from('conversation_state')
                .update({
                  current_state: 'invite_more_people_step_2',
                  last_action: 'INVITE_MORE_PEOPLE_STEP_2',
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                })
                .eq('user_id', userId);
              
              if (updateError) {
                console.error('Error updating conversation state:', updateError);
              } else {
                console.log('Successfully stored event selection in conversation state');
              }
              
              // Handle empty event title by providing a fallback
              const eventTitle = event.title && event.title.trim() !== '' ? event.title : `Event on ${eventDate}`;
              responseContent = `Adding people to "${eventTitle}" on ${eventDate}${eventTime ? ` at ${eventTime}` : ''}. Add people from: 1) Existing crew 2) New contacts (name+phone)`;
              shouldSendSMS = true;
            } else {
              // Multiple events - ask user to choose
              let eventList = 'Which event do you want to add people to?\n';
              // Apply fallback titles to all events before creating the list
              const eventsWithFallbackTitles = userEvents.map(event => {
                const eventDate = new Date(event.event_date).toLocaleDateString();
                const eventTitle = event.title && event.title.trim() !== '' ? event.title : `Event on ${eventDate}`;
                return { ...event, title: eventTitle };
              });
              
              eventsWithFallbackTitles.forEach((event, index) => {
                const eventDate = new Date(event.event_date).toLocaleDateString();
                const eventTime = event.start_time ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                eventList += `${index + 1}. ${event.title} - ${eventDate}${eventTime ? ` at ${eventTime}` : ''}\n`;
              });
              
              responseContent = eventList;
              shouldSendSMS = true;
              
              // Get existing extracted_data to preserve it
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              // Append to existing extracted_data
              const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
              const updatedExtractedData = [...existingData, {
                event_list: eventsWithFallbackTitles,
                event_list_message: eventList,
                action: 'INVITE_MORE_PEOPLE_EVENT_LIST_SHOWN',
                timestamp: new Date().toISOString()
              }];
              
              // Update conversation state
              const { error: updateError } = await supabase
                .from('conversation_state')
                .update({
                  current_state: 'invite_more_people_event_selection',
                  waiting_for: 'invite_more_people_event_selection',
                  last_action: 'INVITE_MORE_PEOPLE_EVENT_LIST_SHOWN',
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                })
                .eq('user_id', userId);
              
              if (updateError) {
                console.error('Error updating conversation state for multiple events:', updateError);
              } else {
                console.log('Successfully stored event list in conversation state for multiple events');
              }
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_2') {
            // Step 2: Event selection and method selection
            console.log('Processing INVITE_MORE_PEOPLE step 2: Event selection and method selection');
            if (extractedParams.event_id) {
              // User selected an event - get complete event details from database using event_id
              console.log('Processing INVITE_MORE_PEOPLE step 2: Getting complete event details');

              // Get complete event details from database using event_id
              const { data: eventData } = await supabase
                .from('events')
                .select(`
                  id,
                  title,
                  event_date,
                  start_time,
                  location,
                  crews (name)
                `)
                .eq('id', extractedParams.event_id)
                .single();

              if (eventData) {
                const eventDate = new Date(eventData.event_date).toLocaleDateString();
                const eventTime = eventData.start_time ? new Date(`2000-01-01T${eventData.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

                // Handle empty event title by providing a fallback
                const eventTitle = extractedParams.event_title && extractedParams.event_title.trim() !== ''
                  ? extractedParams.event_title
                  : `Event on ${eventDate}`;

                const updatedExtractedData = [{
                  action: 'INVITE_MORE_PEOPLE_STEP_2',
                  event_id: eventData.id,
                  event_title: eventTitle,
                  event_date: eventDate,
                  event_time: eventTime,
                  event_location: eventData.location,
                  crew_id: extractedParams.crew_id,
                  crew_name: eventData.crews?.name,
                  timestamp: new Date().toISOString()
                }];
              
              // Update conversation state to step 2 (method selection)
              const { error: updateError } = await supabase
                .from('conversation_state')
                .update({
                  current_state: 'invite_more_people_step_2',
                  last_action: 'INVITE_MORE_PEOPLE_STEP_2',
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                })
                .eq('user_id', userId);
              
              if (updateError) {
                console.error('Error updating conversation state for event selection:', updateError);
                responseContent = 'Sorry, there was an error processing your event selection. Please try again.';
                shouldSendSMS = true;
              } else {
                console.log('Successfully updated conversation state for event selection');
                responseContent = `You selected "${eventTitle}" on ${eventDate} at ${eventTime}. Add people from: 1) Existing crew 2) New contacts (name+phone)`;
                shouldSendSMS = true;
              }
            } else {
              responseContent = 'Event not found. Please try again.';
              shouldSendSMS = true;
            }
            } else {
              // Step 2: Method selection - check if user selected invite method
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();
              
              const eventData = currentStateData?.extracted_data?.find(item => 
                item.action === 'INVITE_MORE_PEOPLE_STEP_1'
              );
              
              if (eventData) {
                // Check if user selected invite method
                if (extractedParams.invite_method) {
                  // User selected invite method, move to step 3
                  const updatedExtractedData = [...(currentStateData?.extracted_data || []), {
                    action: 'INVITE_MORE_PEOPLE_STEP_3',
                    invite_method: extractedParams.invite_method,
                    timestamp: new Date().toISOString()
                  }];
                  
                  const { error: updateError } = await supabase
                    .from('conversation_state')
                    .update({
                      current_state: 'invite_more_people_step_3',
                      last_action: 'INVITE_MORE_PEOPLE_STEP_2',
                      last_action_timestamp: new Date().toISOString(),
                      extracted_data: updatedExtractedData
                    })
                    .eq('user_id', userId);
                  
                  if (updateError) {
                    console.error('Error updating conversation state for method selection:', updateError);
                    responseContent = 'Sorry, there was an error processing your selection. Please try again.';
                    shouldSendSMS = true;
                  } else {
                    console.log('Successfully updated conversation state for method selection');
                    if (extractedParams.invite_method === 'existing_crew') {
                      responseContent = 'Which crew do you want to invite from?';
                      shouldSendSMS = true;
                    } else if (extractedParams.invite_method === 'new_contacts') {
                      responseContent = 'Send me the names and phone numbers of people to invite (e.g., "John Smith 555-1234, Jane Doe 555-5678")';
                      shouldSendSMS = true;
                    }
                  }
                } else {
                  // No method selected yet, ask for method selection
                  responseContent = `Adding people to "${eventData.event_title}". Add people from: 1) Existing crew 2) New contacts (name+phone)`;
                  shouldSendSMS = true;
                }
              } else {
                // No event data found, go back to event selection
                responseContent = 'Which event do you want to add people to?';
                shouldSendSMS = true;
              }
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_3') {
            // Step 3: Invite method selection
            console.log('Processing INVITE_MORE_PEOPLE step 3: Invite method selected');
            
            // Get existing extracted_data to preserve it
            const { data: currentStateData } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();
            
            // Append to existing extracted_data
            const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
            const updatedExtractedData = [...existingData, {
              action: 'INVITE_MORE_PEOPLE_STEP_3',
              invite_method: extractedParams.invite_method,
              timestamp: new Date().toISOString()
            }];
            
            if (extractedParams.invite_method === 'existing_crew') {
              // Get current event's crew to exclude it from the list
              let currentEventCrewId = null;
              if (existingData.length > 0) {
                for (let i = existingData.length - 1; i >= 0; i--) {
                  const item = existingData[i];
                  if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                    // Get the crew_id for this event
                    const { data: eventData } = await supabase
                      .from('events')
                      .select('crew_id')
                      .eq('id', item.event_id)
                      .single();
                    currentEventCrewId = eventData?.crew_id;
                    break;
                  }
                }
              }
              
              // Show crew selection (excluding current event's crew)
              let crewQuery = supabase
                .from('crews')
                .select('id, name')
                .eq('creator_id', userId)
                .order('name');
              
              if (currentEventCrewId) {
                crewQuery = crewQuery.neq('id', currentEventCrewId);
              }
              
              const { data: userCrews } = await crewQuery;
              
              if (userCrews && userCrews.length > 0) {
                let crewList = 'Which crew do you want to invite from?\n';
                userCrews.forEach((crew, index) => {
                  crewList += `${index + 1}. ${crew.name}\n`;
                });
                
                responseContent = crewList;
                shouldSendSMS = true;
                
                // Append crew list to extracted_data for AI context
                const updatedExtractedDataWithCrewList = [...updatedExtractedData, {
                  action: 'INVITE_MORE_PEOPLE_CREW_LIST_SHOWN',
                  crew_list: userCrews,
                  crew_list_message: crewList,
                  crew_mapping: userCrews.map((crew, index) => ({
                    number: index + 1,
                    crew_id: crew.id,
                    crew_name: crew.name
                  })),
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                const { error: updateError } = await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'invite_more_people_step_3',
                    last_action: 'INVITE_MORE_PEOPLE_STEP_3',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedDataWithCrewList
                  })
                  .eq('user_id', userId);
                
                if (updateError) {
                  console.error('Error updating conversation state for crew selection:', updateError);
                  responseContent = 'Sorry, there was an error processing your selection. Please try again.';
                  shouldSendSMS = true;
                }
              } else {
                responseContent = 'No crews found. Please create a crew first or choose "New contacts" option.';
                shouldSendSMS = true;
              }
            } else if (extractedParams.invite_method === 'new_contacts') {
              // Ask for new contacts
              responseContent = 'Send me the names and phone numbers of people to invite (e.g., "John Smith 555-1234, Jane Doe 555-5678")';
              shouldSendSMS = true;
              
              // Update conversation state to step 3 (waiting for contact details)
              const { error: updateError } = await supabase
                .from('conversation_state')
                .update({
                  current_state: 'invite_more_people_step_3',
                  last_action: 'INVITE_MORE_PEOPLE_STEP_3',
                  last_action_timestamp: new Date().toISOString(),
                  extracted_data: updatedExtractedData
                })
                .eq('user_id', userId);
              
              if (updateError) {
                console.error('Error updating conversation state for new contacts:', updateError);
                responseContent = 'Sorry, there was an error processing your selection. Please try again.';
                shouldSendSMS = true;
              }
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_4A') {
            // Step 4A: Crew selection confirmation
            console.log('Processing INVITE_MORE_PEOPLE step 4A: Crew selection');
            
            if (extractedParams.crew_id) {
              // Get crew members for the selected crew
              const { data: crewMembers } = await supabase
                .from('crew_members')
                .select(`
                  id,
                  contact_id,
                  role,
                  contacts (first_name, last_name, phone_number)
                `)
                .eq('crew_id', extractedParams.crew_id);
              
              if (crewMembers && crewMembers.length > 0) {
                // Get existing extracted_data to preserve it
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Append to existing extracted_data
                const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                const updatedExtractedData = [...existingData, {
                  action: 'INVITE_MORE_PEOPLE_STEP_4A',
                  crew_id: extractedParams.crew_id,
                  crew_name: extractedParams.crew_name,
                  crew_members: crewMembers,
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'invite_more_people_step_4a',
                    last_action: 'INVITE_MORE_PEOPLE_STEP_4A',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedData
                  })
                  .eq('user_id', userId);
                
                responseContent = `Found ${crewMembers.length} members in ${extractedParams.crew_name}. Send invitations to all members? (yes/no)`;
                shouldSendSMS = true;
              } else {
                responseContent = 'No members found in this crew.';
                shouldSendSMS = true;
              }
            } else {
              responseContent = 'Please select a crew.';
              shouldSendSMS = true;
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_5A') {
            // Step 5A: Send invitations to selected crew
            console.log('Processing INVITE_MORE_PEOPLE step 5A: Sending invitations to crew');
            
            // Get data from extractedParams (from assistant response)
            let eventId = extractedParams.event_id;
            let eventTitle = extractedParams.event_title;
            let eventDate = extractedParams.event_date;
            let eventTime = extractedParams.event_time;
            let eventLocation = extractedParams.event_location;
            let crewId = extractedParams.crew_id;
            let crewName = extractedParams.crew_name;
            let crewMembers = extractedParams.crew_members || [];

            console.log('Data from assistant response:', {
              eventId, eventTitle, eventDate, eventTime, eventLocation, 
              crewId, crewName, crewMembers: crewMembers.length
            });

            // If not available in extractedParams, get from extracted_data
            if (!eventId || crewMembers.length === 0) {
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();

              if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
                // Get event data from step 2
                for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
                  const item = currentStateData.extracted_data[i];
                  if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                    eventId = item.event_id;
                    eventTitle = item.event_title;
                    eventDate = item.event_date;
                    eventTime = item.event_time;
                    eventLocation = item.event_location;
                    break;
                  }
                }
                
                // Get crew data from step 4A
                for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
                  const item = currentStateData.extracted_data[i];
                  if (item.action === 'INVITE_MORE_PEOPLE_STEP_4A' && item.crew_id) {
                    crewId = item.crew_id;
                    crewName = item.crew_name;
                    crewMembers = item.crew_members || [];
                    break;
                  }
                }
              }
            }

            console.log('Final data for crew invitations:', {
              eventId, eventTitle, eventDate, eventTime, eventLocation, 
              crewId, crewName, crewMembers: crewMembers.length
            });

            if (eventId && crewId && crewMembers.length > 0) {
              try {
                // Get the event's crew to add the selected crew members to it
                const { data: eventData } = await supabase
                  .from('events')
                  .select('crew_id')
                  .eq('id', eventId)
                  .single();

                if (eventData?.crew_id) {
                  const eventCrewId = eventData.crew_id;
                  
                  // Add crew members to the event's crew
                  const memberIds = crewMembers.map(member => member.id);
                  
                  if (memberIds.length > 0) {
                    // Use send-invitations function to send invitations to specific crew members
                    try {
                      const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          event_id: eventId,
                          inviting_user_id: userId,
                          selected_member_ids: memberIds
                        })
                      });

                      if (sendInvitationsResponse.ok) {
                        const invitationsResult = await sendInvitationsResponse.json();
                        console.log('Crew invitations sent successfully:', invitationsResult);
                        
                        // Clear conversation state after successful completion
                        await supabase
                          .from('conversation_state')
                          .update({
                            current_state: 'normal',
                            waiting_for: null,
                            last_action: null,
                            last_action_timestamp: null,
                            extracted_data: null
                          })
                          .eq('user_id', userId);
                        
                        const invitationsSent = invitationsResult.invitations_sent || memberIds.length;
                        responseContent = `${invitationsSent} more invites sent to ${eventTitle}! Text "RSVPs" to see responses.`;
                        shouldSendSMS = true;
                      } else {
                        console.error('Failed to send crew invitations:', await sendInvitationsResponse.text());
                        responseContent = 'Sorry, there was an error sending invitations. Please try again.';
                        shouldSendSMS = true;
                      }
                    } catch (invitationError) {
                      console.error('Error sending crew invitations:', invitationError);
                      responseContent = 'Sorry, there was an error sending invitations. Please try again.';
                      shouldSendSMS = true;
                    }
                  } else {
                    responseContent = 'No crew members found to invite.';
                    shouldSendSMS = true;
                  }
                } else {
                  responseContent = 'Event not found. Please try again.';
                  shouldSendSMS = true;
                }
              } catch (error) {
                console.error('Error processing crew invitations:', error);
                responseContent = 'Sorry, there was an error processing your request. Please try again.';
                shouldSendSMS = true;
              }
            } else {
              responseContent = 'Missing event or crew information. Please start over.';
              shouldSendSMS = true;
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_4') {
            // Step 4: Crew selection or contact parsing
            console.log('Processing INVITE_MORE_PEOPLE step 4: Crew/contact selection');
            
            if (extractedParams.crew_id) {
              // Crew selected - get crew members
              const { data: crewMembers } = await supabase
                .from('crew_members')
                .select(`
                  id,
                  first_name,
                  last_name,
                  phone_number,
                  contacts (first_name, last_name, phone_number)
                `)
                .eq('crew_id', extractedParams.crew_id);
              
              if (crewMembers && crewMembers.length > 0) {
                // Get existing extracted_data to preserve it
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Append to existing extracted_data
                const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                const updatedExtractedData = [...existingData, {
                  action: 'INVITE_MORE_PEOPLE_STEP_4',
                  crew_id: extractedParams.crew_id,
                  crew_name: extractedParams.crew_name,
                  crew_members: crewMembers,
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'invite_more_people_step_4',
                    last_action: 'INVITE_MORE_PEOPLE_STEP_4',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedData
                  })
                  .eq('user_id', userId);
                
                responseContent = `Found ${crewMembers.length} members in ${extractedParams.crew_name}. Send invitations to all members? (yes/no)`;
                shouldSendSMS = true;
              } else {
                responseContent = 'No members found in this crew.';
                shouldSendSMS = true;
              }
            } else if (extractedParams.contacts) {
              // New contacts provided - parse and validate
              console.log('Processing INVITE_MORE_PEOPLE step 4: New contacts');
              console.log('extractedParams.contacts:', extractedParams.contacts);
              
              let contacts = [];
              
              // Handle both string and array formats
              if (Array.isArray(extractedParams.contacts)) {
                // Already parsed as array by AI assistant
                contacts = extractedParams.contacts.map(contact => {
                  if (typeof contact === 'object' && contact.name && contact.phone) {
                    // Normalize phone number
                    let phone = contact.phone.replace(/\D/g, ''); // Remove non-digits
                    if (phone.length === 10) {
                      phone = '+1' + phone;
                    } else if (phone.length === 11 && phone.startsWith('1')) {
                      phone = '+' + phone;
                    } else if (phone.length === 11 && phone.startsWith('+1')) {
                      // Already formatted
                    }
                    return {
                      name: contact.name,
                      phone: phone
                    };
                  }
                  return null;
                }).filter(contact => contact !== null);
              } else if (typeof extractedParams.contacts === 'string') {
                // Parse contacts from the message string
                const contactPattern = /([A-Za-z\s]+)\s+(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/g;
                let match;
                
                while ((match = contactPattern.exec(extractedParams.contacts)) !== null) {
                  const name = match[1].trim();
                  let phone = match[2].replace(/\D/g, ''); // Remove non-digits
                  
                  // Normalize phone number
                  if (phone.length === 10) {
                    phone = '+1' + phone;
                  } else if (phone.length === 11 && phone.startsWith('1')) {
                    phone = '+' + phone;
                  } else if (phone.length === 11 && phone.startsWith('+1')) {
                    // Already formatted
                  } else {
                    continue; // Skip invalid phone numbers
                  }
                  
                  contacts.push({
                    name: name,
                    phone: phone
                  });
                }
              }
              
              if (contacts.length > 0) {
                // Get existing extracted_data to preserve it
                const { data: currentStateData } = await supabase
                  .from('conversation_state')
                  .select('extracted_data')
                  .eq('user_id', userId)
                  .single();
                
                // Append to existing extracted_data
                const existingData = Array.isArray(currentStateData?.extracted_data) ? currentStateData.extracted_data : [];
                const updatedExtractedData = [...existingData, {
                  action: 'INVITE_MORE_PEOPLE_STEP_4',
                  contacts: contacts,
                  timestamp: new Date().toISOString()
                }];
                
                // Update conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'invite_more_people_step_4',
                    last_action: 'INVITE_MORE_PEOPLE_STEP_4',
                    last_action_timestamp: new Date().toISOString(),
                    extracted_data: updatedExtractedData
                  })
                  .eq('user_id', userId);
                
                // Get event title from conversation state for confirmation message
                let eventTitle = 'this event';
                if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
                  for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
                    const item = currentStateData.extracted_data[i];
                    if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_title) {
                      eventTitle = item.event_title;
                      break;
                    }
                  }
                }
                
                responseContent = `Found ${contacts.length} contacts: ${contacts.map(c => `${c.name} (${c.phone})`).join(', ')}. Send invitations to "${eventTitle}"? (yes/no)`;
                shouldSendSMS = true;
              } else {
                responseContent = 'No valid contacts found. Please provide names and phone numbers in format "Name Phone".';
                shouldSendSMS = true;
              }
            } else {
              responseContent = 'Please select a crew or provide contact information.';
              shouldSendSMS = true;
            }
          } else if (action === 'INVITE_MORE_PEOPLE_STEP_5') {
            // Step 5: Confirmation and sending invitations to new contacts
            console.log('Processing INVITE_MORE_PEOPLE step 5: Confirmation and sending');

            // First try to get data from extractedParams (from assistant response)
            let eventId = extractedParams.event_id;
            let eventTitle = extractedParams.event_title;
            let eventDate = extractedParams.event_date;
            let eventTime = extractedParams.event_time;
            let eventLocation = extractedParams.event_location;
            let crewId = extractedParams.crew_id;
            let crewName = extractedParams.crew_name;
            let contacts = extractedParams.contacts || [];

            console.log('Data from assistant response:', {
              eventId, eventTitle, eventDate, eventTime, eventLocation, 
              crewId, crewName, contacts: contacts.length
            });

            // If not available in extractedParams, get from extracted_data
            if (!eventId || contacts.length === 0) {
              console.log('Falling back to extracted_data');
              const { data: currentStateData } = await supabase
                .from('conversation_state')
                .select('extracted_data')
                .eq('user_id', userId)
                .single();

              // Extract event and contacts from extracted_data
              if (currentStateData?.extracted_data && Array.isArray(currentStateData.extracted_data)) {
                for (let i = currentStateData.extracted_data.length - 1; i >= 0; i--) {
                  const item = currentStateData.extracted_data[i];
                  if (item.action === 'INVITE_MORE_PEOPLE_STEP_2' && item.event_id) {
                    eventId = eventId || item.event_id;
                    eventTitle = eventTitle || item.event_title;
                    eventDate = eventDate || item.event_date;
                    eventTime = eventTime || item.event_time;
                    eventLocation = eventLocation || item.event_location;
                    crewId = crewId || item.crew_id;
                    crewName = crewName || item.crew_name;
                  } else if (item.action === 'INVITE_MORE_PEOPLE_STEP_4' && item.contacts) {
                    contacts = contacts.length > 0 ? contacts : (item.contacts || []);
                  }
                }
              }
            }

            // Parse contacts if they're provided as a string or ensure they're objects
            let contactsArray = [];
            if (typeof contacts === 'string') {
              // Parse contacts string into objects
              const contactPattern = /([A-Za-z\s]+)\s+(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/g;
              let match;
              while ((match = contactPattern.exec(contacts)) !== null) {
                const name = match[1].trim();
                let phone = match[2].replace(/\D/g, ''); // Remove non-digits

                // Normalize phone number
                if (phone.length === 10) {
                  phone = '+1' + phone;
                } else if (phone.length === 11 && phone.startsWith('1')) {
                  phone = '+' + phone;
                } else if (phone.length === 11 && phone.startsWith('+1')) {
                  // Already formatted
                } else {
                  continue; // Skip invalid phone numbers
                }

                contactsArray.push({
                  name: name,
                  phone: phone
                });
              }
            } else if (Array.isArray(contacts)) {
              // Ensure contacts are properly formatted objects
              contactsArray = contacts.map(contact => {
                if (typeof contact === 'string') {
                  // If it's a string, try to parse it
                  const contactPattern = /([A-Za-z\s]+)\s+(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/g;
                  const match = contactPattern.exec(contact);
                  if (match) {
                    const name = match[1].trim();
                    let phone = match[2].replace(/\D/g, '');
                    if (phone.length === 10) {
                      phone = '+1' + phone;
                    } else if (phone.length === 11 && phone.startsWith('1')) {
                      phone = '+' + phone;
                    }
                    return { name, phone };
                  }
                  return null;
                } else if (contact && typeof contact === 'object' && contact.name && contact.phone) {
                  return contact;
                }
                return null;
              }).filter(contact => contact !== null);
            }

            if (!eventId || contactsArray.length === 0) {
              responseContent = 'No event or contacts found. Please start over by saying "invite more people".';
              shouldSendSMS = true;
            } else {
              try {
                let invitationsSent = 0;
                let newContactsCreated = 0;
                let contactsProcessed = 0;

                // Get the event's crew information
                // For INVITE_MORE_PEOPLE, we need to find the appropriate crew for this event
                let eventCrewId = null;
                let eventCrewName = '';

                // First try to get crew_id from conversation state if available
                if (crewId) {
                  eventCrewId = crewId;
                  eventCrewName = crewName;
                } else {
                  // If not in conversation state, get from database based on the event's creator_id
                  const { data: eventCrews } = await supabase
                    .from('crews')
                    .select('id, name')
                    .eq('creator_id', userId)
                    .limit(1);

                  if (eventCrews && eventCrews.length > 0) {
                    eventCrewId = eventCrews[0].id;
                    eventCrewName = eventCrews[0].name;
                  }
                }

                if (!eventCrewId) {
                  responseContent = 'No crew found for this event. Please start over.';
                  shouldSendSMS = true;
                  return;
                }

                // Process new contacts and collect their IDs for invitation sending
                const contactIds = [];

                for (const contact of contactsArray) {
                  console.log(`Processing contact: ${contact.name} (${contact.phone})`);

                  // Check if contact already exists
                  const { data: existingContact } = await supabase
                    .from('contacts')
                    .select('id')
                    .eq('phone_number', contact.phone)
                    .eq('user_id', userId)
                    .single();

                  let contactId;
                  if (existingContact) {
                    contactId = existingContact.id;
                    contactsProcessed++;
                    console.log(`Using existing contact: ${contact.name} (${contact.phone})`);
                  } else {
                    // Create new contact
                    const { data: newContact, error: contactError } = await supabase
                      .from('contacts')
                      .insert({
                        user_id: userId,
                        first_name: contact.name.split(' ')[0],
                        last_name: contact.name.split(' ').slice(1).join(' ') || '',
                        phone_number: contact.phone
                      })
                      .select()
                      .single();

                    if (contactError) {
                      console.error('Error creating contact:', contactError);
                      continue;
                    }

                    contactId = newContact.id;
                    newContactsCreated++;
                    contactsProcessed++;
                    console.log(`Created new contact: ${contact.name} (${contact.phone})`);
                  }

                  // Add contact as crew member to the event's crew
                  if (contactId && eventCrewId) {
                    const { error: crewMemberError } = await supabase
                      .from('crew_members')
                      .insert({
                        crew_id: eventCrewId,
                        contact_id: contactId
                      });

                    if (crewMemberError) {
                      console.error('Error adding crew member:', crewMemberError);
                    } else {
                      console.log(`Added ${contact.name} as crew member to ${eventCrewName}`);
                    }
                  }

                  // Collect contact ID for invitation sending
                  if (contactId) {
                    contactIds.push(contactId);
                  }
                }

                // Get crew member IDs for the contacts we just processed
                if (contactIds.length > 0) {
                  const { data: crewMembers } = await supabase
                    .from('crew_members')
                    .select('id')
                    .eq('crew_id', eventCrewId)
                    .in('contact_id', contactIds);

                  const memberIds = crewMembers?.map(cm => cm.id) || [];

                  if (memberIds.length > 0) {
                    // Use send-invitations function to send invitations to specific crew members
                    try {
                      const sendInvitationsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-invitations`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          event_id: eventId,
                          inviting_user_id: userId,
                          selected_member_ids: memberIds
                        })
                      });

                      if (sendInvitationsResponse.ok) {
                        const invitationsResult = await sendInvitationsResponse.json();
                        console.log('Invitations sent successfully:', invitationsResult);
                        invitationsSent = invitationsResult.invitations_sent || memberIds.length;
                      } else {
                        console.error('Failed to send invitations:', await sendInvitationsResponse.text());
                        // If send-invitations fails, fall back to the number of contacts processed
                        invitationsSent = contactsProcessed;
                      }
                    } catch (invitationError) {
                      console.error('Error sending invitations:', invitationError);
                    }
                  }
                }

                // Clear conversation state after successful completion
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'normal',
                    waiting_for: null,
                    last_action: null,
                    last_action_timestamp: null,
                    extracted_data: null
                  })
                  .eq('user_id', userId);
                
                let responseMessage = `${invitationsSent} more invites sent to ${eventTitle}!`;
                if (newContactsCreated > 0) {
                  responseMessage += ` ${newContactsCreated} new contacts added as crew members.`;
                }
                responseMessage += ' Text "RSVPs" to see responses.';
                
                responseContent = responseMessage;
                shouldSendSMS = true;
                
              } catch (error) {
                console.error('Error in INVITE_MORE_PEOPLE:', error);
                responseContent = 'Failed to send invitations. Please try again.';
                shouldSendSMS = true;
              }
            }
          } else if (extractedParams.no || extractedParams.confirm === false) {
            // User declined to send invitations
            console.log('Processing INVITE_MORE_PEOPLE: User declined');
            
            // Clear conversation state
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                last_action: 'INVITE_MORE_PEOPLE_DECLINED',
                last_action_timestamp: new Date().toISOString(),
                extracted_data: []
              })
              .eq('user_id', userId);
            
            responseContent = 'No problem! No additional invitations sent.';
            shouldSendSMS = true;
          } else {
            // Unknown substep or no data
            responseContent = 'Unknown step in invite more people. Please start over by saying "invite more people".';
            shouldSendSMS = true;
          }
        } else {
          responseContent = 'Unable to add more people. Please try again.';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error in INVITE_MORE_PEOPLE:', error);
        responseContent = 'Failed to add more people. Please try again.';
        shouldSendSMS = true;
      }
    }  else if (action === 'CHECK_RSVPS') {
      console.log('CHECK_RSVPS action detected, processing...');
      console.log('DEBUG: CHECK_RSVPS - action:', action, 'extractedParams:', extractedParams);

      try {
        // Step 1: Check if event_id exists in extracted params
        let eventId = extractedParams.event_id;

        if (!eventId) {
          // Step 1: No event_id - ask user to choose from available events
          console.log('No event_id in params, prompting for event selection');
          
          // Get user's recent events
          const { data: recentEvents, error: eventsError } = await supabase
            .from('events')
            .select('id, title, event_date, start_time, location, status')
            .eq('creator_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(5);

          if (eventsError) {
            console.error('Error fetching events:', eventsError);
            responseContent = 'Sorry, I couldn\'t fetch your events. Please try again.';
            shouldSendSMS = true;
          } else if (recentEvents && recentEvents.length > 0) {
            // Clear current extracted data and show event list
            let eventsList = 'Which event would you like to check RSVPs for?\n\n';
            recentEvents.forEach((event, index) => {
              const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
              const formattedDate = eventDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              });
              eventsList += `${index + 1}. ${event.title} - ${formattedDate}${event.location ? ` at ${event.location}` : ''}\n`;
            });
            eventsList += '\nReply with the number of your chosen event.';

            responseContent = eventsList;
            shouldSendSMS = true;

            // Update conversation state to wait for event selection
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'event_selection',
                current_state: 'check_rsvps_step_1',
               
                extracted_data: [
                  {
                    action: 'CHECK_RSVPS',
                    substep: 1,
                    available_events: recentEvents.map(e => ({ id: e.id, title: e.title }))
                  }
                ]
              })
              .eq('user_id', userId);
          } else {
            responseContent = 'You don\'t have any active events yet. Create an event first to start collecting RSVPs!';
            shouldSendSMS = true;
          }
        } else {
          // Step 2: We have event_id - proceed with RSVP checking
          console.log(`Proceeding with RSVP check for event ${eventId}`);
          await checkRSVPsForEvent(supabase, eventId, userId, phone_number, responseContent, shouldSendSMS);
        }
      } catch (error) {
        console.error('Error in CHECK_RSVPS:', error);
        responseContent = 'Failed to check RSVPs. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'SEND_MESSAGE') {
      console.log('SEND_MESSAGE action detected, processing...');
      console.log('DEBUG: SEND_MESSAGE - action:', action, 'extractedParams:', extractedParams);

      try {
        // Step 1: Check if event_id exists in extracted params
        let eventId = extractedParams.event_id;

        if (!eventId) {
          // Step 1: No event_id - ask user to choose from available events
          console.log('No event_id in params, prompting for event selection');

          // Get user's recent events
          const { data: recentEvents, error: eventsError } = await supabase
            .from('events')
            .select('id, title, event_date, start_time, location, status')
            .eq('creator_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(5);

          if (eventsError) {
            console.error('Error fetching events:', eventsError);
            responseContent = 'Sorry, I couldn\'t fetch your events. Please try again.';
            shouldSendSMS = true;
          } else if (recentEvents && recentEvents.length > 0) {
            // Show event list for selection
            let eventsList = 'Which event would you like to send a message about?\n\n';
            recentEvents.forEach((event, index) => {
              const eventDate = new Date(`${event.event_date}T${event.start_time || '00:00:00'}`);
              const formattedDate = eventDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              });
              eventsList += `${index + 1}. ${event.title} - ${formattedDate}${event.location ? ` at ${event.location}` : ''}\n`;
            });
            eventsList += '\nReply with the number of your chosen event.';

            responseContent = eventsList;
            shouldSendSMS = true;

            // Update conversation state to wait for event selection
            await supabase
              .from('conversation_state')
              .update({
                waiting_for: 'event_selection_send_message',
                current_state: 'send_message_step_1',
                extracted_data: [
                  {
                    action: 'SEND_MESSAGE',
                    substep: 1,
                    available_events: recentEvents.map(e => ({ id: e.id, title: e.title })),
                    event_list: recentEvents.map(e => ({
                      id: e.id,
                      title: e.title,
                      date: e.event_date,
                      time: e.start_time,
                      location: e.location,
                      creator_id: e.creator_id
                    }))
                  }
                ]
              })
              .eq('user_id', userId);
          } else {
            responseContent = 'You don\'t have any active events yet. Create an event first to start sending messages!';
            shouldSendSMS = true;
          }
        } else {
          // Step 2: We have event_id - proceed with targeting selection
          console.log(`Proceeding with message targeting for event ${eventId}`);
          console.log('DEBUG: About to call sendMessageForEvent');
          const result = await sendMessageForEvent(supabase, eventId, userId, phone_number, responseContent, shouldSendSMS);

          // Update the variables with the returned values
          responseContent = result.responseContent;
          shouldSendSMS = result.shouldSendSMS;

          // Update currentState with the returned state
          if (result.currentState) {
            currentState = result.currentState;
            console.log('DEBUG: Updated currentState from sendMessageForEvent:', currentState?.waiting_for);
          }
          // Update conversation state to targeting selection after sendMessageForEvent completes
          await supabase
          .from('conversation_state')
          .update({
            waiting_for: 'targeting_selection',
            current_state: 'send_message_step_2',
            extracted_data: result.currentState?.extracted_data || []
          })
          .eq('user_id', userId);
          console.log('DEBUG: After sendMessageForEvent call, responseContent length:', responseContent?.length, 'shouldSendSMS:', shouldSendSMS);
          console.log('DEBUG: Response content after sendMessageForEvent:', responseContent);
        }
      } catch (error) {
        console.error('Error in SEND_MESSAGE:', error);
        responseContent = 'Failed to send message. Please try again.';
        shouldSendSMS = true;
      }

    } else if (action === 'SYNC_UP') {
      console.log('SYNC_UP action detected, processing...');

      try {
        // Get user's active events
        const { data: userEvents } = await supabase
          .from('events')
          .select(`
            id,
            title,
            event_date,
            start_time,
            location,
            crews (name)
          `)
          .eq('creator_id', userId)
          .eq('status', 'active')
          .gte('event_date', new Date().toISOString().split('T')[0])
          .order('event_date', { ascending: true });

        if (!userEvents || userEvents.length === 0) {
          // No events - start fresh SYNC_UP flow
          responseContent = 'Which event do you want to find time for? Or text "new" to start a new sync up.';
          shouldSendSMS = true;

          await supabase
            .from('conversation_state')
            .update({
              current_state: 'sync_up_no_events',
              waiting_for: null,
              extracted_data: []
            })
            .eq('user_id', userId);
        } else if (userEvents.length === 1) {
          // Only one event - auto-select and go to time options
          const event = userEvents[0];
          const eventDate = new Date(event.event_date).toLocaleDateString();
          const eventTime = event.start_time ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

          await supabase
            .from('conversation_state')
            .update({
              current_state: 'sync_up_step_2',
              waiting_for: 'time_options',
              extracted_data: [{
                action: 'SYNC_UP_EVENT_SELECTED',
                event_id: event.id,
                event_title: event.title,
                event_date: eventDate,
                event_time: eventTime,
                event_location: event.location,
                crew_name: event.crews?.name,
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);

          responseContent = `Selected "${event.title}" on ${eventDate}${eventTime ? ` at ${eventTime}` : ''}. Send up to 3 time options (e.g., 'Fri 12/20 6-8pm; Sat 12/21 10am-12pm').`;
          shouldSendSMS = true;
        } else {
          // Multiple events - show list for selection
          let eventList = 'Which event do you want to find time for?\n\n';
          userEvents.forEach((event, index) => {
            const eventDate = new Date(event.event_date).toLocaleDateString();
            const eventTime = event.start_time ? new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
            eventList += `${index + 1}. ${event.title} - ${eventDate}${eventTime ? ` at ${eventTime}` : ''}\n`;
          });
          eventList += '\nReply with the number of your chosen event.';

          responseContent = eventList;
          shouldSendSMS = true;

          await supabase
            .from('conversation_state')
            .update({
              current_state: 'sync_up_event_selection',
              waiting_for: 'sync_up_event_selection',
              extracted_data: [{
                action: 'SYNC_UP_EVENT_LIST_SHOWN',
                event_list: userEvents.map(e => ({ id: e.id, title: e.title })),
                timestamp: new Date().toISOString()
              }]
            })
            .eq('user_id', userId);
        }
      } catch (error) {
        console.error('Error in SYNC_UP:', error);
        responseContent = 'Failed to start sync up. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'SYNC_UP_EVENT_SELECTED') {
      console.log('SYNC_UP_EVENT_SELECTED action detected, processing event selection...');

      try {
        const eventId = extractedParams.event_id;

        if (!eventId) {
          responseContent = 'Event selection failed. Please try again.';
          shouldSendSMS = true;
        } else {
          // Get complete event details
          const { data: eventData } = await supabase
            .from('events')
            .select(`
              id,
              title,
              event_date,
              start_time,
              location,
              crew_id,
              crews (name)
            `)
            .eq('id', eventId)
            .single();

          if (eventData) {
            const eventDate = new Date(eventData.event_date).toLocaleDateString();
            const eventTime = eventData.start_time ? new Date(`2000-01-01T${eventData.start_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

            await supabase
              .from('conversation_state')
              .update({
                current_state: 'sync_up_step_2',
                waiting_for: 'time_options',
                extracted_data: [{
                  action: 'SYNC_UP_EVENT_SELECTED',
                  event_id: eventData.id,
                  event_title: eventData.title,
                  event_date: eventDate,
                  event_time: eventTime,
                  event_location: eventData.location,
                  crew_id: eventData.crew_id,
                  crew_name: eventData.crews?.name,
                  timestamp: new Date().toISOString()
                }]
              })
              .eq('user_id', userId);

            responseContent = `Selected "${eventData.title}" on ${eventDate}${eventTime ? ` at ${eventTime}` : ''}. What time options should I present to your crew? (e.g., 'Friday 6pm; Saturday 10am; Sunday 2pm')`;
            shouldSendSMS = true;
          } else {
            responseContent = 'Event not found. Please try again.';
            shouldSendSMS = true;
          }
        }
      } catch (error) {
        console.error('Error processing SYNC_UP_EVENT_SELECTED:', error);
        responseContent = 'Failed to process event selection. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'SYNC_UP_OPTIONS_COLLECTED') {
      console.log('SYNC_UP_OPTIONS_COLLECTED action detected, processing time options...');

      try {
        const timeOptions = extractedParams.time_options;

        if (!timeOptions) {
          responseContent = 'Please provide time options in the format: "Friday 6pm; Saturday 10am; Sunday 2pm"';
          shouldSendSMS = true;
        } else {
          // Prefer assistant-parsed timestamps if provided
          const assistantParsed = extractedParams.time_options_parsed;
          let options: Array<{ idx: number; text: string; start_time: string | null; end_time: string | null }>;

          if (Array.isArray(assistantParsed) && assistantParsed.length > 0) {
            options = assistantParsed.slice(0, 3).map((opt: any, index: number) => ({
              idx: opt.idx ?? index + 1,
              text: String(opt.text ?? '').trim(),
              start_time: opt.start_time ?? null,
              end_time: opt.end_time ?? null
            }));
          } else {
            // Fallback: store text only; timestamps null (assistant will handle conversion in confirmation)
            options = timeOptions.split(';').slice(0, 3).map((option: string, index: number) => ({
              idx: index + 1,
              text: option.trim(),
              start_time: null,
              end_time: null
            }));
          }

          if (options.length === 0) {
            responseContent = 'No valid time options found. Please try again.';
            shouldSendSMS = true;
          } else {
            // Get current event data from conversation state
            const { data: currentState } = await supabase
              .from('conversation_state')
              .select('extracted_data')
              .eq('user_id', userId)
              .single();

            const eventData = currentState?.extracted_data?.find(item =>
              item.action === 'SYNC_UP_EVENT_SELECTED'
            );

            if (eventData) {
              // Update conversation state for confirmation (don't create sync_up yet)
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'sync_up_review',
                  waiting_for: 'sync_up_confirmation',
                  extracted_data: [{
                    action: 'SYNC_UP_OPTIONS_COLLECTED',
                    event_id: eventData.event_id,
                    event_title: eventData.event_title,
                    crew_id: eventData.crew_id,
                    crew_name: eventData.crew_name,
                    time_options: options,
                    timestamp: new Date().toISOString()
                  }]
                })
                .eq('user_id', userId);

              const optionsText = options.map(opt => `${opt.idx}. ${opt.text}`).join(', ');
              responseContent = `Sync up: "${eventData.event_title}" with times: ${optionsText}. Send to ${eventData.crew_name}? (yes/no)`;
              shouldSendSMS = true;
            } else {
              responseContent = 'Event data not found. Please start over.';
              shouldSendSMS = true;
            }
          }
        }
      } catch (error) {
        console.error('Error processing SYNC_UP_OPTIONS_COLLECTED:', error);
        responseContent = 'Failed to process time options. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'SYNC_UP_CONFIRMATION_READY') {
      console.log('SYNC_UP_CONFIRMATION_READY action detected, processing confirmation...');

      try {
        const confirm = extractedParams.confirm;

        if (confirm === true || confirm === 'yes') {
          // Get sync up data from conversation state
          const { data: currentState } = await supabase
            .from('conversation_state')
            .select('extracted_data')
            .eq('user_id', userId)
            .single();

          const syncUpData = currentState?.extracted_data?.find(item =>
            item.action === 'SYNC_UP_OPTIONS_COLLECTED'
          );

          console.log('DEBUG: syncUpData from conversation state:', JSON.stringify(syncUpData, null, 2));

          if (syncUpData) {
            // Create sync up record
            const { data: syncUpRecord, error: syncUpError } = await supabase
              .from('sync_ups')
              .insert({
                creator_id: userId,
                event_id: syncUpData.event_id,
                crew_id: syncUpData.crew_id,
                name: syncUpData.event_title,
                location: '', // Can be enhanced later
                notes: '',
                timezone: 'America/Los_Angeles', // Default for now
                status: 'sent'
              })
              .select()
              .single();

            if (syncUpError) {
              console.error('Error creating sync up:', syncUpError);
              responseContent = 'Failed to create sync up. Please try again.';
              shouldSendSMS = true;
            } else {
              // Create sync up options
              const syncUpOptions = syncUpData.time_options.map(option => ({
                sync_up_id: syncUpRecord.id,
                idx: option.idx,
                start_time: option.start_time,
                end_time: option.end_time,
                option_text: option.text
              }));

              const { error: optionsError } = await supabase
                .from('sync_up_options')
                .insert(syncUpOptions);

              if (optionsError) {
                console.error('Error creating sync up options:', optionsError);
              }

              // Get crew members for the event's crew
              const { data: crewMembers } = await supabase
                .from('crew_members')
                .select(`
                  id,
                  contacts (phone_number)
                `)
                .eq('crew_id', syncUpData.crew_id);

              if (crewMembers && crewMembers.length > 0) {
                // Send SMS to crew members
                const optionsText = syncUpData.time_options.map(opt => `${opt.idx}. ${opt.text}`).join(', ');
                const smsMessage = `Time options for "${syncUpData.event_title}": ${optionsText}. Reply with numbers (e.g., '1 2').`;

                let sentCount = 0;
                for (const member of crewMembers) {
                  if (member.contacts?.phone_number) {
                    const smsResult = await sendSMS(member.contacts.phone_number, smsMessage);
                    if (smsResult.success) {
                      sentCount++;
                    }
                  }
                }

                // Clear conversation state
                await supabase
                  .from('conversation_state')
                  .update({
                    current_state: 'normal',
                    waiting_for: null,
                    extracted_data: []
                  })
                  .eq('user_id', userId);

                responseContent = `Sync up sent to ${sentCount} crew members! They'll reply with their preferred times.`;
                shouldSendSMS = true;
              } else {
                responseContent = 'No crew members found for this event. Please add members first.';
                shouldSendSMS = true;
              }
            }
          } else {
            responseContent = 'Sync up data not found. Please start over.';
            shouldSendSMS = true;
          }
        } else {
          // User declined
          await supabase
            .from('conversation_state')
            .update({
              current_state: 'normal',
              waiting_for: null,
              extracted_data: []
            })
            .eq('user_id', userId);

          responseContent = 'Sync up cancelled. You can start a new sync up anytime.';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error processing SYNC_UP_CONFIRMATION_READY:', error);
        responseContent = 'Failed to process confirmation. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'SYNC_UP_CONFIRMATION_YES') {
      console.log('SYNC_UP_CONFIRMATION_YES action detected, processing confirmation...');

      try {
        // Get sync up data from conversation state
        const { data: currentState } = await supabase
          .from('conversation_state')
          .select('extracted_data')
          .eq('user_id', userId)
          .single();

        let syncUpData = currentState?.extracted_data?.find(item =>
          item.action === 'SYNC_UP_OPTIONS_COLLECTED'
        );

        // If assistant provided full extractedParams in confirmation, prefer that
        if (!syncUpData && extractedParams?.time_options && Array.isArray(extractedParams.time_options)) {
          syncUpData = {
            action: 'SYNC_UP_OPTIONS_COLLECTED',
            event_id: extractedParams.event_id,
            event_title: extractedParams.event_title,
            crew_name: extractedParams.crew_name,
            time_options: extractedParams.time_options,
          };
        }

        if (syncUpData) {
          // Create sync up record
          const { data: syncUpRecord, error: syncUpError } = await supabase
            .from('sync_ups')
            .insert({
              creator_id: userId,
              crew_id: null, // We'll link this later or use the event's crew
              name: syncUpData.event_title,
              location: '', // Can be enhanced later
              notes: '',
              timezone: 'America/Los_Angeles', // Default for now
              status: 'sent'
            })
            .select()
            .single();

          if (syncUpError) {
            console.error('Error creating sync up:', syncUpError);
            responseContent = 'Failed to create sync up. Please try again.';
            shouldSendSMS = true;
          } else {
            // Create sync up options (use assistant timestamps if present)
            const syncUpOptions = syncUpData.time_options.map((option: any) => ({
              sync_up_id: syncUpRecord.id,
              idx: option.idx,
              start_time: option.start_time,
              end_time: option.end_time,
              option_text: option.text
            }));

            const { error: optionsError } = await supabase
              .from('sync_up_options')
              .insert(syncUpOptions);

            if (optionsError) {
              console.error('Error creating sync up options:', optionsError);
            }

            // Get the event's crew_id first
            const { data: eventData } = await supabase
              .from('events')
              .select('crew_id')
              .eq('id', syncUpData.event_id)
              .single();

            if (!eventData?.crew_id) {
              responseContent = 'No crew found for this event. Please add crew members first.';
              shouldSendSMS = true;
              return;
            }

            // Get crew members for the event's crew
            const { data: crewMembers } = await supabase
              .from('crew_members')
              .select(`
                id,
                contacts (phone_number)
              `)
              .eq('crew_id', eventData.crew_id);

            if (crewMembers && crewMembers.length > 0) {
              // Send SMS to crew members
              const optionsText = syncUpData.time_options.map(opt => `${opt.idx}. ${opt.text}`).join(', ');
              const smsMessage = `Time options for "${syncUpData.event_title}": ${optionsText}. Reply with numbers (e.g., '1 2').`;

              let sentCount = 0;
              for (const member of crewMembers) {
                if (member.contacts?.phone_number) {
                  const smsResult = await sendSMS(member.contacts.phone_number, smsMessage);
                  if (smsResult.success) {
                    sentCount++;
                  }
                }
              }

              // Clear conversation state
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'normal',
                  waiting_for: null,
                  extracted_data: []
                })
                .eq('user_id', userId);

              responseContent = `Sync up sent to ${sentCount} crew members! They'll reply with their preferred times.`;
              shouldSendSMS = true;
            } else {
              responseContent = 'No crew members found for this event. Please add members first.';
              shouldSendSMS = true;
            }
          }
        } else {
          responseContent = 'Sync up data not found. Please start over.';
          shouldSendSMS = true;
        }
      } catch (error) {
        console.error('Error processing SYNC_UP_CONFIRMATION_YES:', error);
        responseContent = 'Failed to process confirmation. Please try again.';
        shouldSendSMS = true;
      }
      // Handle targeting selection for SEND_MESSAGE
      if (currentState?.waiting_for === 'targeting_selection' && extractedParams.targeting_selection) {
        console.log('SEND_MESSAGE targeting selection detected, processing...');

        try {
          const targetingNumber = parseInt(extractedParams.targeting_selection);
          const eventId = extractedParams.event_id;

          if (eventId && targetingNumber >= 1 && targetingNumber <= 5) {
            // Query invitations directly from the database
            const { data: invitations, error: invitationsError } = await supabase
              .from('invitations')
              .select(`
                id,
                status,
                response_note,
                created_at,
                contact_id,
                contacts (first_name, last_name, phone_number)
              `)
              .eq('event_id', eventId)
              .order('created_at', { ascending: true });

            console.log('DEBUG: Targeting selection - targetingNumber:', targetingNumber);
            console.log('DEBUG: Targeting selection - invitations from DB:', JSON.stringify(invitations, null, 2));
            console.log('DEBUG: Targeting selection - invitations length:', invitations?.length || 0);

            if (invitationsError) {
              console.error('Error fetching invitations:', invitationsError);
              responseContent = 'Sorry, I couldn\'t fetch the invitation data. Please try again.';
              shouldSendSMS = true;
              return;
            }

            const availableInvitations = invitations || [];

            let targetStatuses = [];
            let targetGroup = '';

            switch (targetingNumber) {
              case 1:
                targetStatuses = ['in', 'out', 'maybe', 'no_response'];
                targetGroup = 'everyone';
                break;
              case 2:
                targetStatuses = ['sent', 'failed'];
                targetGroup = 'non_responders';
                break;
              case 3:
                targetStatuses = ['in'];
                targetGroup = 'coming';
                break;
              case 4:
                targetStatuses = ['maybe'];
                targetGroup = 'maybe';
                break;
              case 5:
                targetStatuses = ['out'];
                targetGroup = 'out';
                break;
            }

            // Filter invitations based on targeting selection
            const targetInvitations = Array.isArray(availableInvitations) ? availableInvitations.filter(invitation => {
              if (targetingNumber === 1) {
                // Everyone: all invitations
                return true;
              } else if (targetingNumber === 2) {
                // Non-responders: sent or failed with no_response
                return  invitation.response_note === 'no_response';
              } else if (targetingNumber === 3) {
                // Coming: in
                return invitation.response_note === 'in';
              } else if (targetingNumber === 4) {
                // Maybe: maybe
                return invitation.response_note === 'maybe';
              } else if (targetingNumber === 5) {
                // Out: out
                return invitation.response_note === 'out';
              } 
            }) : [];

            console.log('DEBUG: Targeting selection - targetInvitations:', targetInvitations);

            if (targetInvitations.length === 0) {
              responseContent = `No ${targetGroup} found for this event. Please try a different targeting option.`;
              shouldSendSMS = true;
            } else {
              // Get event title for the message prompt
              const { data: eventData } = await supabase
                .from('events')
                .select('title')
                .eq('id', eventId)
                .single();

              // Show message collection prompt
              const messagePrompt = `Great! What's your message? (160 character limit)`;

              responseContent = messagePrompt;
              shouldSendSMS = true;

              // Update conversation state for message collection
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'send_message_step_3',
                  waiting_for: 'message_collection',
                  extracted_data: [
                    {
                      action: 'SEND_MESSAGE',
                      substep: 3,
                      event_id: eventId,
                      event_title: eventData?.title,
                      target_group: targetGroup,
                      target_statuses: targetStatuses,
                      target_invitations: targetInvitations,
                      invitation_ids: targetInvitations.map(inv => inv.id),
                      targeting_selection: targetingNumber
                    }
                  ]
                })
                .eq('user_id', userId);
            }
          } else {
            responseContent = 'Invalid targeting selection. Please reply with a number from 1-5.';
            shouldSendSMS = true;
          }
        } catch (error) {
          console.error('Error in SEND_MESSAGE targeting selection:', error);
          responseContent = 'Failed to process targeting selection. Please try again.';
          shouldSendSMS = true;
        }
      }

      // Handle message collection for SEND_MESSAGE
      if (currentState?.waiting_for === 'message_collection' ) {
        console.log('SEND_MESSAGE message collection detected, processing...');

        try {
          const messageText = extractedParams.message_text;
          const messageData = currentState.extracted_data?.[0];

          if (messageData && messageText.length <= 160) {
            // Filter for valid invitations (those with contact information)
            const validInvitations = messageData.target_invitations?.filter(inv => 
              inv.contacts && inv.contacts.phone_number
            ) || [];
            const targetCount = validInvitations.length;
            
            // Show confirmation before sending
            responseContent = `Send '${messageText}' to ${messageData.target_group} (${targetCount} people)? Reply 'yes' to confirm.`;
            shouldSendSMS = true;

            // Update conversation state for confirmation
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'send_message_step_4',
                waiting_for: 'message_confirmation',
                extracted_data: [
                  {
                    action: 'SEND_MESSAGE',
                    substep: 4,
                    event_id: messageData.event_id,
                    event_title: messageData.event_title,
                    target_group: messageData.target_group,
                    target_statuses: messageData.target_statuses,
                    target_invitations: messageData.target_invitations,
                    invitation_ids: messageData.invitation_ids,
                    message_text: messageText,
                    target_count: targetCount,
                    valid_invitations: validInvitations
                  }
                ]
              })
              .eq('user_id', userId);

            console.log('SEND_MESSAGE confirmation step set up');
          } else if (messageText.length > 160) {
            responseContent = 'Message is too long. Please keep it under 160 characters.';
            shouldSendSMS = true;
          } else {
            responseContent = 'Sorry, I couldn\'t process your message. Please try again.';
            shouldSendSMS = true;
          }
        } catch (error) {
          console.error('Error in SEND_MESSAGE message collection:', error);
          responseContent = 'Failed to process your message. Please try again.';
          shouldSendSMS = true;
        }
      }

      // Handle message confirmation for SEND_MESSAGE
      if (currentState?.waiting_for === 'message_confirmation') {
        console.log('SEND_MESSAGE message confirmation detected, processing...');

        try {
          const confirmationText = message.toLowerCase().trim();
          const messageData = currentState.extracted_data?.[0];

          // Handle confirmation from assistant response
          if (extractedParams.confirmation === 'yes' && messageData) {
            // Call the existing send-group-message function
            console.log('Calling send-group-message function with:', {
              message: messageData.message_text,
              statuses: messageData.target_statuses,
              event_id: messageData.event_id,
              inviting_user_id: userId
            });

            const sendGroupMessageResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-group-message`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                message: messageData.message_text,
                statuses: messageData.target_statuses,
                event_id: messageData.event_id,
                inviting_user_id: userId
              })
            });

            if (sendGroupMessageResponse.ok) {
              const result = await sendGroupMessageResponse.json();
              console.log('Group message sent successfully:', result);

              // Clear conversation state
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'normal',
                  waiting_for: null,
                  extracted_data: []
                })
                .eq('user_id', userId);

              responseContent = `Message sent to ${result.total_invitations} ${messageData.target_group}! ${result.sent_count} sent successfully, ${result.failed_count} failed.`;
              shouldSendSMS = true;
            } else {
              const errorText = await sendGroupMessageResponse.text();
              console.error('Failed to send group message:', errorText);
              responseContent = 'Failed to send message. Please try again.';
              shouldSendSMS = true;
            }
          } else if (extractedParams.confirmation === 'no') {
            // User declined to send message
            responseContent = 'Message sending cancelled. You can start over by saying "send message" anytime.';
            shouldSendSMS = true;

            // Clear conversation state
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'normal',
                waiting_for: null,
                extracted_data: []
              })
              .eq('user_id', userId);
          } else if (extractedParams.confirmation === 'unclear') {
            // User response was unclear
            responseContent = `Please reply 'yes' to confirm sending '${messageData.message_text}' to ${messageData.target_group} (${messageData.target_count} people), or 'no' to cancel.`;
            shouldSendSMS = true;
          } else {
            // Fallback for direct message text (not from assistant)
            const confirmationText = message.toLowerCase().trim();
            if (confirmationText === 'yes') {
              // User confirmed directly, proceed with sending
              // This will be handled by the same logic above
            } else if (confirmationText === 'no') {
              // User declined directly
              responseContent = 'Message sending cancelled. You can start over by saying "send message" anytime.';
              shouldSendSMS = true;

              // Clear conversation state
              await supabase
                .from('conversation_state')
                .update({
                  current_state: 'normal',
                  waiting_for: null,
                  extracted_data: []
                })
                .eq('user_id', userId);
            } else {
              // User didn't confirm clearly, ask for confirmation again
              responseContent = `Please confirm by replying 'yes' to send '${messageData.message_text}' to ${messageData.target_group} (${messageData.target_count} people).`;
              shouldSendSMS = true;
            }
          }
        } catch (error) {
          console.error('Error in SEND_MESSAGE message confirmation:', error);
          responseContent = 'Failed to process confirmation. Please try again.';
          shouldSendSMS = true;
        }
      }
    } else if (action === 'RECEIVE_MESSAGE_EVENT_SELECTED') {
      console.log('RECEIVE_MESSAGE_EVENT_SELECTED action detected, processing event selection...');

      try {
        // Get the selected event details
        const eventId = extractedParams.event_id;
        const eventTitle = extractedParams.event_title;

        if (!eventId) {
          responseContent = 'Event selection failed. Please try again.';
          shouldSendSMS = true;
        } else {
          // Get the pending message from extracted_data
          const { data: currentState } = await supabase
            .from('conversation_state')
            .select('extracted_data')
            .eq('user_id', userId)
            .single();

          const pendingMessage = currentState?.extracted_data?.[0]?.pending_message || message;

          // Update conversation state with selected event
          await supabase
            .from('conversation_state')
            .update({
              current_event_id: eventId,
              current_state: 'normal',
              waiting_for: null,
              extracted_data: []
            })
            .eq('user_id', userId);

          // Process the pending message with event context
          responseContent = `Message received: "${pendingMessage}". This will be forwarded to the event organizer for "${eventTitle}".`;
          
          // Send SMS response to crew member
          if (phone_number) {
            const smsResult = await sendSMS(phone_number, responseContent);
            console.log('RECEIVE_MESSAGE_EVENT_SELECTED SMS sent to crew member:', smsResult);
          }

          // Log message reception for analytics
          if (phone_number) {
            await supabase.from('message_reception_log').insert({
              user_id: userId,
              phone_number: phone_number,
              original_message: pendingMessage,
              received_message: pendingMessage,
              is_host: is_host,
              event_id: eventId,
              timestamp: new Date().toISOString()
            });
          }

          // Send notification to host about received message
          console.log(`Message from crew member ${phone_number} for event ${eventId} (${eventTitle}): "${pendingMessage}" - sending notification to host`);
          
          // Get host information for this event
          const { data: hostData, error: hostError } = await supabase
            .from('events')
            .select(`
              id,
              title,
              creator_id,
              profiles!inner(
                phone_number
              )
            `)
            .eq('id', eventId)
            .single();
            
          if (hostData && hostData.profiles && hostData.profiles.phone_number) {
            const hostPhoneNumber = hostData.profiles.phone_number;
            const hostNotificationMessage = `📨 New message for "${eventTitle}":\n\n"${pendingMessage}"\n\nFrom: ${phone_number}`;
            
            const hostSmsResult = await sendSMS(hostPhoneNumber, hostNotificationMessage);
            console.log('Host notification SMS sent:', hostSmsResult);
          } else {
            console.log('Could not find host phone number for event:', eventId);
          }

          shouldSendSMS = false; // Already sent SMS above
        }
      } catch (error) {
        console.error('Error processing RECEIVE_MESSAGE_EVENT_SELECTED:', error);
        responseContent = 'Failed to process event selection. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'RECEIVE_MESSAGE') {
      console.log('RECEIVE_MESSAGE action detected, checking if user is crew member...');

      try {
        // RECEIVE_MESSAGE is only for crew members (is_host = false)
        if (is_host) {
          console.log('Host tried to use RECEIVE_MESSAGE, blocking and suggesting alternatives');
          responseContent = 'This action is only available for crew members. As a host, you can use other commands like "create crew", "send invitations", or "check RSVPs".';
          shouldSendSMS = true;
        } else {
          console.log('Crew member using RECEIVE_MESSAGE, processing...');
          // For crew members, process the received message
          let receivedMessage = '';

          // Check if there's a structured response with received message
          if (extractedParams.received_message) {
            receivedMessage = extractedParams.received_message;
          } else {
            // Fallback to assistant response if no structured message
            receivedMessage = assistantResponse;
          }

          console.log('Received message for crew member:', receivedMessage);

          // Send confirmation message to crew member
          responseContent = `Message received: "${receivedMessage}". This will be forwarded to the event organizer.`;
          shouldSendSMS = true;

          // Send SMS response to crew member
          if (phone_number) {
            const smsResult = await sendSMS(phone_number, responseContent);
            console.log('RECEIVE_MESSAGE SMS sent to crew member:', smsResult);
          }

          // Log message reception for analytics
          if (phone_number) {
            await supabase.from('message_reception_log').insert({
              user_id: userId,
              phone_number: phone_number,
              original_message: message,
              received_message: receivedMessage,
              is_host: is_host,
              timestamp: new Date().toISOString()
            });
          }

          // TODO: Send notification to host about received message
          // This would require finding the host's phone number and sending them a notification
          // For now, we'll just log that a message was received
          console.log(`Message from crew member ${phone_number}: "${receivedMessage}" - needs to be forwarded to host`);
        }


      } catch (error) {
        console.error('Error processing RECEIVE_MESSAGE action:', error);
        responseContent = 'Failed to process received message. Please try again.';
        shouldSendSMS = true;
      }
    } else if (action === 'HELP') {
      console.log('HELP action detected, processing...');
      
      try {
        // Extract help message from assistant response
        let helpMessage = '';
        
        // Check if it's a structured response with help_message
        if (extractedParams.help_message) {
          helpMessage = extractedParams.help_message;
        } else {
          // Fallback to assistant response if no structured help message
          helpMessage = assistantResponse;
        }
        
        console.log('Help message:', helpMessage);
        
        // Send the help message directly
        responseContent = helpMessage;
        shouldSendSMS = true;
        
        // Log help usage for analytics
        if (phone_number) {
          await supabase.from('help_usage_log').insert({
            user_id: userId,
            phone_number: phone_number,
            help_question: message,
            help_category: 'general',
            help_intent: 'help_request',
            response_provided: helpMessage,
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error('Error processing HELP action:', error);
        responseContent = 'I\'m here to help! Text "create crew" to start, "RSVPs" to check responses, or "help" for more options.';
        shouldSendSMS = true;
      }
    } else {
      responseContent = `Action: ${action} | Assistant Response: ${assistantResponse}`;
    }

    // Track AI usage after action extraction is complete (non-blocking)
    const inputText = messageWithContext;
    const outputText = assistantResponse;
    
    // Fire and forget - don't wait for the response
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/calculate-token-usage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: userId,
        phone_number: phone_number,
        assistant_id: assistantId,
        thread_id: threadId,
        model: model,
        input_text: inputText,
        output_text: outputText,
        action: action,
        metadata: {
          confidence: confidence,
          extracted_params: extractedParams,
          is_structured_response: Object.keys(extractedParams).length > 0
        }
      })
    }).then(response => {
      if (response.ok) {
        return response.json();
      } else {
        console.error('Failed to track AI usage:', response.status);
      }
    }).then(data => {
      if (data) {
        console.log('AI usage tracked:', data);
      }
    }).catch(error => {
      console.error('Error tracking AI usage:', error);
    });

    // Send SMS for all responses that should be sent
    console.log('Final SMS check: shouldSendSMS =', shouldSendSMS, 'phone_number =', phone_number, 'responseContent =', responseContent?.substring(0, 100) + '...');
    if (shouldSendSMS && phone_number && responseContent) {
      const smsResult = await sendSMS(phone_number, responseContent);
      console.log('SMS sent successfully:', smsResult);
    } else {
      console.log('SMS not sent - shouldSendSMS:', shouldSendSMS, 'phone_number:', phone_number, 'responseContent exists:', !!responseContent);
    }

    // Log final timing
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [${totalTime}ms] Request completed successfully`);
    console.log(`⏱️  Total execution time: ${totalTime}ms`);

    // Return the classification result
    return new Response(JSON.stringify({
      action: action,
      content: responseContent,
      confidence: confidence,
      extracted_params: extractedParams,
      model_used: model,
      assistant_id: assistantId,
      thread_id: threadId,
      assistant_response: assistantResponse,
      is_structured_response: Object.keys(extractedParams).length > 0,
      crew_name: extractedParams.crew_name || null,
      location: extractedParams.location || null,
      timezone: extractedParams.timezone || null
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error(`❌ [${Date.now() - startTime}ms] SMS Handler Error:`, error);
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
