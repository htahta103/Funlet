-- Add auto_end_check job type and prepare for auto-end logic

-- 1) Extend job_type CHECK constraint to include auto_end_check
ALTER TABLE job_queue
  DROP CONSTRAINT IF EXISTS job_queue_job_type_check;

ALTER TABLE job_queue
  ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('reminder_24h', 'pause_check_48h', 'auto_end_check'));

-- NOTE:
-- - Existing rows remain valid because they still satisfy the new CHECK set.
-- - New rows can now use job_type = 'auto_end_check'.


