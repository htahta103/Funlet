/**
 * Main logging function that writes to the behavioral_logs table
 */ export async function logWorkflowAction(params) {
  const { supabase, userId, workflowName, workflowStep, eventType, inputData, outputData, crewId, contactId, invitee_contact_id, eventId, syncUpId, executionStatus, errorDetails, metadata = {}, durationMs } = params;
  console.log(`[Logger] 🚀 Initiating log action: ${workflowName}:${workflowStep} (${eventType})`);
  try {
    // Construct the metadata object with all workflow details
    const enrichedMetadata = {
      ...metadata
    };
    // Ensure core relational identifiers are also present inside metadata for easy JSONB querying
    // For invitee events (userId is null), use invitee_contact_id to distinguish from organizer contact editing
    // For organizer events (userId is not null), use contact_id
    // Prioritize explicit invitee_contact_id parameter, fall back to contactId inference for backward compatibility
    const finalInviteeContactId = invitee_contact_id || (userId === null || userId === undefined ? contactId : undefined);
    if (typeof finalInviteeContactId === 'string') {
      enrichedMetadata.invitee_contact_id = finalInviteeContactId;
    }
    if (typeof contactId === 'string' && userId !== null && userId !== undefined) {
      // Organizer event - use contact_id
      enrichedMetadata.contact_id = contactId;
    }
    if (typeof eventId === 'string') {
      enrichedMetadata.event_id = eventId;
    }
    if (typeof syncUpId === 'string') {
      enrichedMetadata.sync_up_id = syncUpId;
    }
    const logMetadata = {
      workflow_name: workflowName,
      step_name: workflowStep,
      execution_status: executionStatus,
      input_data: inputData,
      output_data: outputData,
      error_details: errorDetails,
      duration_ms: durationMs,
      ...enrichedMetadata
    };
    // Insert into behavioral_logs table
    const insertData = {
      organizer_id: userId,
      event_type: eventType,
      crew_id: crewId,
      event_id: eventId,
      sync_up_id: syncUpId,
      platform: 'sms',
      workflow_name: workflowName,
      workflow_step: workflowStep,
      metadata: logMetadata,
      timestamp: new Date().toISOString()
    };
    // Add version if available
    insertData.version = 1;
    // Set contact_id or invitee_contact_id based on event type
    // Prioritize explicit invitee_contact_id parameter, fall back to contactId inference for backward compatibility
    if (typeof finalInviteeContactId === 'string') {
      // Invitee event - use invitee_contact_id column
      insertData.invitee_contact_id = finalInviteeContactId;
    }
    if (typeof contactId === 'string' && userId !== null && userId !== undefined) {
      // Organizer event - use contact_id column
      insertData.contact_id = contactId;
    }
    const logPromise = supabase.from('behavioral_logs').insert(insertData).then(({ error })=>{
      if (error) {
        console.error('❌ Failed to log workflow action:', error);
      } else {
        console.log(`📝 Logged ${workflowName}:${workflowStep} (${eventType})`);
      }
    }).catch((err)=>{
      console.error('❌ Unexpected error in logWorkflowAction:', err);
    });
    // Use EdgeRuntime.waitUntil to ensure the log completes even if the function returns
    // This allows us to "fire and forget" without awaiting
    if (typeof EdgeRuntime !== 'undefined' && 'waitUntil' in EdgeRuntime) {
      console.log('[Logger] 🕒 Using EdgeRuntime.waitUntil for background execution');
      // @ts-ignore - EdgeRuntime is a global in Supabase Edge Functions
      EdgeRuntime.waitUntil(logPromise);
    } else {
      console.log('[Logger] ⚠️ EdgeRuntime not found, promise floating (local/dev env)');
    // Fallback for local testing or environments without EdgeRuntime
    // We don't await here to respect the "no waiting" requirement, 
    // but in some runtimes this might be cancelled.
    // For critical logs in non-Edge environments, one might want to await.
    }
    return logPromise;
  } catch (err) {
    console.error('❌ Unexpected error in logWorkflowAction setup:', err);
    return Promise.resolve();
  }
}
/**
 * Log the start of a workflow
 */ export async function logWorkflowStart(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'flow_started',
    executionStatus: 'pending',
    workflowStep: params.workflowStep || 'INITIATED'
  });
}
/**
 * Log a step within a workflow
 */ export async function logWorkflowProgress(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'flow_step'
  });
}
/**
 * Log the successful completion of a workflow
 */ export async function logWorkflowComplete(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'flow_completed',
    executionStatus: 'success'
  });
}
/**
 * Log a workflow error
 */ export async function logWorkflowError(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'drop_off',
    executionStatus: 'failure'
  });
}
/**
 * Simplified error logging helper that automatically extracts error details
 * and logs with eventType 'error'
 */ export async function logError(params) {
  const errorObj = params.error instanceof Error ? params.error : new Error(String(params.error));
  return logWorkflowAction({
    supabase: params.supabase,
    userId: params.userId,
    workflowName: params.workflowName,
    workflowStep: params.workflowStep,
    eventType: 'error',
    executionStatus: 'failure',
    errorDetails: {
      error_type: errorObj.name || 'UnknownError',
      error_message: errorObj.message || String(params.error),
      error_stack: errorObj.stack
    },
    metadata: params.metadata,
    crewId: params.crewId,
    contactId: params.contactId,
    invitee_contact_id: params.invitee_contact_id,
    eventId: params.eventId,
    syncUpId: params.syncUpId
  });
}
/**
 * Log a workflow cancellation/abandonment
 */ export async function logWorkflowCancel(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'drop_off',
    executionStatus: 'failure' // or 'success' depending on if cancellation was successful? usually 'failure' of the goal
  });
}
/**
 * Log when a crew is created
 */ export async function logCrewCreated(params) {
  return logWorkflowAction({
    ...params,
    eventType: 'crew_created',
    executionStatus: 'success'
  });
}
export async function logInviteeEvent(params) {
  return logWorkflowAction({
    ...params,
    userId: null
  });
}
