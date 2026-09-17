-- Junkie Dig: cleanup from the LATERAL-join fix wave's re-review.
-- 1) record_digging_new_arrivals's outer ORDER BY (release_date DESC) is not
--    a unique sort, yet the caller paginates it with .range() — at >1000 rows
--    this could duplicate/drop albums across page boundaries (same bug class
--    fixed for record_digging_shelf_albums earlier: PostgREST's 1000-row cap
--    combined with a non-unique ORDER BY). Currently latent (largest
--    new-arrivals window measured at ~300 rows) but worth closing now rather
--    than waiting for it to bite.
-- 2) Drops the orphaned single-argument record_digging_new_arrivals(date)
--    overload left over from the original migration having been applied
--    twice before its signature grew a second (until_date) parameter — it
--    returns the old 6-column shape and nothing calls it, but leaving it
--    live is a foot-gun for any future caller that binds to the wrong arity.
DROP FUNCTION IF EXISTS record_digging_new_arrivals(date);

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
  ORDER BY al.release_date DESC, al.id;
$$;
