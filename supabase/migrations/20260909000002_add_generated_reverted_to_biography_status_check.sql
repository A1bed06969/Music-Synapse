-- artist.biography_statusのCHECK制約が元々'AUTO'/'LOCKED'のみで、
-- 今回のGemini自動生成パイプライン(scripts/generate-artist-bios.ts)が使う
-- 'GENERATED'、および管理画面からの取り消しで使う'REVERTED'が入っておらず
-- 生成成功後のartist.bio更新が制約違反で失敗していた
-- (docs/superpowers/specs/2026-09-09-artist-bio-generation-design.md参照)。
ALTER TABLE artist DROP CONSTRAINT artist_biography_status_check;
ALTER TABLE artist ADD CONSTRAINT artist_biography_status_check
  CHECK (biography_status = ANY (ARRAY['AUTO'::text, 'LOCKED'::text, 'GENERATED'::text, 'REVERTED'::text]));
