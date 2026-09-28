-- 「新着情報」にMV(track.youtube_video_id)を追加する。
--
-- 既存のカテゴリ(artist/album/track/event/curation)はどれも行のcreated_atを
-- 基準にしているが、MVは既存トラック行へ後からyoutube_video_idを付与する
-- (scripts/backfill-track-youtube-mv.ts等)ため、trackのcreated_at自体は
-- 更新されない。「いつMVが付いたか」を持つ専用カラムが必要になる。
--
-- アプリ側の全書き込み経路(手動編集フォーム・バックフィルスクリプト・
-- 重複トラック統合スクリプト)を1つずつ変更する代わりに、トリガーで
-- youtube_video_idの変更を検知して自動的にタイムスタンプを更新する
-- (has_tracks等、既存のtrg_track_*系トリガーと同じ方針)。

ALTER TABLE track ADD COLUMN IF NOT EXISTS youtube_video_id_set_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_youtube_video_id_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.youtube_video_id IS NOT NULL THEN
      NEW.youtube_video_id_set_at := now();
    END IF;
  ELSE
    IF NEW.youtube_video_id IS DISTINCT FROM OLD.youtube_video_id THEN
      NEW.youtube_video_id_set_at := CASE WHEN NEW.youtube_video_id IS NULL THEN NULL ELSE now() END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_youtube_video_id_set_at ON track;
CREATE TRIGGER trg_track_youtube_video_id_set_at
  BEFORE INSERT OR UPDATE ON track
  FOR EACH ROW
  EXECUTE FUNCTION set_youtube_video_id_timestamp();

-- 既存データ分は一律で今の時刻を入れると「新着」に大量に出てしまうため、
-- あえて何もしない(NULLのまま=このカラム追加より前に付いたMVは新着対象外)。

CREATE INDEX IF NOT EXISTS idx_track_youtube_video_id_set_at ON track (youtube_video_id_set_at);

-- 戻り値の列構成(OUT引数)を変えるため、CREATE OR REPLACEではなく
-- DROP -> CREATEが必要(PostgreSQLの制約)。
DROP FUNCTION IF EXISTS new_arrivals_counts(TIMESTAMPTZ);

CREATE FUNCTION new_arrivals_counts(p_boundary TIMESTAMPTZ)
RETURNS TABLE (
  artist_count BIGINT,
  album_count BIGINT,
  track_count BIGINT,
  event_count BIGINT,
  curation_count BIGINT,
  mv_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (SELECT count(*) FROM artist WHERE created_at >= p_boundary),
    (SELECT count(*) FROM album WHERE created_at >= p_boundary),
    (SELECT count(*) FROM track WHERE created_at >= p_boundary),
    (SELECT count(*) FROM event_appearance_artist WHERE created_at >= p_boundary),
    (SELECT count(*) FROM ranking_entry WHERE created_at >= p_boundary),
    (SELECT count(*) FROM track WHERE youtube_video_id_set_at >= p_boundary);
$$;
