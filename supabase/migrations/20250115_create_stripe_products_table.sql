-- Create Stripe products table to track subscription tiers and pricing
CREATE TABLE IF NOT EXISTS stripe_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE,
  stripe_product_id TEXT,
  tier TEXT NOT NULL, -- 'free', 'standard', 'pro', 'enterprise'
  price_usd DECIMAL(10, 2) NOT NULL,
  ai_messages_limit INTEGER NOT NULL,
  sms_messages_limit INTEGER NOT NULL,
  events_limit INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert the provided Stripe products with updated limits
INSERT INTO stripe_products (name, stripe_price_id, tier, price_usd, ai_messages_limit, sms_messages_limit, events_limit) VALUES
('Funlet Standard', 'price_1SKJv7FkQpmG5zYQLK6DQhhH', 'standard', 6.99, 200, 500, 8),
('Funlet Pro', 'price_1SKJwHFkQpmG5zYQp21Lmlh3', 'pro', 16.99, 600, 1500, 25),
('Funlet Enterprise', 'price_1SKJxLFkQpmG5zYQpn8MJ2V4', 'enterprise', 39.99, 1500, 4000, 75);

-- Add free tier (no Stripe price ID)
INSERT INTO stripe_products (name, stripe_price_id, tier, price_usd, ai_messages_limit, sms_messages_limit, events_limit) VALUES
('Funlet Free', 'free', 'free', 0.00, 50, 150, 2);

-- Create indexes for performance
CREATE INDEX idx_stripe_products_tier ON stripe_products(tier);
CREATE INDEX idx_stripe_products_stripe_price_id ON stripe_products(stripe_price_id);
CREATE INDEX idx_stripe_products_is_active ON stripe_products(is_active);

-- Add RLS policies
ALTER TABLE stripe_products ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read active products
CREATE POLICY "Anyone can view active products" ON stripe_products
  FOR SELECT USING (is_active = true);

-- Policy: Service role can manage all products
CREATE POLICY "Service role can manage products" ON stripe_products
  FOR ALL USING (true);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_stripe_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stripe_products_updated_at
  BEFORE UPDATE ON stripe_products
  FOR EACH ROW
  EXECUTE FUNCTION update_stripe_products_updated_at();
