-- アーティスト一覧(/artists)をサーバー側ページネーションに作り替えるための下準備。
--
-- 一覧の「アーティスト/メンバー」振り分けは utils/artistPageKind.ts の
-- resolveArtistPageKind と同じ判定(page_overrideがあればそれ、無ければ
-- 「自身名義のリリース(album/track/album_artist)を持つか」)だが、これを
-- リクエストのたびにSQLで計算すると track 81万件のDISTINCTが必要で
-- 実測4.3秒かかり、ページングクエリに使えない。
--
-- そこで has_own_release をトリガーで常に最新に保ち、判定結果を生成列
-- browse_kind として持たせる。定期リフレッシュ方式にしないのは、過去に
-- 「新規登録したアーティストが一覧に出てこない」不具合(PostgRESTの1000件上限)を
-- 経験しており、反映の遅れが同じ症状に見えるため。

ALTER TABLE artist ADD COLUMN has_own_release BOOLEAN NOT NULL DEFAULT false;

-- 既存データのバックフィル
UPDATE artist a
SET has_own_release = true
WHERE EXISTS (SELECT 1 FROM album WHERE artist_id = a.id)
   OR EXISTS (SELECT 1 FROM track WHERE artist_id = a.id)
   OR EXISTS (SELECT 1 FROM album_artist WHERE artist_id = a.id);

-- 1アーティスト分の has_own_release を再計算する。
CREATE OR REPLACE FUNCTION refresh_artist_has_own_release(p_artist_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_artist_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE artist a
  SET has_own_release = (
    EXISTS (SELECT 1 FROM album WHERE artist_id = p_artist_id)
    OR EXISTS (SELECT 1 FROM track WHERE artist_id = p_artist_id)
    OR EXISTS (SELECT 1 FROM album_artist WHERE artist_id = p_artist_id)
  )
  WHERE a.id = p_artist_id;
END;
$$;

-- album/track/album_artist の artist_id の増減を has_own_release に反映する。
-- INSERT時は新しい方だけ、DELETE時は消えた方だけ、UPDATE時は両方を再計算する。
CREATE OR REPLACE FUNCTION sync_artist_has_own_release()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_artist_has_own_release(NEW.artist_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_artist_has_own_release(OLD.artist_id);
  ELSE
    IF NEW.artist_id IS DISTINCT FROM OLD.artist_id THEN
      PERFORM refresh_artist_has_own_release(OLD.artist_id);
      PERFORM refresh_artist_has_own_release(NEW.artist_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_album_artist_release_flag
AFTER INSERT OR DELETE OR UPDATE OF artist_id ON album
FOR EACH ROW EXECUTE FUNCTION sync_artist_has_own_release();

CREATE TRIGGER trg_track_artist_release_flag
AFTER INSERT OR DELETE OR UPDATE OF artist_id ON track
FOR EACH ROW EXECUTE FUNCTION sync_artist_has_own_release();

CREATE TRIGGER trg_album_artist_link_release_flag
AFTER INSERT OR DELETE OR UPDATE OF artist_id ON album_artist
FOR EACH ROW EXECUTE FUNCTION sync_artist_has_own_release();

-- 一覧の振り分け結果そのもの。utils/artistPageKind.ts の resolveArtistPageKind と
-- 同じ規則(page_overrideが'artist'/'member'ならそれを優先、それ以外は
-- 自身名義のリリースの有無)を生成列として持つ。
ALTER TABLE artist ADD COLUMN browse_kind TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN page_override IN ('artist', 'member') THEN page_override
      WHEN has_own_release THEN 'artist'
      ELSE 'member'
    END
  ) STORED;

-- 一覧は browse_kind で絞り、COALESCE(name_kana, name) で並べる。
CREATE INDEX idx_artist_browse_kind_sort ON artist (browse_kind, (COALESCE(name_kana, name)));
