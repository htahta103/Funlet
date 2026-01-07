// Edge Function to process Auto Sync scheduled jobs
// Runs via pg_cron every minute to handle reminders and pause checks

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendSMS } from '../funlet-sms-handler-beta/sms.ts';
import { 
  formatInviteeAvailabilityMessage,
  formatPausedStateSummary,
  calculateResponseStats,
  checkAllOptionsPassed,
  type AutoSyncRecord,
  type AutoSyncOption
} from '../funlet-sms-handler-beta/auto_sync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No JWT verification - allow unauthenticated access for cron jobs
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log('Processing Auto Sync jobs...');

    // Fetch pending jobs that are due
    const { data: jobs, error: jobsError } = await supabase
      .from('job_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(10); // Process max 10 jobs per run

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch jobs', details: jobsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!jobs || jobs.length === 0) {
      console.log('No pending jobs to process');
      return new Response(
        JSON.stringify({ message: 'No jobs to process', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${jobs.length} jobs to process`);

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const job of jobs) {
      try {
        // Atomically mark job as processing to prevent duplicate processing
        const { data: updated, error: updateError } = await supabase
          .from('job_queue')
          .update({ status: 'processing' })
          .eq('id', job.id)
          .eq('status', 'pending') // Only update if still pending
          .select()
          .single();

        if (updateError || !updated) {
          // Job was already processed by another instance, skip
          console.log(`Job ${job.id} already processed, skipping`);
          skippedCount++;
          continue;
        }

        // Get current auto_sync status
        const { data: sync, error: syncError } = await supabase
          .from('auto_syncs')
          .select('*')
          .eq('id', job.sync_id)
          .single();

        if (syncError || !sync) {
          console.log(`Auto sync ${job.sync_id} not found, marking job as skipped`);
          await supabase
            .from('job_queue')
            .update({ 
              status: 'skipped', 
              processed_at: new Date().toISOString(),
              error_message: 'Auto sync not found'
            })
            .eq('id', job.id);
          skippedCount++;
          continue;
        }

        // Process based on job type
        if (job.job_type === 'reminder_24h') {
          // Only send reminders while sync is running
          if (sync.status !== 'running') {
            console.log(`Auto sync ${job.sync_id} status is ${sync.status} for reminder_24h, skipping job`);
            await supabase
              .from('job_queue')
              .update({
                status: 'skipped',
                processed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            skippedCount++;
            continue;
          }

          // Check if reminder was already sent (prevent duplicate reminders)
          const { data: existingReminder } = await supabase
            .from('job_queue')
            .select('id')
            .eq('sync_id', sync.id)
            .eq('job_type', 'reminder_24h')
            .eq('status', 'processed')
            .maybeSingle();

          if (existingReminder) {
            console.log(`Reminder already sent for sync ${sync.id}, skipping`);
            await supabase
              .from('job_queue')
              .update({ 
                status: 'skipped', 
                processed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            skippedCount++;
            continue;
          }

          // Send reminder to non-responders
          await sendReminder(supabase, sync as AutoSyncRecord);

          // Calculate response stats for organizer update
          const stats = await calculateResponseStats(supabase, sync.id);

          // Get organizer phone number
          const { data: organizer } = await supabase
            .from('profiles')
            .select('phone_number')
            .eq('id', sync.organizer_id)
            .single();

          if (organizer?.phone_number) {
            try {
              const total = stats.total;
              const responded = stats.responded;
              const pending = total - responded;
              const message = `Reminder sent for ${sync.event_name} to ${pending} of ${total} people. Reply auto sync check to manage.`;

              console.log(`Sending 24h organizer update for sync ${sync.id} to ${organizer.phone_number}`);
              console.log(`Stats: ${responded}/${total} responded, ${pending} pending`);
              
              const smsResult = await sendSMS(organizer.phone_number, message, true, undefined);
              
              if (!smsResult) {
                console.error(`Failed to send organizer 24h update for sync ${sync.id}: No result returned`);
              } else if (!smsResult.success) {
                console.error(`Failed to send organizer 24h update for sync ${sync.id}:`, smsResult.error || 'Unknown error');
              } else if (smsResult.skipped && smsResult.reason === 'host') {
                // If skipped because organizer is a host, save to message_thread for webchat
                console.log(`Organizer 24h update skipped (host), saving to message_thread for sync ${sync.id}`);
                try {
                  await supabase
                    .from('message_thread')
                    .insert({
                      user_id: sync.organizer_id,
                      phone_number: organizer.phone_number,
                      message: message,
                      role: 'assistant',
                      sent: false,
                      sent_at: null
                    });
                  console.log(`Organizer 24h update saved to message_thread for sync ${sync.id}`);
                } catch (threadError) {
                  console.error(`Error saving organizer update to message_thread:`, threadError);
                }
              } else if (smsResult.skipped) {
                console.log(`Organizer 24h update skipped for sync ${sync.id}:`, smsResult.reason || 'Unknown reason');
              } else {
                console.log(`Sent 24h organizer update for sync ${sync.id} to ${organizer.phone_number}`);
              }
            } catch (organizerError) {
              console.error(`Error sending organizer 24h update for sync ${sync.id}:`, organizerError);
            }
          } else {
            console.log(`No organizer phone number found for sync ${sync.id}, skipping 24h update SMS`);
          }

          // Schedule pause check job (DEMO: 10 minutes, PRODUCTION: 48 hours)
          await schedulePauseCheck(supabase, sync.id);

          // Mark job as processed
          await supabase
            .from('job_queue')
            .update({ 
              status: 'processed', 
              processed_at: new Date().toISOString()
            })
            .eq('id', job.id);

          processedCount++;
          console.log(`Reminder sent for sync ${sync.id}`);

        } else if (job.job_type === 'pause_check_48h') {
          // Only pause running syncs; if already paused/completed/stopped, skip
          if (sync.status !== 'running') {
            console.log(`Auto sync ${job.sync_id} status is ${sync.status} for pause_check_48h, skipping job`);
            await supabase
              .from('job_queue')
              .update({
                status: 'skipped',
                processed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            skippedCount++;
            continue;
          }

          // Calculate response stats for paused state summary
          const stats = await calculateResponseStats(supabase, sync.id);
          
          // Get organizer phone number
          const { data: organizer } = await supabase
            .from('profiles')
            .select('phone_number')
            .eq('id', sync.organizer_id)
            .single();
          
          if (organizer?.phone_number) {
            // Format paused state summary message
            const pausedMessage = formatPausedStateSummary(sync.event_name, stats);
            
            // Send SMS to organizer
            const smsResult = await sendSMS(organizer.phone_number, pausedMessage, true, undefined);
            
            // If skipped because organizer is a host, save to message_thread
            if (smsResult?.skipped && smsResult.reason === 'host') {
              console.log(`Paused summary skipped (host), saving to message_thread for sync ${sync.id}`);
              try {
                await supabase
                  .from('message_thread')
                  .insert({
                    user_id: sync.organizer_id,
                    phone_number: organizer.phone_number,
                    message: pausedMessage,
                    role: 'assistant',
                    sent: false,
                    sent_at: null
                  });
                console.log(`Paused summary saved to message_thread for sync ${sync.id}`);
              } catch (threadError) {
                console.error(`Error saving paused summary to message_thread:`, threadError);
              }
            }
            
            // Update conversation state to show paused menu
            await supabase
              .from('conversation_state')
              .update({
                current_state: 'auto_sync_configuration',
                waiting_for: 'auto_sync_paused_menu',
                extracted_data: [{
                  action: 'AUTO_SYNC_MANAGEMENT',
                  auto_sync_id: sync.id
                }]
              })
              .eq('user_id', sync.organizer_id);
            
            if (smsResult?.skipped) {
              console.log(`Paused state summary skipped for sync ${sync.id}:`, smsResult.reason || 'Unknown reason');
            } else {
              console.log(`Sent paused state summary to organizer for sync ${sync.id}`);
            }
          }
          
          // Pause the auto sync
          await supabase
            .from('auto_syncs')
            .update({ 
              status: 'paused', 
              paused_at: new Date().toISOString()
            })
            .eq('id', job.sync_id);

          // Mark job as processed
          await supabase
            .from('job_queue')
            .update({ 
              status: 'processed', 
              processed_at: new Date().toISOString()
            })
            .eq('id', job.id);

          processedCount++;
          console.log(`Auto sync ${job.sync_id} paused`);
        } else if (job.job_type === 'auto_end_check') {
          // Allow auto_end_check for both running and paused syncs
          if (sync.status !== 'running' && sync.status !== 'paused') {
            console.log(`Auto sync ${job.sync_id} status is ${sync.status} for auto_end_check, skipping job`);
            await supabase
              .from('job_queue')
              .update({
                status: 'skipped',
                processed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            skippedCount++;
            continue;
          }

          // Check if all options have passed based on end_time
          const allPassed = await checkAllOptionsPassed(supabase, sync.id);

          if (allPassed) {
            console.log(`All options passed for sync ${sync.id}, auto-ending`);

            await supabase
              .from('auto_syncs')
              .update({
                status: 'stopped',
                stopped_at: new Date().toISOString()
              })
              .eq('id', sync.id);

            await supabase
              .from('job_queue')
              .update({
                status: 'processed',
                processed_at: new Date().toISOString()
              })
              .eq('id', job.id);

            processedCount++;
            continue;
          }

          // Not all options have passed yet - reschedule next auto_end_check
          const { data: options } = await supabase
            .from('auto_sync_options')
            .select('end_time, start_time')
            .eq('auto_sync_id', sync.id);

          if (!options || options.length === 0) {
            console.log(`No options found for sync ${sync.id} in auto_end_check, marking job as skipped`);
            await supabase
              .from('job_queue')
              .update({
                status: 'skipped',
                processed_at: new Date().toISOString(),
                error_message: 'No options found for auto_end_check'
              })
              .eq('id', job.id);
            skippedCount++;
          } else {
            const now = new Date();
            // Find the earliest future end time
            let earliestFuture: Date | null = null;
            for (const opt of options as any[]) {
              const raw = opt.end_time || opt.start_time;
              if (!raw) continue;
              const dt = new Date(raw);
              if (dt > now && (!earliestFuture || dt < earliestFuture)) {
                earliestFuture = dt;
              }
            }

            if (!earliestFuture) {
              // All options are in the past but checkAllOptionsPassed returned false (race condition) - mark as processed
              console.log(`No future option times found for sync ${sync.id} in auto_end_check; marking job processed without changes`);
              await supabase
                .from('job_queue')
                .update({
                  status: 'processed',
                  processed_at: new Date().toISOString(),
                  error_message: 'auto_end_check: no future option times; leaving status unchanged'
                })
                .eq('id', job.id);
              processedCount++;
            } else {
              // Schedule next auto_end_check job at earliest future end time
              try {
                await supabase
                  .from('job_queue')
                  .insert({
                    sync_id: sync.id,
                    job_type: 'auto_end_check',
                    scheduled_at: earliestFuture.toISOString()
                  })
                  .select();
                console.log(`Scheduled next auto_end_check for sync ${sync.id} at ${earliestFuture.toISOString()}`);
              } catch (scheduleError) {
                console.error(`Error scheduling next auto_end_check for sync ${sync.id}:`, scheduleError);
              }

              await supabase
                .from('job_queue')
                .update({
                  status: 'processed',
                  processed_at: new Date().toISOString()
                })
                .eq('id', job.id);

              processedCount++;
            }
          }
        }

      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        errorCount++;

        // Mark job with error
        await supabase
          .from('job_queue')
          .update({ 
            status: 'processed', // Still mark as processed to avoid retry loops
            processed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : String(error)
          })
          .eq('id', job.id);
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Jobs processed',
        processed: processedCount,
        skipped: skippedCount,
        errors: errorCount
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unhandled error in process-auto-sync-jobs:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Send reminder SMS to non-responders
 */
async function sendReminder(
  supabase: any,
  sync: AutoSyncRecord
): Promise<void> {
  // Get crew members (contacts)
  const { data: crewMembers } = await supabase
    .from('crew_members')
    .select('contact_id, contacts(id, phone_number, first_name, last_name)')
    .eq('crew_id', sync.crew_id);

  if (!crewMembers || crewMembers.length === 0) {
    console.log(`No crew members found for sync ${sync.id}`);
    return;
  }

  // Get responses to find non-responders
  const { data: responses } = await supabase
    .from('auto_sync_responses')
    .select('contact_id')
    .eq('auto_sync_id', sync.id);

  const respondedContactIds = new Set(responses?.map(r => r.contact_id) || []);

  // Get options for message formatting
  const { data: options } = await supabase
    .from('auto_sync_options')
    .select('*')
    .eq('auto_sync_id', sync.id)
    .order('idx');

  if (!options || options.length === 0) {
    console.log(`No options found for sync ${sync.id}, cannot send reminders`);
    return;
  }

  // Get organizer name
  const { data: organizer } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', sync.organizer_id)
    .single();

  const organizerName = organizer?.first_name || 'Someone';

  console.log(`Processing reminders for sync ${sync.id}: ${crewMembers.length} crew members, ${respondedContactIds.size} responded, ${options.length} options`);

  // Send reminders to non-responders
  let reminderCount = 0;
  let skippedCount = 0;
  for (const member of crewMembers) {
    if (!member.contact_id) {
      console.log(`Skipping member without contact_id`);
      skippedCount++;
      continue;
    }

    if (respondedContactIds.has(member.contact_id)) {
      console.log(`Skipping member ${member.contact_id} - already responded`);
      skippedCount++;
      continue;
    }

    if (!member.contacts) {
      console.log(`Skipping member ${member.contact_id} - no contact data`);
      skippedCount++;
      continue;
    }

    const contact = member.contacts;
    const phone = contact.phone_number;

    if (!phone) {
      console.log(`Skipping member ${member.contact_id} - no phone number`);
      skippedCount++;
      continue;
    }

    try {
      const message = formatInviteeAvailabilityMessage(
        organizerName,
        sync.event_name,
        options as AutoSyncOption[],
        sync.timezone
      );

      console.log(`Sending reminder to ${phone} for sync ${sync.id}`);
      const smsResult = await sendSMS(phone, message, true, undefined);

      if (!smsResult) {
        console.error(`Failed to send reminder to ${phone}: No result returned`);
        continue;
      }

      if (!smsResult.success) {
        console.error(`Failed to send reminder to ${phone}:`, smsResult.error || 'Unknown error');
        continue;
      }

      if (smsResult.skipped) {
        console.log(`Reminder skipped for ${phone}:`, smsResult.reason || 'Unknown reason');
        // Still count as sent if skipped (e.g., if recipient is host, message is saved to message_thread)
        // The message is still delivered via webchat
      }

      // Create message record
      const { error: insertError } = await supabase
        .from('auto_sync_messages')
        .insert({
          auto_sync_id: sync.id,
          contact_id: member.contact_id,
          message_type: 'reminder',
          is_resolved: false
        });

      if (insertError) {
        console.error(`Error creating message record for ${member.contact_id}:`, insertError);
      }

      reminderCount++;
      console.log(`Reminder sent successfully to ${phone}`);
    } catch (error) {
      console.error(`Error sending reminder to ${phone}:`, error);
    }
  }

  // Only update last_reminder_sent_at if reminders were actually sent
  if (reminderCount > 0) {
    await supabase
      .from('auto_syncs')
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq('id', sync.id);
  }

  console.log(`Reminder processing complete for sync ${sync.id}: ${reminderCount} sent, ${skippedCount} skipped`);
}

/**
 * Schedule pause check job (DEMO: 10 minutes, PRODUCTION: 48 hours)
 */
async function schedulePauseCheck(supabase: any, syncId: string): Promise<void> {
  // Check if pause_check_48h job already exists (prevent duplicates)
  const { data: existing } = await supabase
    .from('job_queue')
    .select('id')
    .eq('sync_id', syncId)
    .eq('job_type', 'pause_check_48h')
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    console.log(`Pause check job already scheduled for sync ${syncId}, skipping`);
    return;
  }

  // DEMO: 10 minutes | PRODUCTION: 48 hours
  const scheduledAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Insert new job (will fail if duplicate due to unique index)
  const { error } = await supabase
    .from('job_queue')
    .insert({
      sync_id: syncId,
      job_type: 'pause_check_48h',
      scheduled_at: scheduledAt.toISOString()
    })
    .select();

  if (error) {
    // Ignore unique constraint violations (23505)
    if (error.code !== '23505') {
      console.error(`Error scheduling pause check for sync ${syncId}:`, error);
      throw error;
    }
    console.log(`Pause check job already exists for sync ${syncId} (unique constraint)`);
  } else {
    console.log(`Scheduled pause check for sync ${syncId} at ${scheduledAt.toISOString()}`);
  }
}

