-- Music Planet Tour: 出身地の「都市」。座標(origin_latitude/longitude)は都市の中心に固まっているが、
-- 都市の名前もIDも持っていなかったため、「同じ街の出身」をたどれなかった。
-- OpenStreetMap(Nominatim)の逆引きで都市を決め、アーティストを紐づける。
-- 将来、ライブハウス・フェス会場・レコードショップも、この都市に紐づける。
CREATE TABLE IF NOT EXISTS place (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('PLC'::text),
  name TEXT NOT NULL,              -- 英語(なければ現地語)の名前
  name_ja TEXT,                    -- 日本語の名前(OpenStreetMapのname:ja)
  country_code TEXT NOT NULL,      -- ISO 3166-1 alpha-2(小文字)
  admin_name TEXT,                 -- 州・県など(表示の補助)
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  osm_type TEXT,
  osm_id BIGINT,
  wikidata_qid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS place_osm_key ON place (osm_type, osm_id) WHERE osm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS place_country_name_key ON place (country_code, name) WHERE osm_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_place_country ON place (country_code);

ALTER TABLE place ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON place FOR SELECT USING (true);

CREATE TRIGGER trg_place_updated_at BEFORE UPDATE ON place FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE artist ADD COLUMN IF NOT EXISTS origin_place_id TEXT REFERENCES place(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artist_origin_place ON artist (origin_place_id);
