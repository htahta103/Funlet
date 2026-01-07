-- Create job_queue table for Auto Sync scheduled jobs
-- This table stores reminder and pause check jobs that are processed by pg_cron

CREATE TABLE job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id uuid NOT NULL REFERENCES auto_syncs(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('reminder_24h', 'pause_check_48h')),
  scheduled_at timestamptz NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'skipped')),
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  
  -- Prevent duplicate jobs with same scheduled time
  UNIQUE(sync_id, job_type, scheduled_at)
);

-- CRITICAL: Prevent multiple pending jobs of same type for same sync
-- This ensures only ONE reminder_24h and ONE pause_check_48h can be pending per sync
-- This is the PRIMARY duplicate prevention mechanism
CREATE UNIQUE INDEX idx_job_queue_one_pending_per_type 
ON job_queue (sync_id, job_type) 
WHERE status = 'pending';

-- Note: This index will cause INSERT to fail if duplicate pending job exists
-- Handle with ON CONFLICT DO NOTHING or check before insert

-- Index for fast polling (only pending jobs)
CREATE INDEX idx_job_queue_fetch 
ON job_queue (scheduled_at, status) 
WHERE status = 'pending';

-- Index for sync lookups
CREATE INDEX idx_job_queue_sync 
ON job_queue (sync_id, status);

-- Index for cleanup (old processed jobs)
CREATE INDEX idx_job_queue_cleanup 
ON job_queue (status, processed_at) 
WHERE status IN ('processed', 'skipped');

-- Enable RLS
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for Edge Function)
CREATE POLICY "Service role full access"
ON job_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Users can view jobs for their own auto_syncs (read-only)
CREATE POLICY "Users can view their own sync jobs"
ON job_queue
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM auto_syncs
    WHERE auto_syncs.id = job_queue.sync_id
    AND auto_syncs.organizer_id = auth.uid()
  )
);

-- Note: Users should NOT be able to INSERT/UPDATE/DELETE jobs directly
-- Only service role (via Edge Function) can modify jobs

-- Function to schedule first reminder when auto_sync is created
-- DEMO: 5 minutes | PRODUCTION: 24 hours
CREATE OR REPLACE FUNCTION schedule_first_reminder()
RETURNS TRIGGER AS $$
BEGIN
  -- Only schedule if status is 'running'
  IF NEW.status = 'running' THEN
    -- Check if a pending reminder job already exists (prevent duplicates)
    IF NOT EXISTS (
      SELECT 1 FROM job_queue 
      WHERE sync_id = NEW.id 
        AND job_type = 'reminder_24h' 
        AND status = 'pending'
    ) THEN
      BEGIN
        INSERT INTO job_queue (sync_id, job_type, scheduled_at)
        VALUES (NEW.id, 'reminder_24h', now() + interval '5 minutes'); -- DEMO: 5m, PRODUCTION: 24 hours
      EXCEPTION WHEN unique_violation THEN
        -- Duplicate pending job exists (caught by partial unique index), ignore
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auto_syncs insert
-- SAFETY: Only fires on INSERT (not UPDATE/DELETE)
-- SAFETY: Only fires when status = 'running' (existing syncs unaffected)
-- SAFETY: Uses ON CONFLICT DO NOTHING (fails gracefully)
CREATE TRIGGER on_auto_sync_created
AFTER INSERT ON auto_syncs
FOR EACH ROW 
WHEN (NEW.status = 'running')
EXECUTE FUNCTION schedule_first_reminder();

-- Note: This trigger will NOT fire for:
-- 1. Existing auto_syncs records (only new INSERTs)
-- 2. Updates to existing records (only INSERT events)
-- 3. Records with status != 'running' (WHEN clause prevents)
-- 4. Records inserted before this trigger was created

