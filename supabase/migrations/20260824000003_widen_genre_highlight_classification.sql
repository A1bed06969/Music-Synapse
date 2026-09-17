-- Rockのジャンル史で「CORE ROCK / ROCK-INFLUENCED / ROCK APPROACH」の3段階区分が
-- 必要になったため、core/influenceの2値だったclassificationに'approach'を追加する。
ALTER TABLE genre_highlight DROP CONSTRAINT genre_highlight_classification_check;
ALTER TABLE genre_highlight ADD CONSTRAINT genre_highlight_classification_check
  CHECK (classification IN ('core', 'influence', 'approach'));
