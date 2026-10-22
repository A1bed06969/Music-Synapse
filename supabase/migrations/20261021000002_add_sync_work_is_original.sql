-- タイアップ作品が、原作の無いオリジナル作品か(Wikipediaの基礎情報の「原作」欄が空、または「オリジナル」)。
ALTER TABLE sync_work ADD COLUMN IF NOT EXISTS is_original boolean NOT NULL DEFAULT false;
