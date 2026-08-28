// scripts/import-towerecomen.ts
/**
 * ユーザーの個人収集スプレッドシート(タワレコメンシート)から抽出したJSONを
 * ranking_entry(ranking_id=タワレコメン企画)に取り込む。実際のアルバム照合・
 * 登録は/api/admin/ranking/register-album(Route Handler)側で行う
 * (registerAlbumFromSearchが内部でafter()を呼ぶため、スクリプトから直接
 * 呼ぶと"after was called outside a request scope"で落ちる。ローカルdev
 * serverを起動した状態で実行すること)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-towerecomen.ts <towerecomen.jsonのパス>
 */
import { readFileSync } from 'fs'

const RANKING_ID = 'MS_RNK_ay9zpw11'
const BASE_URL = 'http://localhost:3000'

type Row = { no: number; year: number; is_domestic: boolean | null; artist_name: string; title: string }

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')
}

async function main() {
  const jsonPath = process.argv[2]
  if (!jsonPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-towerecomen.ts <towerecomen.jsonのパス>')
    process.exit(1)
  }

  const rows: Row[] = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  console.log(`対象: ${rows.length}件\n`)

  let done = 0
  let matched = 0
  let fallback = 0
  let alreadyLinked = 0
  let failed = 0

  for (const row of rows) {
    done++
    try {
      const res = await fetch(`${BASE_URL}/api/admin/ranking/register-album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({
          rankingId: RANKING_ID,
          periodDate: `${row.year}-01-01`,
          artistName: row.artist_name,
          title: row.title,
          year: row.year,
          rank: null,
        }),
      })
      const json = await res.json()

      if (!json.success) {
        failed++
        console.log(`[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> 失敗: ${json.message}`)
        continue
      }
      if (json.alreadyLinked) {
        alreadyLinked++
        console.log(`[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> 既に登録済み`)
        continue
      }
      if (json.matchedItunes) matched++
      else fallback++
      console.log(
        `[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> ${json.albumId} ${json.matchedItunes ? '(iTunes一致)' : '(最小限登録)'}`
      )
    } catch (err) {
      failed++
      console.error(`[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> 例外: ${(err as Error).message}`)
    }
  }

  console.log(
    `\n完了: ${done}件処理、iTunes一致${matched}件、最小限登録${fallback}件、既に登録済み${alreadyLinked}件、失敗${failed}件。`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
