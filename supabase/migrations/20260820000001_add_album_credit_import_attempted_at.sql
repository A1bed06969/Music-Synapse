-- 一括カタログ同期(app/api/admin/album-sync/route.ts)がホップ数削減のため
-- クレジット取込を省略するようになったため、「クレジット取込を試みたか」を
-- album_credit/track_creditの有無(=成功したか)とは別に記録する必要がある。
-- このカラムがNULLのアルバムだけをscripts/backfill-album-credits.tsが拾う。
ALTER TABLE album ADD COLUMN credit_import_attempted_at TIMESTAMPTZ;

-- 既存の全アルバムは、このカラムが無かった旧コードで登録された時点で
-- 同期のたびに必ずクレジット取込を試みていたため、last_synced_atをそのまま
-- 「試行済み」の記録として引き継ぐ(全件を未試行扱いにして一括同期の
-- スキップ分と同じバックログに積み直さないため)
UPDATE album SET credit_import_attempted_at = last_synced_at WHERE credit_import_attempted_at IS NULL;
