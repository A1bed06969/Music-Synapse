-- Discogsから画像・発売日・レーベル・トラックリストを取り込んだ際、出典を明示するために
-- 取り込み元URLを保持する(album.tower_urlと同じ理由。著作権法第48条への配慮)。
ALTER TABLE album ADD COLUMN discogs_url TEXT;
