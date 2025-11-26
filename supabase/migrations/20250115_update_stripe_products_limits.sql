-- Update existing stripe_products with new limits
UPDATE stripe_products 
SET ai_messages_limit = 50, sms_messages_limit = 150, events_limit = 2
WHERE tier = 'free' AND is_active = true;

UPDATE stripe_products 
SET ai_messages_limit = 200, sms_messages_limit = 500, events_limit = 8
WHERE tier = 'standard' AND is_active = true;

UPDATE stripe_products 
SET ai_messages_limit = 600, sms_messages_limit = 1500, events_limit = 25
WHERE tier = 'pro' AND is_active = true;

UPDATE stripe_products 
SET ai_messages_limit = 1500, sms_messages_limit = 4000, events_limit = 75
WHERE tier = 'enterprise' AND is_active = true;
