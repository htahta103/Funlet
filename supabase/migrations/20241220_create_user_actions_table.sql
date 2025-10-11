-- Create user_actions table to track user interactions
CREATE TABLE IF NOT EXISTS user_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- 'rsvp_in', 'rsvp_out', 'rsvp_maybe', 'view_events', etc.
  invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb -- Store additional context like phone number, response details
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_created_at ON user_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_actions_action ON user_actions(action);
CREATE INDEX IF NOT EXISTS idx_user_actions_invitation_id ON user_actions(invitation_id);

-- Add RLS policies
ALTER TABLE user_actions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own actions
CREATE POLICY "Users can view their own actions" ON user_actions
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Service role can insert actions
CREATE POLICY "Service role can insert actions" ON user_actions
  FOR INSERT WITH CHECK (true);

-- Policy: Service role can update actions
CREATE POLICY "Service role can update actions" ON user_actions
  FOR UPDATE USING (true);

