-- supabase/migrations/20260819_drop_tie_up.sql
-- tie_up duplicated the already-existing sync_work/sync_entry tables
-- (see app/admin/data/sync/), discovered during final review of the
-- artist timeline feature before any real data was entered (0 rows).
-- Dropping in favor of retrofitting the timeline to read sync_work/sync_entry.
DROP TABLE IF EXISTS tie_up;
