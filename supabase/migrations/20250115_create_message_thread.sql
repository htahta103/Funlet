-- Create message_thread table to store SMS conversation history when send_sms=false
CREATE TABLE IF NOT EXISTS message_thread (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_message_thread_user_id ON message_thread(user_id);
CREATE INDEX idx_message_thread_phone_number ON message_thread(phone_number);
CREATE INDEX idx_message_thread_created_at ON message_thread(created_at DESC);
CREATE INDEX idx_message_thread_sent ON message_thread(sent);
CREATE INDEX idx_message_thread_role ON message_thread(role);

-- RLS policies
ALTER TABLE message_thread ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage message thread" ON message_thread FOR ALL USING (true);

-- Comments
COMMENT ON TABLE message_thread IS 'Stores SMS conversation history for users when send_sms=false';
COMMENT ON COLUMN message_thread.role IS 'Message role: user (incoming) or assistant (outgoing)';
COMMENT ON COLUMN message_thread.sent IS 'Whether the message was actually sent via SMS';
