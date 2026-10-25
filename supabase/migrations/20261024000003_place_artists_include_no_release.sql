-- 都市の出身アーティストに、リリースがまだ登録されていないアーティストも含める
-- (含めないと、地球儀の柱では「1組」なのに、街のカードでは「0組」になっていた)
CREATE OR REPLACE FUNCTION place_artists(p_place_id TEXT)
RETURNS TABLE (id TEXT, name TEXT, image_url TEXT, first_year INT, album_count INT)
LANGUAGE sql STABLE AS $$
  SELECT a.id, a.name, a.image_url,
         EXTRACT(YEAR FROM min(al.release_date))::INT AS first_year,
         count(al.id)::INT AS album_count
  FROM artist a
  LEFT JOIN album al ON al.artist_id = a.id AND al.primary_album_id IS NULL
  WHERE a.origin_place_id = p_place_id
  GROUP BY a.id, a.name, a.image_url
  ORDER BY first_year NULLS LAST, a.name
$$;
