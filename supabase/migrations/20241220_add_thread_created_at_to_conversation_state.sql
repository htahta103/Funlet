-- Add thread_created_at column to conversation_state table for 2-hour context window
ALTER TABLE conversation_state 
ADD COLUMN IF NOT EXISTS thread_created_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient querying of thread creation times
CREATE INDEX IF NOT EXISTS idx_conversation_state_thread_created_at ON conversation_state(thread_created_at);

-- Add comment to document the purpose
COMMENT ON COLUMN conversation_state.thread_created_at IS 'Timestamp when the OpenAI thread was created for 2-hour context window management';
