-- genre_lineage/genre_highlightがRLS無しで作成されており、anon keyから直接書き込み
-- 可能な状態になっていた(既存の他の全コンテンツテーブルはPublic read accessの
-- SELECTのみポリシー付きRLSが有効)。同じ規約に揃える。書き込みは全てcreateAdminClient()
-- (service role、RLSをバイパス)経由のみで行われる。
ALTER TABLE genre_lineage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON genre_lineage FOR SELECT TO public USING (true);

ALTER TABLE genre_highlight ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON genre_highlight FOR SELECT TO public USING (true);
