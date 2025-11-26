-- Add sandbox Stripe fields to stripe_products table
ALTER TABLE stripe_products 
ADD COLUMN sandbox_price_id TEXT,
ADD COLUMN sandbox_product_id TEXT;

-- Update existing records with sandbox data
UPDATE stripe_products 
SET sandbox_product_id = 'prod_THJwjdxaqYash5',
    sandbox_price_id = 'price_1SKlIHFiNXEZooPvmpnsZT6y'
WHERE tier = 'standard' AND is_active = true;

UPDATE stripe_products 
SET sandbox_product_id = 'prod_THJx8th1OgpKU1',
    sandbox_price_id = 'price_1SKlJlFiNXEZooPvAysinU4a'
WHERE tier = 'pro' AND is_active = true;

UPDATE stripe_products 
SET sandbox_product_id = 'prod_THJyD3CffPZVYO',
    sandbox_price_id = 'price_1SKlKcFiNXEZooPvWQfWXPfQ'
WHERE tier = 'enterprise' AND is_active = true;

-- Add indexes for performance
CREATE INDEX idx_stripe_products_sandbox_price_id ON stripe_products(sandbox_price_id);
CREATE INDEX idx_stripe_products_sandbox_product_id ON stripe_products(sandbox_product_id);
