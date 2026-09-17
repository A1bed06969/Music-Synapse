-- Gemini自動抽出(app/api/admin/radio-power-play-collect)の結果が実際に局サイトの
-- 内容と合っているかを、/admin/data/media/radio-fact-checkで人力チェックした結果を保持する。
-- NULL=未チェック、TRUE=抽出は正しかった、FALSE=抽出が間違っていた
-- (その場でartist_name/track_titleを修正して保存する運用。修正後の値がこの列を
-- 使わない既存のマッチング/登録フローにもそのまま使われる)。
ALTER TABLE radio_airplay_pick
  ADD COLUMN fact_checked_correct BOOLEAN;
