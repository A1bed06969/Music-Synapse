// utils/albumSyncDispatch.tsと同じ理由・同じパターンで、Google Driveフォルダからの
// ディスクガイド画像取込(OCR)を、呼び出し元のafter()ブロックとは別のサーバー関数
// 呼び出しへ切り離してディスパッチする。画像1枚ごとのOCR処理は数秒〜数十秒かかり、
// 枚数が多いフォルダでは自己ディスパッチのホップ数が増えるため、
// app/api/admin/album-sync/route.tsで確認したVercelのループ検知(508)を避けるための
// ホップ間遅延もあわせて踏襲する。
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'
import type { DriveImageFile } from '@/utils/googleDrive'

export async function dispatchDriveImport(
  discGuideId: string,
  folderId: string,
  files: DriveImageFile[],
  startIndex = 0
): Promise<void> {
  const baseUrl = internalApiBaseUrl()
  const authHeader =
    'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

  try {
    const res = await fetch(`${baseUrl}/api/admin/disc-guide-scan/drive-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ discGuideId, folderId, files, startIndex }),
    })
    if (!res.ok) {
      console.error(`Drive画像取込のディスパッチに失敗しました(startIndex=${startIndex}): HTTP ${res.status}`)
    }
  } catch (err) {
    console.error(`Drive画像取込のディスパッチに失敗しました(startIndex=${startIndex}):`, err)
  }
}
