-- 同じ局に同名の番組が重複して作られないようにする(重複があると.maybeSingle()の検索が
-- 失敗し、本登録のたびに番組が新規作成されて増殖していた。2026-10-07にエフエム北海道で243件)
create unique index if not exists media_program_media_id_program_name_key
  on public.media_program (media_id, program_name);
