-- Junkie Dig(レコード屋ディグり体験)向けの棚判定・アルバム取得用RPC。
-- ジャンルタグはartist_genre経由でしか付いていないため、ジャケットありの
-- アルバム数をアーティスト経由で集計し、閾値以上のジャンルだけを「棚」として
-- 返す。新着棚(ジャンル不問)は別関数で扱う。
CREATE OR REPLACE FUNCTION record_digging_eligible_genres(min_albums int)
RETURNS TABLE (genre_id text, genre_name text, album_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.name, COUNT(DISTINCT al.id) AS album_count
  FROM genre g
  JOIN artist_genre ag ON ag.genre_id = g.id
  JOIN album al ON al.artist_id = ag.artist_id AND al.jacket_url IS NOT NULL
  GROUP BY g.id, g.name
  HAVING COUNT(DISTINCT al.id) >= min_albums
  ORDER BY g.name;
$$;

CREATE OR REPLACE FUNCTION record_digging_shelf_albums(target_genre_id text)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date
)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  JOIN artist_genre ag ON ag.artist_id = al.artist_id
  WHERE ag.genre_id = target_genre_id AND al.jacket_url IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION record_digging_new_arrivals(since_date date)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date
)
LANGUAGE sql STABLE AS $$
  SELECT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  WHERE al.jacket_url IS NOT NULL
    AND al.release_date >= since_date
    AND al.release_date <= CURRENT_DATE
  ORDER BY al.release_date DESC;
$$;
