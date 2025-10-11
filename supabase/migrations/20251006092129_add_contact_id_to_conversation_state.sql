-- Add contact_id column to conversation_state table
ALTER TABLE conversation_state 
ADD COLUMN contact_id uuid REFERENCES contacts(id);

-- Create index for efficient lookups by contact_id
CREATE INDEX idx_conversation_state_contact_id ON conversation_state(contact_id);

-- Add comment to explain the purpose
COMMENT ON COLUMN conversation_state.contact_id IS 'References contacts.id for crew member conversations (when user_id is null)';
