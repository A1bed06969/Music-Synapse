-- supabase/migrations/20260819_add_country_level_to_geo_boundary.sql
-- 国レベルの地図塗りつぶし表示を、世界地図同梱の低解像度データ(1:1.1億)から、
-- 市区町村・州地域と同じ「必要な国だけ都度取得してキャッシュする」方式の
-- 高解像度データ(1:1000万)に切り替えるための対応。
ALTER TABLE geo_boundary DROP CONSTRAINT geo_boundary_level_check;
ALTER TABLE geo_boundary ADD CONSTRAINT geo_boundary_level_check
  CHECK (level = ANY (ARRAY['municipality', 'region', 'country']));
