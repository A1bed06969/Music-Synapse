-- 確認画面で「この1件を登録」を使って1件ずつ登録した場合、どのextracted_index
-- が登録済みかを追跡する。すべてのextracted_dataが登録済みになった時点で
-- statusをregisteredへ切り替え、確認待ちページ一覧から消えるようにするため
-- (register-one/route.ts参照)。
ALTER TABLE disc_guide_scan_pending ADD COLUMN registered_indices INTEGER[] NOT NULL DEFAULT '{}';
