-- Junkie Dig: 再生中のプレビューがどの曲かを画面に表示できるよう、
-- 各棚RPCの返り値にfirst_track_title(LATERAL joinで既に選んでいる
-- 最初のトラックのタイトル)を追加する。
CREATE OR REPLACE FUNCTION record_digging_new_arrivals(since_date date, until_date date)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date,
  first_track_id text, first_track_preview_url text, first_track_title text
)
LANGUAGE sql STABLE AS $$
  SELECT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date,
    ft.id, ft.preview_url, ft.title
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  LEFT JOIN LATERAL (
    SELECT t.id, t.preview_url, t.title
    FROM track t
    WHERE t.album_id = al.id
    ORDER BY t.disc_number NULLS FIRST, t.track_no NULLS FIRST, t.id
    LIMIT 1
  ) ft ON true
  WHERE al.jacket_url IS NOT NULL
    AND al.release_date >= since_date
    AND al.release_date <= until_date
  ORDER BY al.release_date DESC, al.id;
$$;

CREATE OR REPLACE FUNCTION record_digging_shelf_albums(target_genre_id text)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date,
  first_track_id text, first_track_preview_url text, first_track_title text
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
    ft.id, ft.preview_url, ft.title
  FROM capped c
  LEFT JOIN LATERAL (
    SELECT t.id, t.preview_url, t.title
    FROM track t
    WHERE t.album_id = c.id
    ORDER BY t.disc_number NULLS FIRST, t.track_no NULLS FIRST, t.id
    LIMIT 1
  ) ft ON true
  WHERE c.artist_rank <= 5
  ORDER BY c.id;
$$;
