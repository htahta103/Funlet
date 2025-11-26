-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    object_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on type for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Create index on object_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_notifications_object_id ON notifications(object_id);

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- Add RLS (Row Level Security) policy
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows users to see their own notifications
-- (assuming you have a user_id column or similar relationship)
-- You may need to adjust this based on your specific requirements
CREATE POLICY "Users can view their own notifications" ON notifications
    FOR ALL USING (true); -- Adjust this condition based on your auth setup

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_notifications_updated_at 
    BEFORE UPDATE ON notifications 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
