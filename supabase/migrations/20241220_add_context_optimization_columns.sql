-- Add columns for context optimization to minimize token costs
ALTER TABLE conversation_state 
ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_compression_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_conversation_state_message_count ON conversation_state(message_count);
CREATE INDEX IF NOT EXISTS idx_conversation_state_last_compression ON conversation_state(last_compression_at);

-- Add comments to document the purpose
COMMENT ON COLUMN conversation_state.message_count IS 'Number of messages in current thread for context optimization';
COMMENT ON COLUMN conversation_state.last_compression_at IS 'Timestamp of last context compression to prevent over-compression';
