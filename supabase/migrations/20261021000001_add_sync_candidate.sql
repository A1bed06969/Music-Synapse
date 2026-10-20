-- トラックのタイアップ(主題歌・挿入歌・CMソングなど)を、Wikipediaなどから半自動で集めるための受け皿。
--
-- 流れ: 作品ページから抽出 → sync_candidate(候補。出典URLと抜粋つき) → 曲との紐付けを判定 →
--       確信できたものだけ sync_work / sync_entry に反映(曖昧なものは確認待ちに残す)。
-- 候補は消さずに残すので、再実行しても重複せず、あとから見直せる。

-- 作品側: 出典・季節・画像を持てるようにする(同じ作品を二重に作らないための識別キーも)
ALTER TABLE sync_work
  ADD COLUMN IF NOT EXISTS source_key    TEXT,        -- 例: 'jawiki:BEASTARS'。同じ作品を二重に作らない
  ADD COLUMN IF NOT EXISTS source_url    TEXT,
  ADD COLUMN IF NOT EXISTS season_label  TEXT,        -- 例: '2025年秋'
  ADD COLUMN IF NOT EXISTS image_url     TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_work_source_key ON sync_work (source_key) WHERE source_key IS NOT NULL;

-- 紐付け側: 役割(OP/ED/挿入歌/主題歌…)・出典・確信度
ALTER TABLE sync_entry
  ADD COLUMN IF NOT EXISTS role          TEXT,
  ADD COLUMN IF NOT EXISTS source_url    TEXT,
  ADD COLUMN IF NOT EXISTS match_method  TEXT,        -- 'exact' / 'gemini' / 'manual' など
  ADD COLUMN IF NOT EXISTS confidence    REAL,
  ADD COLUMN IF NOT EXISTS candidate_id  TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_entry_work_track_role ON sync_entry (sync_work_id, track_id, COALESCE(role, '')) WHERE track_id IS NOT NULL;

CREATE TABLE sync_candidate (
  id              TEXT PRIMARY KEY DEFAULT generate_ms_id('SYC'::text),
  work_key        TEXT NOT NULL,                 -- sync_work.source_key と同じ(例: 'jawiki:BEASTARS')
  work_title      TEXT NOT NULL,
  work_type       TEXT NOT NULL,                 -- anime / drama / movie / game / cm / tv_program
  year            INTEGER,
  season_label    TEXT,
  role            TEXT NOT NULL DEFAULT '',      -- OP / ED / 挿入歌 / 主題歌 / 劇中歌 など。不明は空文字(重複判定の一意制約に使うため NULL にしない)
  song_title      TEXT NOT NULL,
  artist_name     TEXT NOT NULL DEFAULT '',      -- 歌い手。不明は空文字
  note            TEXT,                          -- 出典の抜粋(短く。何期・何話など)
  source_url      TEXT NOT NULL,
  -- 紐付け結果
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'applied', 'needs_review', 'unmatched', 'rejected')),
  matched_track_id TEXT REFERENCES track(id) ON DELETE SET NULL,
  match_method    TEXT,
  match_confidence REAL,
  match_reason    TEXT,
  applied_entry_id TEXT REFERENCES sync_entry(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sync_candidate_unique ON sync_candidate (work_key, role, song_title, artist_name);
CREATE INDEX idx_sync_candidate_status ON sync_candidate (status);
CREATE TRIGGER trg_sync_candidate_updated_at BEFORE UPDATE ON sync_candidate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE sync_candidate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON sync_candidate FOR SELECT USING (true);

-- どのページを、どの版(revision)で読んだか。編集が入ったときだけ読み直すため、再実行を軽くする
CREATE TABLE sync_source_page (
  source_key     TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  work_type      TEXT NOT NULL,
  year           INTEGER,
  revision_id    BIGINT,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sync_source_page ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON sync_source_page FOR SELECT USING (true);
