-- Insert the global "None" sync_up_options record
-- This record is used as a global option (idx = 0) that can be referenced
-- when users select "none" as their response to sync-up time options.
-- 
-- This migration:
-- 1. Removes any duplicate "None" records (keeps the oldest one)
-- 2. Inserts the record only if it doesn't already exist
-- 
-- Safe to run multiple times - will not create duplicates.

-- Ensure only one "None" option exists (idx = 0, sync_up_id IS NULL)
-- Delete any duplicates first, keeping only the oldest one
WITH duplicates AS (
    SELECT id
    FROM sync_up_options
    WHERE idx = 0 AND sync_up_id IS NULL
    ORDER BY created_at ASC
    OFFSET 1
)
DELETE FROM sync_up_options
WHERE id IN (SELECT id FROM duplicates);

-- Insert the "None" option only if it doesn't already exist
INSERT INTO sync_up_options (
    sync_up_id,
    idx,
    start_time,
    end_time,
    option_text,
    created_at
)
SELECT 
    NULL,
    0,
    NULL,
    NULL,
    'none',
    NOW()
WHERE NOT EXISTS (
    SELECT 1 
    FROM sync_up_options 
    WHERE idx = 0 
      AND sync_up_id IS NULL
);

-- Alternative: If you want to ensure only one record with idx = 0 exists,
-- you can use this instead (requires a unique constraint on idx):
-- 
-- INSERT INTO sync_up_options (
--     sync_up_id,
--     idx,
--     start_time,
--     end_time,
--     option_text,
--     created_at
-- ) VALUES (
--     NULL,
--     0,
--     NULL,
--     NULL,
--     'none',
--     NOW()
-- )
-- ON CONFLICT (idx) WHERE sync_up_id IS NULL DO NOTHING;










