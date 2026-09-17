-- supabase/migrations/20260817_add_disc_guide_cover_fields.sql
-- Add cover image and ISBN lookup fields to disc_guide table
-- for album auto-import cover art fetching and error tracking.

ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS cover_image_fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE disc_guide ADD COLUMN IF NOT EXISTS isbn_lookup_error TEXT;
