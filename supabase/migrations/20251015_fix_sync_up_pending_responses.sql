-- Fix sync_up_pending_responses table to use sync_up_id instead of event_id

-- Drop the table if it exists (since it might have the wrong schema)
DROP TABLE IF EXISTS sync_up_pending_responses CASCADE;

-- Recreate with correct schema
CREATE TABLE sync_up_pending_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sync_up_id UUID NOT NULL REFERENCES sync_ups(id) ON DELETE CASCADE,
  option_id UUID REFERENCES sync_up_options(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_sync_up_pending_responses_contact_id ON sync_up_pending_responses(contact_id);
CREATE INDEX idx_sync_up_pending_responses_sync_up_id ON sync_up_pending_responses(sync_up_id);
CREATE INDEX idx_sync_up_pending_responses_expires_at ON sync_up_pending_responses(expires_at);

-- Enable RLS
ALTER TABLE sync_up_pending_responses ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role can manage sync up pending responses" ON sync_up_pending_responses
  FOR ALL USING (true);

-- Add comments
COMMENT ON TABLE sync_up_pending_responses IS 'Tracks pending sync up responses from crew members';
COMMENT ON COLUMN sync_up_pending_responses.contact_id IS 'The crew member who needs to respond';
COMMENT ON COLUMN sync_up_pending_responses.sync_up_id IS 'The sync up ID (not event_id)';
COMMENT ON COLUMN sync_up_pending_responses.option_id IS 'Selected option ID (NULL until response received)';
COMMENT ON COLUMN sync_up_pending_responses.expires_at IS 'When this pending response expires';

