-- Clear Conversation State for Testing
-- This SQL script clears the conversation_state table to test the streamlined INVITE_MORE_PEOPLE workflow

-- Clear all conversation state records
DELETE FROM conversation_state;

-- Verify the table is empty
SELECT COUNT(*) as remaining_records FROM conversation_state;

-- Show table structure for reference
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'conversation_state' 
ORDER BY ordinal_position;
