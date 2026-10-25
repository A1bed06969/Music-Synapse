-- OpenStreetMap から集めたライブハウス・レコードショップを、何度流しても重複しないよう、OSMのIDで見分ける
ALTER TABLE livehouse ADD COLUMN IF NOT EXISTS osm_id TEXT;
ALTER TABLE recordshop ADD COLUMN IF NOT EXISTS osm_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS livehouse_osm_id_key ON livehouse (osm_id) WHERE osm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recordshop_osm_id_key ON recordshop (osm_id) WHERE osm_id IS NOT NULL;
