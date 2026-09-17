-- media_type選択肢(管理画面のMEDIA_TYPE_OPTIONS)には元々「テレビ」が含まれて
-- いたが、CHECK制約にはtvが入っておらず選択すると更新/登録が失敗していた。
ALTER TABLE media DROP CONSTRAINT media_media_type_check;
ALTER TABLE media ADD CONSTRAINT media_media_type_check
  CHECK (media_type = ANY (ARRAY['radio'::text, 'tv'::text, 'magazine'::text, 'web'::text]));
