-- Create AI usage tracking table
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT,
  assistant_id TEXT NOT NULL,
  thread_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0.00,
  action TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Add indexes for performance
CREATE INDEX idx_ai_usage_user_id ON ai_usage(user_id);
CREATE INDEX idx_ai_usage_phone_number ON ai_usage(phone_number);
CREATE INDEX idx_ai_usage_created_at ON ai_usage(created_at);
CREATE INDEX idx_ai_usage_assistant_id ON ai_usage(assistant_id);

-- Add RLS policies
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Policy for users to see their own usage
CREATE POLICY "Users can view their own AI usage" ON ai_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Policy for service role to insert usage records
CREATE POLICY "Service role can insert AI usage" ON ai_usage
  FOR INSERT WITH CHECK (true);

-- Policy for service role to update usage records
CREATE POLICY "Service role can update AI usage" ON ai_usage
  FOR UPDATE WITH CHECK (true);
