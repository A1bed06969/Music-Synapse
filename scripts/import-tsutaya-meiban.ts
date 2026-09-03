// scripts/import-tsutaya-meiban.ts
/**
 * TSUTAYAが過去に展開していたセレクション企画「これは聴いておきたい不滅の名盤」
 * のアーティスト名・アルバム名リスト(ユーザー提供のスプレッドシートから抽出した
 * JSON)をranking_entry(ranking_id=不滅の名盤企画)に取り込む。実際のアルバム
 * 照合・登録は/api/admin/ranking/register-album(Route Handler)側で行う
 * (registerAlbumFromSearchが内部でafter()を呼ぶため、スクリプトから直接
 * 呼ぶと"after was called outside a request scope"で落ちる。ローカルdev
 * serverを起動した状態で実行すること。scripts/import-towerecomen.tsと同じ方針)。
 *
 * このリストには年代情報が無い(ジャンル・年代を問わない横断セレクションのため)。
 * period_dateはNOT NULL制約を満たすための技術的なプレースホルダーとして全件
 * 同じ日付を入れる(全エントリが同じ日付なので、公開ページの「複数年ある時だけ
 * 年見出しで区切る」ロジックは効かず、フラットな一覧として表示される)。
 * yearを渡さないため、iTunesで見つからなかった場合の最小限登録でも
 * release_dateは設定されない(大昔の名盤に不正確な最近の日付を入れないため)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-tsutaya-meiban.ts <tsutaya-meiban.jsonのパス>
 */
import { readFileSync } from 'fs'

const RANKING_ID = 'MS_RNK_97lr6602'
const PERIOD_DATE = '2020-01-01'
const BASE_URL = 'http://localhost:3000'

type Row = { artist_name: string; title: string }

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')
}

async function main() {
  const jsonPath = process.argv[2]
  if (!jsonPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-tsutaya-meiban.ts <tsutaya-meiban.jsonのパス>')
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
          periodDate: PERIOD_DATE,
          artistName: row.artist_name,
          title: row.title,
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
