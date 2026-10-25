-- Music Planet Tour の都市のページ・出身地カード用の集計。
-- 都市あたりのアーティストは数百組(ロンドン約450)になるため、最初のリリース年やジャンルの集計はSQL側で行う。

-- 都市の出身アーティスト(最初のリリース年つき)。コラボ名義など自分のリリースを持たない行は除く
CREATE OR REPLACE FUNCTION place_artists(p_place_id TEXT)
RETURNS TABLE (id TEXT, name TEXT, image_url TEXT, first_year INT, album_count INT)
LANGUAGE sql STABLE AS $$
  SELECT a.id, a.name, a.image_url,
         EXTRACT(YEAR FROM min(al.release_date))::INT AS first_year,
         count(al.id)::INT AS album_count
  FROM artist a
  JOIN album al ON al.artist_id = a.id AND al.primary_album_id IS NULL
  WHERE a.origin_place_id = p_place_id
  GROUP BY a.id, a.name, a.image_url
  ORDER BY first_year NULLS LAST, a.name
$$;

-- 都市の出身アーティストに多いジャンル
CREATE OR REPLACE FUNCTION place_top_genres(p_place_id TEXT, p_limit INT DEFAULT 6)
RETURNS TABLE (genre_id TEXT, name TEXT, artist_count INT)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.name, count(DISTINCT ag.artist_id)::INT
  FROM artist a
  JOIN artist_genre ag ON ag.artist_id = a.id
  JOIN genre g ON g.id = ag.genre_id
  WHERE a.origin_place_id = p_place_id
  GROUP BY g.id, g.name
  ORDER BY count(DISTINCT ag.artist_id) DESC, g.name
  LIMIT p_limit
$$;

-- 都市ごとの出身アーティスト数(地図の円・同じ国のほかの街・旅する用)。p_country_code が null なら全世界
CREATE OR REPLACE FUNCTION place_artist_counts(p_country_code TEXT DEFAULT NULL)
RETURNS TABLE (place_id TEXT, name TEXT, name_ja TEXT, country_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, artist_count INT)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.name_ja, p.country_code, p.latitude, p.longitude, count(a.id)::INT
  FROM place p
  JOIN artist a ON a.origin_place_id = p.id
  WHERE p_country_code IS NULL OR p.country_code = p_country_code
  GROUP BY p.id
  ORDER BY count(a.id) DESC, p.name
$$;

-- 国ごとの出身アーティスト数と、代表の1組(写真のあるもの優先、リリースの多い順)。「そんな国にも」用
CREATE OR REPLACE FUNCTION country_artist_counts()
RETURNS TABLE (country_code TEXT, artist_count INT, sample_artist_id TEXT, sample_artist_name TEXT, sample_image_url TEXT)
LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT a.origin_country_code AS cc, a.id, a.name, a.image_url,
           row_number() OVER (PARTITION BY a.origin_country_code ORDER BY (a.image_url IS NULL), (SELECT count(*) FROM album al WHERE al.artist_id = a.id) DESC, a.name) AS rn,
           count(*) OVER (PARTITION BY a.origin_country_code) AS n
    FROM artist a
    WHERE a.origin_country_code IS NOT NULL AND a.origin_country_code <> ''
  )
  SELECT cc, n::INT, id, name, image_url FROM ranked WHERE rn = 1 ORDER BY n, cc
$$;
