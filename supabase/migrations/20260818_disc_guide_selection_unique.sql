-- disc_guide_selectionに(disc_guide_id, album_id)の一意制約を追加。
-- 登録エンドポイントが同じアルバムを重複登録しないようにする(再試行時の
-- 冪等性確保)。upsertのonConflictターゲットとして使う。
ALTER TABLE disc_guide_selection
  ADD CONSTRAINT disc_guide_selection_guide_album_unique UNIQUE (disc_guide_id, album_id);
