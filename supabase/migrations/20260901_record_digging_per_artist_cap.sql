-- Junkie Dig: 同一ジャンル棚内で1アーティストにつき最大5枚までに制限する。
-- 1アーティストのアルバムだけで棚が埋まってしまうケース(例: Underground Hip
-- Hopは200枚が全て1アーティスト)を避け、棚を実際にディグる価値のあるものにする。
-- 直近5枚(release_date DESC、NULLは末尾)をウィンドウ関数で選び、それ以外は
-- 棚判定・棚取得の両方から除外する — 棚として成立する条件(min_albums以上)も
-- 「キャップ適用後に実際に見えるレコード数」で判定しないと、見かけ上は
-- 8枚以上でも実際には数枚しか出てこない棚が「棚」として現れてしまうため。
CREATE OR REPLACE FUNCTION record_digging_eligible_genres(min_albums int)
RETURNS TABLE (genre_id text, genre_name text, album_count bigint)
LANGUAGE sql STABLE AS $$
  WITH genre_albums AS (
    SELECT DISTINCT g.id AS genre_id, g.name AS genre_name, al.id AS album_id, al.artist_id, al.release_date
    FROM genre g
    JOIN artist_genre ag ON ag.genre_id = g.id
    JOIN album al ON al.artist_id = ag.artist_id AND al.jacket_url IS NOT NULL
  ),
  capped AS (
    SELECT genre_id, genre_name, album_id,
      ROW_NUMBER() OVER (
        PARTITION BY genre_id, artist_id
        ORDER BY release_date DESC NULLS LAST, album_id
      ) AS artist_rank
    FROM genre_albums
  )
  SELECT genre_id, genre_name, COUNT(*) AS album_count
  FROM capped
  WHERE artist_rank <= 5
  GROUP BY genre_id, genre_name
  HAVING COUNT(*) >= min_albums
  ORDER BY genre_name;
$$;

CREATE OR REPLACE FUNCTION record_digging_shelf_albums(target_genre_id text)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date,
  first_track_id text, first_track_preview_url text
)
LANGUAGE sql STABLE AS $$
  WITH genre_albums AS (
    SELECT DISTINCT al.id, al.title, al.jacket_url, al.artist_id, ar.name AS artist_name, al.release_date
    FROM album al
    JOIN artist ar ON ar.id = al.artist_id
    JOIN artist_genre ag ON ag.artist_id = al.artist_id
    WHERE ag.genre_id = target_genre_id AND al.jacket_url IS NOT NULL
  ),
  capped AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY artist_id
        ORDER BY release_date DESC NULLS LAST, id
      ) AS artist_rank
    FROM genre_albums
  )
  SELECT c.id, c.title, c.jacket_url, c.artist_id, c.artist_name, c.release_date,
    ft.id, ft.preview_url
  FROM capped c
  LEFT JOIN LATERAL (
    SELECT t.id, t.preview_url
    FROM track t
    WHERE t.album_id = c.id
    ORDER BY t.disc_number NULLS FIRST, t.track_no NULLS FIRST, t.id
    LIMIT 1
  ) ft ON true
  WHERE c.artist_rank <= 5
  ORDER BY c.id;
$$;
