-- 「19世紀後半」のように発祥年が特定されていない(諸説ある)ジャンル向けに、
-- Wikipediaの元の表記をそのまま保持する列。origin_yearは年表の並び替え専用の
-- 概算値として扱い、表示側はこちらがあれば優先する(utils/wikipediaGenre.ts参照)。
ALTER TABLE genre ADD COLUMN origin_year_label TEXT;
