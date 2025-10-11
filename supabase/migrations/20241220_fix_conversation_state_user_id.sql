-- Fix conversation_state table to ensure one record per user
-- This migration ensures user_id is unique and not null

-- First, clean up any NULL user_id records (these are likely from testing)
DELETE FROM conversation_state WHERE user_id IS NULL;

-- Add unique constraint on user_id to ensure one record per user
ALTER TABLE conversation_state 
ADD CONSTRAINT conversation_state_user_id_unique UNIQUE (user_id);

-- Make user_id NOT NULL
ALTER TABLE conversation_state 
ALTER COLUMN user_id SET NOT NULL;

-- Add foreign key constraint to profiles table
ALTER TABLE conversation_state 
ADD CONSTRAINT conversation_state_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Create index for efficient querying by user_id
CREATE INDEX IF NOT EXISTS idx_conversation_state_user_id ON conversation_state(user_id);

-- Add comment to document the constraint
COMMENT ON CONSTRAINT conversation_state_user_id_unique ON conversation_state IS 'Ensures each user has only one conversation state record';
