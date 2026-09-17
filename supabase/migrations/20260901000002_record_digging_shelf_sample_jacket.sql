-- Junkie Dig: 棚選択UI(実カタログのジャケットサムネイルを並べる)向けに、
-- 各ジャンル棚の代表ジャケット(1アーティスト5枚キャップ後の中から最新リリース1枚)
-- を record_digging_eligible_genres の戻り値に追加する。
DROP FUNCTION IF EXISTS record_digging_eligible_genres(int);

CREATE OR REPLACE FUNCTION record_digging_eligible_genres(min_albums int)
RETURNS TABLE (genre_id text, genre_name text, album_count bigint, sample_jacket_url text)
LANGUAGE sql STABLE AS $$
  WITH genre_albums AS (
    SELECT DISTINCT g.id AS genre_id, g.name AS genre_name, al.id AS album_id, al.artist_id, al.release_date, al.jacket_url
    FROM genre g
    JOIN artist_genre ag ON ag.genre_id = g.id
    JOIN album al ON al.artist_id = ag.artist_id AND al.jacket_url IS NOT NULL
  ),
  capped AS (
    SELECT genre_id, genre_name, album_id, jacket_url, release_date,
      ROW_NUMBER() OVER (
        PARTITION BY genre_id, artist_id
        ORDER BY release_date DESC NULLS LAST, album_id
      ) AS artist_rank
    FROM genre_albums
  ),
  eligible AS (
    SELECT genre_id, genre_name, COUNT(*) AS album_count
    FROM capped
    WHERE artist_rank <= 5
    GROUP BY genre_id, genre_name
    HAVING COUNT(*) >= min_albums
  ),
  sample AS (
    SELECT DISTINCT ON (genre_id) genre_id, jacket_url
    FROM capped
    WHERE artist_rank <= 5
    ORDER BY genre_id, release_date DESC NULLS LAST, album_id
  )
  SELECT e.genre_id, e.genre_name, e.album_count, s.jacket_url AS sample_jacket_url
  FROM eligible e
  JOIN sample s ON s.genre_id = e.genre_id
  ORDER BY e.genre_name;
$$;
