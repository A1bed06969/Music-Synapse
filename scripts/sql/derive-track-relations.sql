-- カタログの曲名から、リミックス・エディット・ブートレッグ・マッシュアップの関係を作る(何度実行しても安全)。
-- 実行: docker exec -i supabase_db_music-synapse psql -U postgres < scripts/sql/derive-track-relations.sql
-- 元の曲を特定する条件(誤りを避けるため厳しめ):
--   ・同じアーティストの曲で、版名(Remix/Edit など)と(feat. …)を除いた曲名が、正規化して完全一致する
--   ・その曲自身が、リミックス・エディットなどの版ではない
--   ・同じ曲名が複数あるときは、最も古いアルバムの曲を元とする
-- マッシュアップ・ブートレッグは、元の曲が特定できないものも「マッシュアップ」として残す(related_track_id = NULL)。
\set ON_ERROR_STOP on
\timing on
BEGIN;

CREATE TEMP TABLE cand AS
SELECT
  t.id AS track_id,
  t.artist_id,
  t.title,
  CASE
    WHEN t.title ~* '(mash-?up|マッシュアップ)' THEN 'mashup'
    WHEN t.title ~* 'bootleg|ブートレッグ' THEN 'bootleg'
    WHEN t.title ~* '(remix|リミックス|rmx)' THEN 'remix'
    ELSE 'edit'
  END AS relation_type,
  btrim((regexp_match(t.title, '[(\[（]([^()\[\]（）]*(?:remix|リミックス|rmx|rework|re-edit|edit|bootleg|vip|flip)[^()\[\]（）]*)[)\]）]', 'i'))[1]) AS note,
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(t.title, '\s*[(\[（][^()\[\]（）]*(remix|リミックス|rmx|rework|re-edit|edit|bootleg|vip|flip|mash-?up|マッシュアップ)[^()\[\]（）]*[)\]）]', '', 'gi'),
        '\s*[(\[（]\s*(feat\.?|ft\.?|featuring|with)[^()\[\]（）]*[)\]）]', '', 'gi'),
      '\s+-\s+.*(remix|rmx|リミックス|edit|bootleg).*$', '', 'i')
  ) AS base_title
FROM track t
WHERE t.artist_id IS NOT NULL
  AND (
    t.title ~* '[(\[（][^()\[\]（）]*(remix|リミックス|rmx|rework|re-edit|bootleg|vip|flip|mash-?up|マッシュアップ)[^()\[\]（）]*[)\]）]'
    OR t.title ~* '\s+-\s+.*(remix|rmx|リミックス|bootleg)'
    OR t.title ~* '(mash-?up|マッシュアップ|bootleg)'
    OR t.title ~* '[(\[（][^()\[\]（）]*\yedit\y[^()\[\]（）]*[)\]）]'
  );

CREATE INDEX ON cand (artist_id);
ANALYZE cand;

-- 元の曲の候補: 同じアーティストの、版ではない曲
CREATE TEMP TABLE orig AS
SELECT t.id AS track_id, t.artist_id,
       lower(regexp_replace(normalize(t.title, NFKC), '[\s''’".,!?・&\-_/()\[\]:]', '', 'g')) AS k,
       coalesce(al.release_date, DATE '9999-01-01') AS rel
FROM track t
LEFT JOIN album al ON al.id = t.album_id
WHERE t.artist_id IN (SELECT DISTINCT artist_id FROM cand)
  AND t.title !~* '(remix|リミックス|rmx|rework|re-edit|edit|bootleg|vip|flip|mash-?up|マッシュアップ|instrumental|live|karaoke|カラオケ)';
CREATE INDEX ON orig (artist_id, k);

CREATE TEMP TABLE matched AS
SELECT DISTINCT ON (c.track_id)
  c.track_id, o.track_id AS related_track_id, c.relation_type, c.note
FROM cand c
JOIN orig o ON o.artist_id = c.artist_id
 AND o.k = lower(regexp_replace(normalize(c.base_title, NFKC), '[\s''’".,!?・&\-_/()\[\]:]', '', 'g'))
 AND o.track_id <> c.track_id
WHERE c.base_title <> '' AND c.relation_type IN ('remix', 'edit', 'bootleg')
ORDER BY c.track_id, o.rel, o.track_id;

INSERT INTO track_relation (track_id, related_track_id, relation_type, note)
SELECT track_id, related_track_id, relation_type, note FROM matched
ON CONFLICT DO NOTHING;

-- マッシュアップ(元が特定できなくても残す)
INSERT INTO track_relation (track_id, related_track_id, relation_type, note)
SELECT c.track_id, NULL, 'mashup', c.note FROM cand c
WHERE c.relation_type = 'mashup'
  AND NOT EXISTS (SELECT 1 FROM track_relation r WHERE r.track_id = c.track_id AND r.relation_type = 'mashup' AND r.related_track_id IS NULL)
ON CONFLICT DO NOTHING;

SELECT relation_type, count(*) AS candidates FROM cand GROUP BY 1 ORDER BY 2 DESC;
SELECT relation_type, count(*) AS rows, count(related_track_id) AS with_original FROM track_relation GROUP BY 1 ORDER BY 2 DESC;
COMMIT;
