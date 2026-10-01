-- 2026-10-01: imase重複増殖インシデントの再発防止。
--
-- app/admin/import/actions.tsのupsertArtistFromItunes等、既存アーティストを
-- apple_music_artist_idで検索してから無ければ新規作成する処理には、アプリ側の
-- チェック漏れ(.maybeSingle()がエラーを返した際にerrorを見ずに「見つからなかった」
-- と誤認する等)が起きると、同じ実在アーティストの行が際限なく増殖してしまう
-- 構造的な弱さがある(imaseが1件から一晩で5件に、"Foi"は7件に増殖した実績あり)。
-- アプリ側のチェック漏れは個別に修正したが、今後また同種のバグが別の経路で
-- 混入しても構造的に重複を作れないよう、DB制約として保証する。
--
-- (apple_music_artist_id, lower(name))の組でユニークにする。名前を含めるのは、
-- コラボクレジット("Artist A, B & C"のような複数名義)がこのプロジェクトの
-- 設計上、同じapple_music_artist_idを持ちながら意図的に別レコードとして
-- 存在するため(単純にapple_music_artist_id単体でユニークにすると、この
-- 正当な設計を壊してしまう)。lower()を使うのは、大文字小文字だけが違う
-- 表記ゆれの重複(例: "imase"と"imase"、"Foi"と"foi")も同じ実在アーティストの
-- 重複として弾くため。
--
-- 適用前に本番データで重複が無いことを確認済み(scripts/dedupe-artists-by-apple-id.ts
-- で166組を統合済み)。
CREATE UNIQUE INDEX artist_apple_music_id_name_unique_idx
  ON public.artist (apple_music_artist_id, lower(name))
  WHERE apple_music_artist_id IS NOT NULL;
