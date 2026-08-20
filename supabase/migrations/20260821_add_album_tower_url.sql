-- Tower Recordsの商品ページから画像・発売日・レーベルを取り込んだ際、出典を
-- 明示するために取り込み元URLを保持する(著作権法第48条の出所明示要件への配慮)。
ALTER TABLE album ADD COLUMN tower_url TEXT;
