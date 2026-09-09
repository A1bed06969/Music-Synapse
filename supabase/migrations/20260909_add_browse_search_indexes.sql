-- 一覧ページの検索を実用速度にするためのインデックス群。
--
-- 経緯: /tracks の絞り込みは track 812,813行に対する ILIKE '%語%' で、
-- インデックスが効かず statement timeout になっていた。
-- 計測してわかったこと:
--   1. pg_trgmのGINインデックスは効くが、ヒット行のヒープ読み出しが重い
--      (「LOVE」で25,548行=15,873ブロックの読み出しに4.4秒)
--   2. (title, artist_id)のカバリングインデックス+VACUUMでヒープ参照は0になるが、
--      812,813エントリの走査自体で2.8秒かかり、3秒の制限に届かない
--   3. pg_trgmは3文字未満では機能しないため、「愛」「未来」のような
--      日本語の短い検索語では必ず全走査になる
-- 結論として、日本語の部分一致にはPGroonga(2-gram索引)を使う。
-- TokenBigramSplitSymbolAlphaDigitを指定するのは、英数字も2-gram化して
-- 「LOV」→「LOVE」のような入力途中の部分一致を効かせるため
-- (既定のTokenBigramは英数字を単語単位で扱うためヒットしない)。

CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS idx_track_title_pgroonga ON track USING pgroonga (title)
  WITH (tokenizer = 'TokenBigramSplitSymbolAlphaDigit');
CREATE INDEX IF NOT EXISTS idx_album_title_pgroonga ON album USING pgroonga (title)
  WITH (tokenizer = 'TokenBigramSplitSymbolAlphaDigit');
CREATE INDEX IF NOT EXISTS idx_album_title_kana_pgroonga ON album USING pgroonga (title_kana)
  WITH (tokenizer = 'TokenBigramSplitSymbolAlphaDigit');
CREATE INDEX IF NOT EXISTS idx_artist_name_pgroonga ON artist USING pgroonga (name)
  WITH (tokenizer = 'TokenBigramSplitSymbolAlphaDigit');

-- 3文字以上のラテン文字検索向け(PGroonga導入前からの経路。併用して問題ない)
CREATE INDEX IF NOT EXISTS idx_track_title_trgm ON track USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_album_title_kana_trgm ON album USING gin (title_kana gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artist_name_kana_trgm ON artist USING gin (name_kana gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artist_name_en_trgm ON artist USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_credit_person_name_trgm ON credit_person USING gin (name gin_trgm_ops);

-- 曲の有無で /tracks のページングを正確にするためのフラグ。
-- has_own_release(album/track/album_artistのいずれか)とは別に、
-- 曲を持つアーティストだけを対象にする必要があるため独立して持つ。
ALTER TABLE artist ADD COLUMN IF NOT EXISTS has_tracks BOOLEAN NOT NULL DEFAULT false;

UPDATE artist a SET has_tracks = true
WHERE NOT a.has_tracks AND EXISTS (SELECT 1 FROM track WHERE artist_id = a.id);

CREATE OR REPLACE FUNCTION refresh_artist_has_tracks(p_artist_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_artist_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE artist a
  SET has_tracks = EXISTS (SELECT 1 FROM track WHERE artist_id = p_artist_id)
  WHERE a.id = p_artist_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_artist_has_tracks()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_artist_has_tracks(NEW.artist_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_artist_has_tracks(OLD.artist_id);
  ELSE
    IF NEW.artist_id IS DISTINCT FROM OLD.artist_id THEN
      PERFORM refresh_artist_has_tracks(OLD.artist_id);
      PERFORM refresh_artist_has_tracks(NEW.artist_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_artist_has_tracks ON track;
CREATE TRIGGER trg_track_artist_has_tracks
AFTER INSERT OR DELETE OR UPDATE OF artist_id ON track
FOR EACH ROW EXECUTE FUNCTION sync_artist_has_tracks();

CREATE INDEX IF NOT EXISTS idx_artist_has_tracks_sort ON artist (has_tracks, sort_key);
