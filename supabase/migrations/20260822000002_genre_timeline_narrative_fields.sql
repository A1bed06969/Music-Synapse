-- ジャンル年表に「時代・サブジャンルの背景解説」と「ハイライトごとの独立した年」を
-- 表示できるようにする(どちらも既存データには影響しないnullable列の追加のみ)。
--
-- genre.background_note: そのジャンル(サブジャンル含む)の発祥背景・出来事の解説文。
--   年表の発祥/派生行のサブタイトルとして年ラベルと並べて表示する。
--
-- genre_highlight.event_year / event_year_label: 従来ハイライトは紐づくジャンル行の
--   origin_yearでしか年表上の位置を表せなかった(同じジャンル内で複数の時代の出来事を
--   別々の年に置けなかった)。この2列を追加し、指定があれば優先してその年で表示する
--   (未指定の既存行は今まで通りジャンルのorigin_yearにフォールバックする)。
ALTER TABLE genre ADD COLUMN background_note TEXT;

ALTER TABLE genre_highlight ADD COLUMN event_year INTEGER;
ALTER TABLE genre_highlight ADD COLUMN event_year_label TEXT;
