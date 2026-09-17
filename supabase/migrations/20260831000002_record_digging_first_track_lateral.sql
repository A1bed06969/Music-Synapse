-- Junkie Dig: fold each album's first track into the shelf/new-arrivals
-- RPCs directly via LEFT JOIN LATERAL, instead of a separate paginated
-- query per shelf-load (utils/recordDigging.ts's old attachFirstTracks).
-- Also adds t.id as an explicit ORDER BY tiebreaker so "first track" is a
-- real guarantee, not an accidental consequence of page/batch sizing.
-- (DROP is required because the return row type is changing — two new
-- OUT columns — which CREATE OR REPLACE cannot do on its own.)
DROP FUNCTION IF EXISTS record_digging_shelf_albums(text);
DROP FUNCTION IF EXISTS record_digging_new_arrivals(date, date);

CREATE OR REPLACE FUNCTION record_digging_shelf_albums(target_genre_id text)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date,
  first_track_id text, first_track_preview_url text
)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (al.id)
    al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date,
    ft.id, ft.preview_url
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  JOIN artist_genre ag ON ag.artist_id = al.artist_id
  LEFT JOIN LATERAL (
    SELECT t.id, t.preview_url
    FROM track t
    WHERE t.album_id = al.id
    ORDER BY t.disc_number NULLS FIRST, t.track_no NULLS FIRST, t.id
    LIMIT 1
  ) ft ON true
  WHERE ag.genre_id = target_genre_id AND al.jacket_url IS NOT NULL
  ORDER BY al.id;
$$;

CREATE OR REPLACE FUNCTION record_digging_new_arrivals(since_date date, until_date date)
RETURNS TABLE (
  album_id text, title text, jacket_url text, artist_id text, artist_name text, release_date date,
  first_track_id text, first_track_preview_url text
)
LANGUAGE sql STABLE AS $$
  SELECT al.id, al.title, al.jacket_url, al.artist_id, ar.name, al.release_date,
    ft.id, ft.preview_url
  FROM album al
  JOIN artist ar ON ar.id = al.artist_id
  LEFT JOIN LATERAL (
    SELECT t.id, t.preview_url
    FROM track t
    WHERE t.album_id = al.id
    ORDER BY t.disc_number NULLS FIRST, t.track_no NULLS FIRST, t.id
    LIMIT 1
  ) ft ON true
  WHERE al.jacket_url IS NOT NULL
    AND al.release_date >= since_date
    AND al.release_date <= until_date
  ORDER BY al.release_date DESC;
$$;
