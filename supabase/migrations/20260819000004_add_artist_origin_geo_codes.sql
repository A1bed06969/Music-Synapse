-- supabase/migrations/20260819_add_artist_origin_geo_codes.sql
-- アーティスト出身地マップのドリルダウン表示(塗りつぶし)のための下準備。
-- origin_latitude/longitudeを逆ジオコーディングして得た、日本の市区町村コード・
-- 世界の国/州地域コードを保持する。既存のorigin_prefecture/hometown_city/
-- hometown_countryは自由入力のまま残し、このカラムは地図描画専用の
-- 構造化コードとして独立させる。
ALTER TABLE artist
  ADD COLUMN origin_country_code TEXT,
  ADD COLUMN origin_region_code TEXT,
  ADD COLUMN origin_muni_code TEXT;

-- 市区町村(日本)・州地域(世界)の境界ポリゴンのキャッシュ。実際にアーティストが
-- 割り当てられた分だけ、参照時に外部データソースから取得して保存する
-- (全世界の行政区画を先読みしない)。
CREATE TABLE geo_boundary (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('GEB'::text),
  level TEXT NOT NULL CHECK (level IN ('municipality', 'region')),
  code TEXT NOT NULL,
  name TEXT,
  geometry JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (level, code)
);

ALTER TABLE geo_boundary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON geo_boundary FOR SELECT TO public USING (true);
