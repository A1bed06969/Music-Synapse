// scripts/import-rolling-stone-500.ts
/**
 * Rolling Stone誌「The 500 Greatest Albums of All Time」2020年版を
 * ranking_entry(ranking_id=MS_RNK_294gbviu)に取り込む。
 * ユーザー提供のGoogle Sheet(順位, アーティスト名, アルバム名, タグ, リリース の5列、
 * CSVエクスポート)を読み込む。実際のアルバム照合・登録は
 * /api/admin/ranking/register-album(Route Handler)側で行う
 * (registerAlbumFromSearchが内部でafter()を呼ぶため、スクリプトから直接
 * 呼ぶと"after was called outside a request scope"で落ちる。ローカルdev
 * serverを起動した状態で実行すること。scripts/import-tsutaya-meiban.tsと同じ方針)。
 *
 * このリストは明確な順位(1〜500)を持つため、rankをそのまま渡す。
 * リリース年列は空だったため年情報は渡していない(iTunesで見つからない場合の
 * 最小限登録では、release_dateを設定しない)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-rolling-stone-500.ts <csvのパス>
 */
import { readFileSync } from 'fs'

const RANKING_ID = 'MS_RNK_294gbviu'
const PERIOD_DATE = '2020-01-01'
const BASE_URL = 'http://localhost:3000'

type Row = { rank: number; artist_name: string; title: string }

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')
}

/** RFC4180の最小限のパース(ダブルクォートで囲まれたフィールド内のカンマ・
 * エスケープされた""に対応)。このシートは単純な5列構成なので十分。 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const rows: Row[] = []
  for (const line of lines.slice(1)) {
    const [rankStr, artistName, title] = parseCsvLine(line)
    const rank = Number(rankStr)
    if (!rank || !artistName?.trim() || !title?.trim()) continue
    rows.push({ rank, artist_name: artistName.trim(), title: title.trim() })
  }
  return rows
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-rolling-stone-500.ts <csvのパス>')
    process.exit(1)
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf-8'))
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
          periodDate: PERIOD_DATE,
          artistName: row.artist_name,
          title: row.title,
          rank: row.rank,
        }),
      })
      const json = await res.json()

      if (!json.success) {
        failed++
        console.log(`[${done}/${rows.length}] #${row.rank} ${row.artist_name} / ${row.title} -> 失敗: ${json.message}`)
        continue
      }
      if (json.alreadyLinked) {
        alreadyLinked++
        console.log(`[${done}/${rows.length}] #${row.rank} ${row.artist_name} / ${row.title} -> 既に登録済み`)
        continue
      }
      if (json.matchedItunes) matched++
      else fallback++
      console.log(
        `[${done}/${rows.length}] #${row.rank} ${row.artist_name} / ${row.title} -> ${json.albumId} ${json.matchedItunes ? '(iTunes一致)' : '(最小限登録)'}`
      )
    } catch (err) {
      failed++
      console.error(`[${done}/${rows.length}] #${row.rank} ${row.artist_name} / ${row.title} -> 例外: ${(err as Error).message}`)
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
