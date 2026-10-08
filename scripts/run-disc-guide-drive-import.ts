// scripts/run-disc-guide-drive-import.ts
//
// 管理画面のDiscGuideDriveImport(ブラウザから/api/admin/disc-guide-scan/drive-importを
// 繰り返し呼ぶ)をCLIから行う。既にdisc_guide_scan_pendingに取り込み済みのファイル名は
// 飛ばすため、Geminiの無料枠切れで止まった後も同じコマンドで続きから再開できる。
// ローカルdevサーバーを起動した状態で実行すること。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/run-disc-guide-drive-import.ts <discGuideId> <DriveフォルダURL>
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchDevServer } from '@/utils/devServerFetch'
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

type DriveImageFile = { id: string; name: string; mimeType: string }

const BASE_URL = internalApiBaseUrl()
const authHeader =
  'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchDevServer(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as T
}

async function importedFilenames(discGuideId: string): Promise<Set<string>> {
  const { data, error } = await createAdminClient()
    .from('disc_guide_scan_pending')
    .select('image_filename')
    .eq('disc_guide_id', discGuideId)
  if (error) throw new Error(`取り込み済みページの取得に失敗しました: ${error.message}`)
  return new Set((data ?? []).map((r) => r.image_filename as string))
}

async function main() {
  const [discGuideId, folderUrl] = process.argv.slice(2)
  if (!discGuideId || !folderUrl) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/run-disc-guide-drive-import.ts <discGuideId> <DriveフォルダURL>')
    process.exit(1)
  }

  const { folderId, files } = await post<{ folderId: string; files: DriveImageFile[] }>(
    '/api/admin/disc-guide-scan/drive-list',
    { folderUrl }
  )
  const done = await importedFilenames(discGuideId)
  const remaining = files.filter((f) => !done.has(f.name))
  console.log(`フォルダ内 ${files.length}枚 / 取り込み済み ${files.length - remaining.length}枚 / 今回 ${remaining.length}枚`)

  let startIndex = 0
  while (startIndex < remaining.length) {
    const result = await post<{ nextIndex: number; done: boolean }>('/api/admin/disc-guide-scan/drive-import', {
      discGuideId,
      folderId,
      files: remaining,
      startIndex,
    })
    startIndex = result.nextIndex
    console.log(`  ${startIndex}/${remaining.length}`)
  }

  // ルート側は1枚ごとの失敗(Geminiの無料枠切れ等)をログに出すだけで次へ進むため、実際に保存された枚数で確認する
  const after = await importedFilenames(discGuideId)
  const missing = files.filter((f) => !after.has(f.name))
  console.log(`\n完了: 取り込み済み ${files.length - missing.length}/${files.length}枚`)
  if (missing.length > 0) {
    console.log(`未取り込み ${missing.length}枚(無料枠の回復後に同じコマンドで再実行すると続きから取り込みます)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
