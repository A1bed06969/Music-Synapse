-- supabase/migrations/20260817_create_disc_guide_scan_pending.sql
-- Disc guide album auto-import: staging table for OCR-extracted album data
-- awaiting user confirmation. Records remain until user approves and registers.

CREATE TABLE IF NOT EXISTS disc_guide_scan_pending (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('DGS'::text),
  disc_guide_id TEXT NOT NULL REFERENCES disc_guide(id) ON DELETE CASCADE,

  -- Image metadata
  image_filename TEXT NOT NULL,
  image_url TEXT, -- signed URL or CDN path for display

  -- OCR extraction (JSON array of album entries)
  extracted_data JSONB NOT NULL, -- format: [{ title, artist_name, label, release_year, ... }]
  extraction_confidence FLOAT, -- 0.0-1.0, based on Tesseract quality

  -- Album matching results
  matched_data JSONB NOT NULL, -- format: [{ extracted_index, album_id?, artist_id?, candidates: [...] }]

  -- User confirmation state
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'confirmed', 'registered'
  confirmed_data JSONB, -- user-edited extraction + selections (confirmed_data.*.album_id set by user)
  confirmation_notes TEXT,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by TEXT, -- user ID

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disc_guide_scan_pending_disc_guide_id ON disc_guide_scan_pending(disc_guide_id);
CREATE INDEX IF NOT EXISTS idx_disc_guide_scan_pending_status ON disc_guide_scan_pending(status);

-- Keep updated_at current on UPDATE, matching every other table in this schema
-- (trg_<table>_updated_at -> set_updated_at()). Without this the audit column
-- would stay frozen at insert time as rows move pending -> confirmed -> registered.
DROP TRIGGER IF EXISTS trg_disc_guide_scan_pending_updated_at ON disc_guide_scan_pending;
CREATE TRIGGER trg_disc_guide_scan_pending_updated_at
  BEFORE UPDATE ON disc_guide_scan_pending
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: this is admin-only staging data, not public content.
-- Every table in this project has RLS enabled; without it PostgREST would expose
-- both reads and writes to the anon role. No policy is created, so only
-- service_role (which bypasses RLS, see utils/Supabase/admin.ts) can access it.
ALTER TABLE disc_guide_scan_pending ENABLE ROW LEVEL SECURITY;
