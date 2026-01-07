import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Define the structure for log parameters
export interface LogParams {
    supabase: SupabaseClient;
    userId: string;
    workflowName: string;
    workflowStep: string;
    inputData?: Record<string, any>;
    outputData?: Record<string, any>;
    crewId?: string;
    executionStatus: 'success' | 'failure' | 'pending';
    errorDetails?: Record<string, any>;
    metadata?: Record<string, any>;
    durationMs?: number;
}

// Define specific event types that map to the database enum
// These should match the 'behavioral_event_type' enum in the database
export type BehavioralEventType =
    // 2.1 Organizer Events
    /** User opens chat or app session. */
    | 'session_start'
    /** User leaves chat or session expires. */
    | 'session_end'
    /** Any major flow begins (crew creation, event creation, sync-up, etc.). */
    | 'flow_started'
    /** Each step within a flow (adding contacts, naming crew, selecting options). */
    | 'flow_step'
    /** Flow completes successfully. */
    | 'flow_completed'
    /** Generic action that is not part of a defined flow. */
    | 'user_action'
    /** iOS native picker launched. */
    | 'contact_picker_opened'
    /** Count of contacts selected. */
    | 'contact_picker_submitted'
    /** Crew created. */
    | 'crew_created'
    /** Members added/removed. */
    | 'crew_updated'
    /** Event created. */
    | 'event_created'
    /** Sync-up created. */
    | 'syncup_created'
    /** Organizer manually finalizes an event or sync-up. */
    | 'finalize_triggered'
    /** Organizer manually triggers reminders. */
    | 'reminder_sent'
    /** Flow started but not completed (timeout or exit). */
    | 'drop_off'
    /** Device receives a push notification. */
    | 'push_received'
    /** Organizer taps push and returns to chat. */
    | 'push_opened'

    // 2.2 Invitee Events
    /** SMS invite sent to an invitee. */
    | 'invite_sent'
    /** Invitee replies YES. */
    | 'invitee_reply_yes'
    /** Invitee replies NO. */
    | 'invitee_reply_no'
    /** Message not recognized. */
    | 'invitee_reply_unknown'
    /** Vote on sync-up option ("1", "2", "3"). */
    | 'invitee_vote'
    /** No reply after X hours/days (system-defined). */
    | 'invitee_timeout'
    /** Invitee confirms after organizer follow-up. */
    | 'invitee_confirmed'

    // 2.3 System Events
    /** Outbound SMS delivered via Twilio. */
    | 'sms_sent'
    /** Inbound SMS from invitee handled. */
    | 'sms_received'
    /** Any backend or flow error. */
    | 'error'
    /** Round-trip processing time measurement. */
    | 'latency';

/**
 * Main logging function that writes to the behavioral_logs table
 */
export async function logWorkflowAction(params: LogParams & { eventType: BehavioralEventType }) {
    const {
        supabase,
        userId,
        workflowName,
        workflowStep,
        eventType,
        inputData,
        outputData,
        crewId,
        executionStatus,
        errorDetails,
        metadata = {},
        durationMs
    } = params;

    console.log(`[Logger] 🚀 Initiating log action: ${workflowName}:${workflowStep} (${eventType})`);

    try {
        // Construct the metadata object with all workflow details
        const logMetadata = {
            workflow_name: workflowName,
            step_name: workflowStep,
            execution_status: executionStatus,
            input_data: inputData,
            output_data: outputData,
            error_details: errorDetails,
            duration_ms: durationMs,
            ...metadata
        };

        // Insert into behavioral_logs table
        const logPromise = supabase
            .from('behavioral_logs')
            .insert({
                organizer_id: userId,
                event_type: eventType,
                crew_id: crewId,
                platform: 'sms',
                metadata: logMetadata,
                timestamp: new Date().toISOString()
            })
            .then(({ error }) => {
                if (error) {
                    console.error('❌ Failed to log workflow action:', error);
                } else {
                    console.log(`📝 Logged ${workflowName}:${workflowStep} (${eventType})`);
                }
            })
            .catch(err => {
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
 */
export async function logWorkflowStart(params: Omit<LogParams, 'executionStatus' | 'durationMs'>) {
    return logWorkflowAction({
        ...params,
        eventType: 'flow_started',
        executionStatus: 'pending',
        workflowStep: params.workflowStep || 'INITIATED'
    });
}

/**
 * Log a step within a workflow
 */
export async function logWorkflowProgress(params: LogParams) {
    return logWorkflowAction({
        ...params,
        eventType: 'flow_step'
    });
}

/**
 * Log the successful completion of a workflow
 */
export async function logWorkflowComplete(params: LogParams) {
    return logWorkflowAction({
        ...params,
        eventType: 'flow_completed',
        executionStatus: 'success'
    });
}

/**
 * Log a workflow error
 */
export async function logWorkflowError(params: Omit<LogParams, 'executionStatus'>) {
    return logWorkflowAction({
        ...params,
        eventType: 'drop_off',
        executionStatus: 'failure'
    });
}

/**
 * Log a workflow cancellation/abandonment
 */
export async function logWorkflowCancel(params: Omit<LogParams, 'executionStatus'>) {
    return logWorkflowAction({
        ...params,
        eventType: 'drop_off',
        executionStatus: 'failure' // or 'success' depending on if cancellation was successful? usually 'failure' of the goal
    });
}

/**
 * Log when a crew is created
 */
export async function logCrewCreated(params: LogParams) {
    return logWorkflowAction({
        ...params,
        eventType: 'crew_created',
        executionStatus: 'success'
    });
}
