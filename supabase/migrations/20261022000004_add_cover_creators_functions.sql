-- Art Work Museum: ジャケットの制作者(アートワーク・イラスト・アートディレクション・写真)の一覧
CREATE OR REPLACE FUNCTION top_cover_creators(p_limit int DEFAULT 60)
RETURNS TABLE (person_id text, name text, albums bigint, roles text[])
LANGUAGE sql STABLE AS $$
  SELECT min(cp.id) AS person_id, cp.name, count(DISTINCT ac.album_id) AS albums, array_agg(DISTINCT ac.role) AS roles
  FROM artist_credit ac
  JOIN credit_person cp ON cp.id = ac.credit_person_id
  WHERE ac.role IN ('artwork', 'illustrator', 'art_director', 'photographer') AND ac.album_id IS NOT NULL
  GROUP BY cp.name
  ORDER BY count(DISTINCT ac.album_id) DESC, cp.name
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION top_cover_creators(int) TO anon, authenticated, service_role;
