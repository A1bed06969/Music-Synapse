-- 版(リミックス・エディット・ブートレッグ)が多い元の曲の一覧(Sampling & Mash-Up Anatomy の入口用)
CREATE OR REPLACE FUNCTION top_remixed_tracks(p_limit int DEFAULT 12)
RETURNS TABLE (track_id text, title text, artist_id text, artist_name text, jacket_url text, versions bigint)
LANGUAGE sql STABLE AS $$
  SELECT o.id, o.title, o.artist_id, a.name, al.jacket_url, c.n
  FROM (SELECT related_track_id, count(*) AS n FROM track_relation WHERE related_track_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT p_limit) c
  JOIN track o ON o.id = c.related_track_id
  LEFT JOIN artist a ON a.id = o.artist_id
  LEFT JOIN album al ON al.id = o.album_id
  ORDER BY c.n DESC;
$$;
GRANT EXECUTE ON FUNCTION top_remixed_tracks(int) TO anon, authenticated, service_role;
