-- 受賞対象の作品名(アルバム・曲)。カタログにその作品が無くても受賞一覧に作品名を出せるよう、テキストで持つ
alter table award_entry add column if not exists work_title text;
