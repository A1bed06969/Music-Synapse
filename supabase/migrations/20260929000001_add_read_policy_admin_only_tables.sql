-- festival_extract_pending / artist_match_log / album_match_log は
-- 00000000000001_reconstructed_base_schema.sqlでRLSを有効化しただけで、
-- SELECTポリシーが一切無かった(ポリシーが無いテーブルはRLS有効時デフォルトで
-- 全アクセス拒否になる)。これらは管理画面(app/admin/**)がcreateClient()
-- (anon/authenticatedキー、RLSに従う)経由で読んでいるため、
-- createAdminClient()(service role、RLSバイパス)で書き込んだ内容が
-- 管理画面上では常に空に見えるという不具合になっていた
-- (2026-09-29、フェス出演者AI抽出結果が編集画面で消えて見える不具合として発覚。
-- 実際はfestival_extract_pendingへの書き込み自体は成功していた)。
--
-- 管理画面全体が既にBasic認証で保護されているため(app/admin配下)、
-- 他の"public read"テーブル群と同じ「SELECTは誰でも可、書き込みはservice role
-- のみ」の方針で統一する。
CREATE POLICY "Public read access" ON festival_extract_pending FOR SELECT TO public USING (true);
CREATE POLICY "Public read access" ON artist_match_log FOR SELECT TO public USING (true);
CREATE POLICY "Public read access" ON album_match_log FOR SELECT TO public USING (true);
