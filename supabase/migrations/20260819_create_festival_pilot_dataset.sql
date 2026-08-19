-- festival-pilot(世界のフェス出演者収集)の出演者候補データを、コードにコミットする
-- 静的JSONファイルではなくDBで管理できるようにする(管理画面から追加・更新できる)
CREATE TABLE festival_pilot_dataset (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('FPD'::text),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  picks JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
