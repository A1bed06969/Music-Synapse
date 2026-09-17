-- ============================================================================
-- RECONSTRUCTED BASE SCHEMA (best-effort, NOT a dump of the real database)
-- ============================================================================
--
-- なぜこのファイルがあるか:
--   supabase/migrations/ に残る 66 本のマイグレーションは全て「既存テーブルへの
--   差分(ALTER TABLE / 新規の付随テーブル / 関数 / インデックス)」であり、
--   artist・album・track をはじめとする中核テーブルの CREATE TABLE は
--   どこにも存在しない(マイグレーション管理を始める前に本番DBへ直接
--   作られたため)。そのため `supabase start` は 1 本目の
--   20260817_add_disc_guide_cover_fields.sql で
--   `ERROR: relation "disc_guide" does not exist` になって止まる。
--
--   このファイルはアプリケーションコード(app/ utils/ scripts/ __tests__/ の
--   .from('X').select/insert/update/upsert 呼び出し)と、既存 66 本の
--   マイグレーション内の REFERENCES 句・RPC 定義から「逆算」した、
--   マイグレーション適用前のベーススキーマの再構築である。
--
-- 重要な前提:
--   * ファイル名 00000000000001_ は、既存 66 本(20260817_〜)より前に
--     適用されるようにするため。`supabase start` はファイル名順に適用する。
--   * 既存マイグレーションが ADD COLUMN する列は、ここでは意図的に定義しない
--     (両方で定義すると衝突する)。例: album.primary_album_id,
--     artist.has_own_release / browse_kind / sort_key, genre.origin_country,
--     media.power_play_url, ranking.list_type / image_url / source_url,
--     ranking_entry.created_at, disc_guide.tower_url など。
--   * 逆に、既存マイグレーションが DROP CONSTRAINT する CHECK 制約は、
--     同じ制約名でここに作っておく必要がある(DROP CONSTRAINT に
--     IF EXISTS が付いていないため)。該当:
--       artist_biography_status_check / event_event_type_check /
--       media_media_type_check
--
-- 信頼度について:
--   これは本番DBのダンプではない。列の有無・NULL 可否・数値型の細かい区別
--   (INTEGER か NUMERIC か等)・UNIQUE 制約の一部は推定を含む。
--   詳細は base-schema-reconstruction-report.md を参照のこと。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 共通関数
-- ---------------------------------------------------------------------------

-- 業務テーブルの主キー生成関数。実際の定義は失われているため再構築である。
--
-- 既知の事実:
--   * 既存マイグレーションでの呼び出し形は generate_ms_id('GEB'::text) 等、
--     引数は接頭辞の「中身」だけ(MS_ もアンダースコアも含まない)。
--   * 実データの ID 形は MS_ART_5ieqs7t0 のように
--     'MS_' + 接頭辞 + '_' + 英小文字数字 8 文字。
--
-- 本物とバイト単位で同一ではない(乱数の取り方・文字集合の細部は不明)が、
-- 列の型(TEXT)・一意性・見た目の形は互換である。ローカル開発用途に限る。
CREATE OR REPLACE FUNCTION generate_ms_id(prefix text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet CONSTANT text := '0123456789abcdefghijklmnopqrstuvwxyz';
  suffix text := '';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN 'MS_' || prefix || '_' || suffix;
END;
$$;

-- updated_at を UPDATE のたびに現在時刻へ更新するトリガー関数。
-- 20260817_create_disc_guide_scan_pending.sql のコメントに
-- 「trg_<table>_updated_at -> set_updated_at()」が
-- 「このスキーマの他の全テーブルと同じ」仕組みとして明記されているため、
-- 同名・同挙動で再構築する。
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 参照されない/されにくい独立テーブル(他テーブルの FK 先になるものを先に)
-- ---------------------------------------------------------------------------

CREATE TABLE artist (
  id                    TEXT PRIMARY KEY DEFAULT generate_ms_id('ART'::text),
  name                  TEXT NOT NULL,
  name_kana             TEXT,
  name_en               TEXT,
  artist_type           TEXT,
  bio                   TEXT,
  biography_status      TEXT,
  formed_year           INTEGER,
  hometown_country      TEXT,
  hometown_city         TEXT,
  origin_prefecture     TEXT,
  origin_latitude       DOUBLE PRECISION,
  origin_longitude      DOUBLE PRECISION,
  official_site_url     TEXT,
  sns_x_url             TEXT,
  sns_instagram_url     TEXT,
  image_url             TEXT,
  url_latest_mv         TEXT,
  apple_music_artist_id TEXT,
  apple_music_country   TEXT,
  spotify_artist_id     TEXT,
  musicbrainz_id        TEXT,
  discogs_artist_id     TEXT,
  streaming_status      TEXT,
  page_override         TEXT,
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 20260909_add_generated_reverted_to_biography_status_check.sql が
  -- この名前で DROP CONSTRAINT するため、制約名は変えないこと
  CONSTRAINT artist_biography_status_check
    CHECK (biography_status = ANY (ARRAY['AUTO'::text, 'LOCKED'::text]))
);
CREATE INDEX idx_artist_name ON artist (name);
CREATE INDEX idx_artist_apple_music_artist_id ON artist (apple_music_artist_id);
CREATE TRIGGER trg_artist_updated_at BEFORE UPDATE ON artist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE genre (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('GNR'::text),
  name         TEXT NOT NULL,
  description  TEXT,
  origin_year  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_genre_name ON genre (name);
CREATE TRIGGER trg_genre_updated_at BEFORE UPDATE ON genre
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE label (
  id            TEXT PRIMARY KEY DEFAULT generate_ms_id('LBL'::text),
  name          TEXT NOT NULL,
  name_kana     TEXT,
  description   TEXT,
  founded_year  INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_label_name ON label (name);
CREATE TRIGGER trg_label_updated_at BEFORE UPDATE ON label
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE credit_person (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('CRP'::text),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_credit_person_updated_at BEFORE UPDATE ON credit_person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE instrument (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('INS'::text),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);
CREATE TRIGGER trg_instrument_updated_at BEFORE UPDATE ON instrument
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- label_founder.person_id の参照先。credit_person とは別テーブルと判断した
-- 根拠: app/labels/[id]/page.tsx が person:person_id(id, name, name_kana) を
-- 選択しており、credit_person 側には name_kana が観測されない(browse_credit_persons
-- RPC は id/name しか返さない)。低い確度の推定である。
CREATE TABLE person (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('PSN'::text),
  name        TEXT NOT NULL,
  name_kana   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_person_updated_at BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE award (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('AWD'::text),
  name         TEXT NOT NULL,
  country      TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_award_updated_at BEFORE UPDATE ON award
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contest (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('CNT'::text),
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_contest_updated_at BEFORE UPDATE ON contest
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE collection (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('COL'::text),
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_collection_updated_at BEFORE UPDATE ON collection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE playlist (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('PLY'::text),
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_playlist_updated_at BEFORE UPDATE ON playlist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('MED'::text),
  name        TEXT NOT NULL,
  media_type  TEXT,
  area        TEXT,
  prefecture  TEXT,
  logo_url    TEXT,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 20260828_add_tv_to_media_type_check.sql がこの名前で DROP CONSTRAINT する
  CONSTRAINT media_media_type_check
    CHECK (media_type = ANY (ARRAY['radio'::text, 'magazine'::text, 'web'::text]))
);
CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE disc_guide (
  id              TEXT PRIMARY KEY DEFAULT generate_ms_id('DGD'::text),
  title           TEXT NOT NULL,
  publisher       TEXT,
  published_year  INTEGER,
  isbn            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_disc_guide_updated_at BEFORE UPDATE ON disc_guide
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE event (
  id                   TEXT PRIMARY KEY DEFAULT generate_ms_id('EVT'::text),
  name                 TEXT NOT NULL,
  name_ja              TEXT,
  event_type           TEXT,
  genre_id             TEXT REFERENCES genre(id) ON DELETE SET NULL,
  founded_year         INTEGER,
  country              TEXT,
  prefecture           TEXT,
  description          TEXT,
  image_url            TEXT,
  official_site_url    TEXT,
  official_youtube_url TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 20260819_add_tour_event_type.sql がこの名前で DROP CONSTRAINT する
  CONSTRAINT event_event_type_check
    CHECK (event_type = ANY (ARRAY['festival'::text, 'one_off_live'::text, 'other'::text]))
);
CREATE TRIGGER trg_event_updated_at BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE livehouse (
  id                  TEXT PRIMARY KEY DEFAULT generate_ms_id('LVH'::text),
  name                TEXT NOT NULL,
  address             TEXT,
  city                TEXT,
  prefecture_or_state TEXT,
  country             TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  hours               TEXT,
  url                 TEXT,
  source              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_livehouse_updated_at BEFORE UPDATE ON livehouse
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE recordshop (
  id                  TEXT PRIMARY KEY DEFAULT generate_ms_id('RSH'::text),
  name                TEXT NOT NULL,
  address             TEXT,
  city                TEXT,
  prefecture_or_state TEXT,
  country             TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  hours               TEXT,
  official_site_url   TEXT,
  sns_x_url           TEXT,
  sns_instagram_url   TEXT,
  source              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_recordshop_updated_at BEFORE UPDATE ON recordshop
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE venue_location (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('VNL'::text),
  venue_name  TEXT NOT NULL,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- app/admin/data/venues/actions.ts が onConflict: 'venue_name' で upsert する
  UNIQUE (venue_name)
);
CREATE TRIGGER trg_venue_location_updated_at BEFORE UPDATE ON venue_location
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sync_work (
  id                 TEXT PRIMARY KEY DEFAULT generate_ms_id('SYW'::text),
  title              TEXT NOT NULL,
  work_type          TEXT,
  company_or_studio  TEXT,
  year               INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_sync_work_updated_at BEFORE UPDATE ON sync_work
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- album / track(相互参照があるため representative_track_id は後付け)
-- ---------------------------------------------------------------------------

CREATE TABLE album (
  id                     TEXT PRIMARY KEY DEFAULT generate_ms_id('ALB'::text),
  artist_id              TEXT REFERENCES artist(id) ON DELETE SET NULL,
  label_id               TEXT REFERENCES label(id) ON DELETE SET NULL,
  title                  TEXT NOT NULL,
  title_kana             TEXT,
  album_type             TEXT,
  release_date           DATE,
  track_count            INTEGER,
  jacket_url             TEXT,
  catalog_number         TEXT,
  album_review           TEXT,
  streaming_status       TEXT,
  streaming_note         TEXT,
  apple_music_album_id   TEXT,
  apple_music_available  BOOLEAN,
  spotify_album_id       TEXT,
  last_synced_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_album_artist_id ON album (artist_id);
CREATE INDEX idx_album_label_id ON album (label_id);
CREATE INDEX idx_album_apple_music_album_id ON album (apple_music_album_id);
CREATE TRIGGER trg_album_updated_at BEFORE UPDATE ON album
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE track (
  id                      TEXT PRIMARY KEY DEFAULT generate_ms_id('TRK'::text),
  album_id                TEXT REFERENCES album(id) ON DELETE SET NULL,
  artist_id               TEXT REFERENCES artist(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  track_no                INTEGER,
  disc_number             INTEGER,
  duration_seconds        INTEGER,
  isrc                    TEXT,
  bpm                     INTEGER,
  preview_url             TEXT,
  lyric_url               TEXT,
  track_review            TEXT,
  apple_music_track_id    TEXT,
  spotify_track_id        TEXT,
  youtube_music_track_id  TEXT,
  youtube_video_id        TEXT,
  amazon_music_track_id   TEXT,
  bandcamp_track_id       TEXT,
  soundcloud_track_id     TEXT,
  tidal_track_id          TEXT,
  last_synced_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_track_album_id ON track (album_id);
CREATE INDEX idx_track_artist_id ON track (artist_id);
CREATE INDEX idx_track_apple_music_track_id ON track (apple_music_track_id);
CREATE TRIGGER trg_track_updated_at BEFORE UPDATE ON track
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- scripts/dedupe-artists.ts の TRACK_FK_REFERENCES に
-- { table: 'album', column: 'representative_track_id' } があることから復元
ALTER TABLE album
  ADD COLUMN representative_track_id TEXT REFERENCES track(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- artist / album / track の関連テーブル
-- ---------------------------------------------------------------------------

-- UNIQUE(album_id, artist_id) は 20260821_album_artist_unique.sql が後から
-- 追加するため、ここでは付けない(同マイグレーションのコメントにも
-- 「テーブル自体・role/billing_order 列・RLS・CHECK 制約は既に存在している」
-- とあり、この時点の姿と一致する)
CREATE TABLE album_artist (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('ALA'::text),
  album_id       TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  artist_id      TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'main',
  billing_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT album_artist_role_check
    CHECK (role = ANY (ARRAY['main'::text, 'featured'::text, 'split'::text]))
);
CREATE INDEX idx_album_artist_album_id ON album_artist (album_id);
CREATE INDEX idx_album_artist_artist_id ON album_artist (artist_id);

-- track_artist には (track_id, artist_id) の UNIQUE 制約が「無い」ことを
-- 本番DBで確認済み(album_artist とは非対称)。意図的に付けない。
CREATE TABLE track_artist (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('TRA'::text),
  track_id       TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  artist_id      TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'main',
  billing_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT track_artist_role_check
    CHECK (role = ANY (ARRAY['main'::text, 'featured'::text, 'split'::text]))
);
CREATE INDEX idx_track_artist_track_id ON track_artist (track_id);
CREATE INDEX idx_track_artist_artist_id ON track_artist (artist_id);

-- app/admin/data/actions.ts が (artist_id, genre_id) を主キー相当として
-- delete/update しており、id 列は一切参照されない
CREATE TABLE artist_genre (
  artist_id   TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  genre_id    TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, genre_id)
);
CREATE INDEX idx_artist_genre_genre_id ON artist_genre (genre_id);

CREATE TABLE album_genre (
  album_id    TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  genre_id    TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, genre_id)
);
CREATE INDEX idx_album_genre_genre_id ON album_genre (genre_id);

CREATE TABLE track_genre (
  track_id    TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  genre_id    TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, genre_id)
);
CREATE INDEX idx_track_genre_genre_id ON track_genre (genre_id);

CREATE TABLE artist_label (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('ARL'::text),
  artist_id   TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  label_id    TEXT NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artist_label_artist_id ON artist_label (artist_id);
CREATE INDEX idx_artist_label_label_id ON artist_label (label_id);

-- UNIQUE(artist_id, link_type, url) は app/admin/data/actions.ts の
-- コメントに明記されている
CREATE TABLE artist_external_link (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('AEL'::text),
  artist_id   TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  link_type   TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id, link_type, url)
);
CREATE INDEX idx_artist_external_link_artist_id ON artist_external_link (artist_id);

-- UNIQUE(artist_id_a, artist_id_b, relation_type) は
-- app/admin/data/actions.ts のコメントに明記されている
CREATE TABLE artist_relation (
  id              TEXT PRIMARY KEY DEFAULT generate_ms_id('ARR'::text),
  artist_id_a     TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  artist_id_b     TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  relation_type   TEXT NOT NULL,
  relation_style  TEXT,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id_a, artist_id_b, relation_type)
);
CREATE INDEX idx_artist_relation_a ON artist_relation (artist_id_a);
CREATE INDEX idx_artist_relation_b ON artist_relation (artist_id_b);

-- UNIQUE(artist_id, album_id, track_id, credit_person_id, role, source, instrument_id)
-- は app/admin/data/actions.ts のコメントに明記されている
CREATE TABLE artist_credit (
  id                TEXT PRIMARY KEY DEFAULT generate_ms_id('ACR'::text),
  artist_id         TEXT REFERENCES artist(id) ON DELETE CASCADE,
  album_id          TEXT REFERENCES album(id) ON DELETE CASCADE,
  track_id          TEXT REFERENCES track(id) ON DELETE CASCADE,
  credit_person_id  TEXT REFERENCES credit_person(id) ON DELETE CASCADE,
  instrument_id     TEXT REFERENCES instrument(id) ON DELETE SET NULL,
  role              TEXT,
  source            TEXT,
  source_url        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artist_id, album_id, track_id, credit_person_id, role, source, instrument_id)
);
CREATE INDEX idx_artist_credit_artist_id ON artist_credit (artist_id);
CREATE INDEX idx_artist_credit_album_id ON artist_credit (album_id);
CREATE INDEX idx_artist_credit_track_id ON artist_credit (track_id);
CREATE INDEX idx_artist_credit_credit_person_id ON artist_credit (credit_person_id);

-- 以下 3 つ(album_credit / track_credit / album_artwork)は
-- scripts/dedupe-artists.ts・scripts/unify-track-artist-credits.ts の
-- FK 一覧にのみ現れ、アプリからの .from() 参照が一切ない。
-- 列構成は推定(最小限)である。
CREATE TABLE album_credit (
  id                TEXT PRIMARY KEY DEFAULT generate_ms_id('ALC'::text),
  album_id          TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  credit_person_id  TEXT REFERENCES credit_person(id) ON DELETE SET NULL,
  instrument_id     TEXT REFERENCES instrument(id) ON DELETE SET NULL,
  role              TEXT,
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_album_credit_album_id ON album_credit (album_id);

CREATE TABLE track_credit (
  id                TEXT PRIMARY KEY DEFAULT generate_ms_id('TRC'::text),
  track_id          TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  credit_person_id  TEXT REFERENCES credit_person(id) ON DELETE SET NULL,
  instrument_id     TEXT REFERENCES instrument(id) ON DELETE SET NULL,
  role              TEXT,
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_track_credit_track_id ON track_credit (track_id);

CREATE TABLE album_artwork (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('ALW'::text),
  album_id    TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  url         TEXT,
  kind        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_album_artwork_album_id ON album_artwork (album_id);

CREATE TABLE track_instrument (
  track_id       TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  instrument_id  TEXT NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, instrument_id)
);
CREATE INDEX idx_track_instrument_instrument_id ON track_instrument (instrument_id);

CREATE TABLE label_founder (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('LBF'::text),
  label_id    TEXT NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  person_id   TEXT REFERENCES person(id) ON DELETE SET NULL,
  role        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_label_founder_label_id ON label_founder (label_id);

CREATE TABLE person_artist_relation (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('PAR'::text),
  person_id      TEXT REFERENCES person(id) ON DELETE CASCADE,
  artist_id      TEXT REFERENCES artist(id) ON DELETE CASCADE,
  relation_type  TEXT,
  start_date     DATE,
  end_date       DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_person_artist_relation_artist_id ON person_artist_relation (artist_id);


-- ---------------------------------------------------------------------------
-- イベント系
-- ---------------------------------------------------------------------------

CREATE TABLE event_edition (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('EED'::text),
  event_id     TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  year         INTEGER,
  start_date   DATE,
  end_date     DATE,
  venue        TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_edition_event_id ON event_edition (event_id);
CREATE TRIGGER trg_event_edition_updated_at BEFORE UPDATE ON event_edition
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- event_appearance.id が INTEGER であることは
-- 20260825_event_appearance_multi_artist.sql の
-- `event_appearance_id INTEGER NOT NULL REFERENCES event_appearance(id)` で確定。
-- 他の業務テーブルと違い generate_ms_id ではない。
CREATE TABLE event_appearance (
  id                SERIAL PRIMARY KEY,
  event_edition_id  TEXT REFERENCES event_edition(id) ON DELETE CASCADE,
  artist_id         TEXT REFERENCES artist(id) ON DELETE CASCADE,
  stage             TEXT,
  venue             TEXT,
  start_time        TIMESTAMPTZ,
  end_time          TIMESTAMPTZ,
  is_headliner      BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_appearance_edition_id ON event_appearance (event_edition_id);
CREATE INDEX idx_event_appearance_artist_id ON event_appearance (artist_id);
CREATE TRIGGER trg_event_appearance_updated_at BEFORE UPDATE ON event_appearance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE event_genre (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('EVG'::text),
  event_id    TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  genre_id    TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, genre_id)
);

CREATE TABLE setlist (
  id                TEXT PRIMARY KEY DEFAULT generate_ms_id('SET'::text),
  artist_id         TEXT REFERENCES artist(id) ON DELETE CASCADE,
  event_edition_id  TEXT REFERENCES event_edition(id) ON DELETE CASCADE,
  performed_on      DATE,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_setlist_artist_id ON setlist (artist_id);
CREATE INDEX idx_setlist_event_edition_id ON setlist (event_edition_id);

CREATE TABLE setlist_track (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('SLT'::text),
  setlist_id   TEXT NOT NULL REFERENCES setlist(id) ON DELETE CASCADE,
  track_id     TEXT REFERENCES track(id) ON DELETE CASCADE,
  position     INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_setlist_track_setlist_id ON setlist_track (setlist_id);

CREATE TABLE music_event (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('MEV'::text),
  artist_id    TEXT REFERENCES artist(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  event_date   DATE,
  venue        TEXT,
  prefecture   TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_music_event_artist_id ON music_event (artist_id);
CREATE TRIGGER trg_music_event_updated_at BEFORE UPDATE ON music_event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- app/admin/data/events/actions.ts が onConflict: 'event_edition_id' で
-- upsert するため、event_edition_id に UNIQUE が必要
CREATE TABLE festival_extract_pending (
  id                TEXT PRIMARY KEY DEFAULT generate_ms_id('FEP'::text),
  event_edition_id  TEXT NOT NULL REFERENCES event_edition(id) ON DELETE CASCADE,
  result            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_edition_id)
);
CREATE TRIGGER trg_festival_extract_pending_updated_at BEFORE UPDATE ON festival_extract_pending
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- メディア / ラジオ / ランキング系
-- ---------------------------------------------------------------------------

CREATE TABLE media_program (
  id            TEXT PRIMARY KEY DEFAULT generate_ms_id('MPG'::text),
  media_id      TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  program_name  TEXT NOT NULL,
  period_type   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_program_media_id ON media_program (media_id);
CREATE TRIGGER trg_media_program_updated_at BEFORE UPDATE ON media_program
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 20260828_add_radio_airplay_pick_rotation_link.sql が
-- `registered_rotation_id TEXT REFERENCES radio_rotation(id)` を追加するため、
-- radio_rotation.id は TEXT で確定
CREATE TABLE radio_rotation (
  id                 TEXT PRIMARY KEY DEFAULT generate_ms_id('RRT'::text),
  media_program_id   TEXT REFERENCES media_program(id) ON DELETE CASCADE,
  artist_id          TEXT REFERENCES artist(id) ON DELETE SET NULL,
  album_id           TEXT REFERENCES album(id) ON DELETE SET NULL,
  track_id           TEXT REFERENCES track(id) ON DELETE SET NULL,
  period_type        TEXT,
  period_start_date  DATE,
  music_type         TEXT,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_radio_rotation_media_program_id ON radio_rotation (media_program_id);
CREATE INDEX idx_radio_rotation_artist_id ON radio_rotation (artist_id);
CREATE INDEX idx_radio_rotation_album_id ON radio_rotation (album_id);
CREATE INDEX idx_radio_rotation_track_id ON radio_rotation (track_id);
CREATE TRIGGER trg_radio_rotation_updated_at BEFORE UPDATE ON radio_rotation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ranking (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('RNK'::text),
  media_id     TEXT REFERENCES media(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  source       TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ranking_media_id ON ranking (media_id);
CREATE TRIGGER trg_ranking_updated_at BEFORE UPDATE ON ranking
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- rank は元々 NOT NULL(20260827_add_ranking_list_type.sql が
-- `ALTER TABLE ranking_entry ALTER COLUMN rank DROP NOT NULL` で外す)。
-- created_at は 20260901_add_ranking_entry_created_at.sql が追加するため、
-- ここでは定義しない。
CREATE TABLE ranking_entry (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('RKE'::text),
  ranking_id     TEXT NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,
  artist_id      TEXT REFERENCES artist(id) ON DELETE SET NULL,
  album_id       TEXT REFERENCES album(id) ON DELETE SET NULL,
  track_id       TEXT REFERENCES track(id) ON DELETE SET NULL,
  rank           INTEGER NOT NULL,
  previous_rank  INTEGER,
  period_date    DATE,
  metric_label   TEXT,
  metric_value   NUMERIC
);
CREATE INDEX idx_ranking_entry_ranking_id ON ranking_entry (ranking_id);
CREATE INDEX idx_ranking_entry_artist_id ON ranking_entry (artist_id);
CREATE INDEX idx_ranking_entry_album_id ON ranking_entry (album_id);
CREATE INDEX idx_ranking_entry_track_id ON ranking_entry (track_id);

CREATE TABLE ranking_source_url (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('RSU'::text),
  ranking_id  TEXT NOT NULL REFERENCES ranking(id) ON DELETE CASCADE,
  year        INTEGER,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ranking_source_url_ranking_id ON ranking_source_url (ranking_id);

CREATE TABLE ranking_article_context (
  id                     TEXT PRIMARY KEY DEFAULT generate_ms_id('RAC'::text),
  ranking_source_url_id  TEXT NOT NULL REFERENCES ranking_source_url(id) ON DELETE CASCADE,
  artist_name            TEXT,
  from_location          TEXT,
  for_fans_of            TEXT,
  key_track              TEXT,
  bio_snippet            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ranking_article_context_source_url_id
  ON ranking_article_context (ranking_source_url_id);

-- 旧ニューステーブル。app/admin/data/media/actions.ts のメディア統合処理が
-- media_id を付け替えるためだけに参照する(現行の公開ページは
-- 20260909_create_news_item.sql の news_item を使う)。列構成は推定。
CREATE TABLE news (
  id            TEXT PRIMARY KEY DEFAULT generate_ms_id('NWS'::text),
  media_id      TEXT REFERENCES media(id) ON DELETE SET NULL,
  title         TEXT,
  url           TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_news_media_id ON news (media_id);


-- ---------------------------------------------------------------------------
-- 賞 / コンテスト / コレクション / プレイリスト / タイアップ
-- ---------------------------------------------------------------------------

CREATE TABLE award_entry (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('AWE'::text),
  award_id    TEXT NOT NULL REFERENCES award(id) ON DELETE CASCADE,
  artist_id   TEXT REFERENCES artist(id) ON DELETE SET NULL,
  album_id    TEXT REFERENCES album(id) ON DELETE SET NULL,
  track_id    TEXT REFERENCES track(id) ON DELETE SET NULL,
  year        INTEGER,
  category    TEXT,
  result      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_award_entry_award_id ON award_entry (award_id);
CREATE INDEX idx_award_entry_artist_id ON award_entry (artist_id);

CREATE TABLE contest_entry (
  id          TEXT PRIMARY KEY DEFAULT generate_ms_id('CNE'::text),
  contest_id  TEXT REFERENCES contest(id) ON DELETE CASCADE,
  artist_id   TEXT REFERENCES artist(id) ON DELETE SET NULL,
  album_id    TEXT REFERENCES album(id) ON DELETE SET NULL,
  track_id    TEXT REFERENCES track(id) ON DELETE SET NULL,
  year        INTEGER,
  result      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contest_entry_artist_id ON contest_entry (artist_id);

CREATE TABLE collection_entry (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('CLE'::text),
  collection_id  TEXT REFERENCES collection(id) ON DELETE CASCADE,
  album_id       TEXT REFERENCES album(id) ON DELETE SET NULL,
  track_id       TEXT REFERENCES track(id) ON DELETE SET NULL,
  position       INTEGER,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_collection_entry_collection_id ON collection_entry (collection_id);

CREATE TABLE playlist_track (
  id           TEXT PRIMARY KEY DEFAULT generate_ms_id('PLT'::text),
  playlist_id  TEXT REFERENCES playlist(id) ON DELETE CASCADE,
  track_id     TEXT REFERENCES track(id) ON DELETE CASCADE,
  position     INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_playlist_track_playlist_id ON playlist_track (playlist_id);

CREATE TABLE sync_entry (
  id            TEXT PRIMARY KEY DEFAULT generate_ms_id('SYE'::text),
  sync_work_id  TEXT NOT NULL REFERENCES sync_work(id) ON DELETE CASCADE,
  track_id      TEXT REFERENCES track(id) ON DELETE CASCADE,
  usage_detail  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_entry_sync_work_id ON sync_entry (sync_work_id);
CREATE INDEX idx_sync_entry_track_id ON sync_entry (track_id);


-- ---------------------------------------------------------------------------
-- ディスクガイド
-- ---------------------------------------------------------------------------

-- UNIQUE(disc_guide_id, album_id) は 20260818_disc_guide_selection_unique.sql が
-- 後から追加するため、ここでは付けない
CREATE TABLE disc_guide_selection (
  id             TEXT PRIMARY KEY DEFAULT generate_ms_id('DGL'::text),
  disc_guide_id  TEXT NOT NULL REFERENCES disc_guide(id) ON DELETE CASCADE,
  album_id       TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disc_guide_selection_disc_guide_id ON disc_guide_selection (disc_guide_id);
CREATE INDEX idx_disc_guide_selection_album_id ON disc_guide_selection (album_id);


-- ---------------------------------------------------------------------------
-- Gemini マッチング判定ログ
-- ---------------------------------------------------------------------------

CREATE TABLE artist_match_log (
  id                           TEXT PRIMARY KEY DEFAULT generate_ms_id('AML'::text),
  stub_artist_id               TEXT REFERENCES artist(id) ON DELETE SET NULL,
  stub_artist_name             TEXT,
  ranking_id                   TEXT REFERENCES ranking(id) ON DELETE SET NULL,
  chosen_apple_music_artist_id TEXT,
  chosen_artist_name           TEXT,
  chosen_country               TEXT,
  confidence                   DOUBLE PRECISION,
  reasoning                    TEXT,
  candidates_json              JSONB,
  auto_applied                 BOOLEAN NOT NULL DEFAULT false,
  reverted                     BOOLEAN NOT NULL DEFAULT false,
  reverted_at                  TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artist_match_log_stub_artist_id ON artist_match_log (stub_artist_id);
CREATE INDEX idx_artist_match_log_ranking_id ON artist_match_log (ranking_id);

CREATE TABLE album_match_log (
  id                   TEXT PRIMARY KEY DEFAULT generate_ms_id('BML'::text),
  stub_album_id        TEXT REFERENCES album(id) ON DELETE SET NULL,
  stub_title           TEXT,
  stub_artist_name     TEXT,
  ranking_id           TEXT REFERENCES ranking(id) ON DELETE SET NULL,
  ranking_entry_id     TEXT REFERENCES ranking_entry(id) ON DELETE SET NULL,
  chosen_candidate_id  TEXT,
  chosen_title         TEXT,
  chosen_artist_name   TEXT,
  confidence           DOUBLE PRECISION,
  reasoning            TEXT,
  candidates_json      JSONB,
  auto_applied         BOOLEAN NOT NULL DEFAULT false,
  reverted             BOOLEAN NOT NULL DEFAULT false,
  reverted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_album_match_log_stub_album_id ON album_match_log (stub_album_id);
CREATE INDEX idx_album_match_log_ranking_id ON album_match_log (ranking_id);


-- ---------------------------------------------------------------------------
-- ベーススキーマ側の RPC
-- ---------------------------------------------------------------------------

-- app/admin/data/curation/page.tsx が .rpc('count_unmatched_ranking_entries')
-- で呼ぶ。同ページの隣にある「未マッチ」判定
-- (album.streaming_status = 'unreleased' かつ tower_url / discogs_url が null)
-- と同じ条件を GROUP BY 集計する形で再構築した。
--
-- 注意: この関数は tower_url / discogs_url を参照するため、それらを追加する
-- 20260821_add_album_tower_url.sql / 20260821_add_album_discogs_url.sql より
-- 後に作る必要がある。ここでは列に依存しない形(遅延解決される plpgsql)で
-- 定義せず、ファイル末尾のマイグレーション適用後に再作成する代わりに、
-- LANGUAGE plpgsql + EXECUTE で列参照を実行時解決にしている。
CREATE OR REPLACE FUNCTION count_unmatched_ranking_entries()
RETURNS TABLE (ranking_id TEXT, stub_count BIGINT)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT re.ranking_id, count(*)::bigint AS stub_count
    FROM ranking_entry re
    JOIN album al ON al.id = re.album_id
    WHERE al.streaming_status = 'unreleased'
      AND al.tower_url IS NULL
      AND al.discogs_url IS NULL
    GROUP BY re.ranking_id
  $q$;
END;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- 20260817_create_disc_guide_scan_pending.sql のコメントに
-- 「このプロジェクトの全テーブルで RLS が有効」と明記されているため、
-- 本番の挙動に合わせて RLS を有効にし、公開コンテンツには読み取り専用の
-- ポリシーを付ける。書き込みは全て service_role 経由
-- (utils/Supabase/admin.ts / scripts/* が SUPABASE_SERVICE_ROLE_KEY を使う)
-- なので RLS をバイパスする。
--
-- 本番に anon/authenticated 向けの INSERT/UPDATE ポリシーが別途あったかどうかは
-- 確認できない。ローカルで anon キーからの書き込みが必要になった場合は、
-- ここに個別のポリシーを足すこと。
DO $$
DECLARE
  t text;
  public_read_tables text[] := ARRAY[
    'artist', 'album', 'track', 'genre', 'label', 'credit_person', 'instrument',
    'person', 'award', 'contest', 'collection', 'playlist', 'media', 'disc_guide',
    'event', 'livehouse', 'recordshop', 'venue_location', 'sync_work',
    'album_artist', 'track_artist', 'artist_genre', 'album_genre', 'track_genre',
    'artist_label', 'artist_external_link', 'artist_relation', 'artist_credit',
    'album_credit', 'track_credit', 'album_artwork', 'track_instrument',
    'label_founder', 'person_artist_relation',
    'event_edition', 'event_appearance', 'event_genre', 'setlist', 'setlist_track',
    'music_event', 'media_program', 'radio_rotation', 'ranking', 'ranking_entry',
    'ranking_source_url', 'ranking_article_context', 'news',
    'award_entry', 'contest_entry', 'collection_entry', 'playlist_track',
    'sync_entry', 'disc_guide_selection'
  ];
  admin_only_tables text[] := ARRAY[
    'festival_extract_pending', 'artist_match_log', 'album_match_log'
  ];
BEGIN
  FOREACH t IN ARRAY public_read_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Public read access" ON %I FOR SELECT TO public USING (true)', t
    );
  END LOOP;
  FOREACH t IN ARRAY admin_only_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;
