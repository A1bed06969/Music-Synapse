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
import { readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchDevServer } from '@/utils/devServerFetch'

// 企画のIDは名前で探す(DBを作り直すとIDが変わるため、固定値にしない)
const RANKING_NAME = process.argv.find((a) => a.startsWith('--ranking='))?.slice('--ranking='.length) ?? 'タワレコメン'
const BASE_URL = 'http://localhost:3000'
const shardSuffix = (process.argv.find((a) => a.startsWith('--shard=')) ?? '').replace('--shard=', '').replace('/', 'of')
const PENDING_PATH = `.${RANKING_NAME === 'タワレコメン' ? 'towerecomen' : 'ranking-import'}-pending${shardSuffix ? `-${shardSuffix}` : ''}.json`

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

  const supabase = createAdminClient()
  const { data: ranking } = await supabase.from('ranking').select('id').eq('name', RANKING_NAME).maybeSingle()
  if (!ranking) {
    console.error(`企画「${RANKING_NAME}」がありません。先に ranking に作成してください。`)
    process.exit(1)
  }
  const RANKING_ID = ranking.id as string

  // --shard=i/n: 全件をn分割した、i番目だけを処理する(並行で流して時間を縮めるため。0始まり)
  const shardArg = process.argv.find((a) => a.startsWith('--shard='))
  const [shardIndex, shardCount] = shardArg ? shardArg.split('=')[1].split('/').map(Number) : [0, 1]
  const rows: Row[] = (JSON.parse(readFileSync(jsonPath, 'utf-8')) as Row[]).filter((_, idx) => idx % shardCount === shardIndex)
  console.log(`対象: ${rows.length}件(企画 ${RANKING_ID})\n`)
  const pending: { year: number; artist_name: string; title: string; reason: string }[] = []

  let done = 0
  let matched = 0
  let fallback = 0
  let alreadyLinked = 0
  let failed = 0

  // LLMの無料枠切れの作品は後回しにして、LLMが要らない作品を先に進める。後回しが5件続いたら30分待つ
  const queue = [...rows]
  let deferredStreak = 0
  while (queue.length) {
    const row = queue.shift()!
    done++
    try {
      // iTunesが一時的に使えない(retry)ときは、「保留」にせず、待ってから同じ作品をやり直す
      let json: { success?: boolean; retry?: boolean; deferred?: boolean; pending?: boolean; cooldownSec?: number; message?: string; alreadyLinked?: boolean; matchedItunes?: boolean; albumId?: string } = {}
      for (let attempt = 0; attempt < 40; attempt++) {
        const res = await fetchDevServer(`${BASE_URL}/api/admin/ranking/register-album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({
          rankingId: RANKING_ID,
          periodDate: `${row.year}-01-01`,
          artistName: row.artist_name,
          title: row.title,
          year: row.year,
          rank: null,
          // 表記ゆれ(邦題・カタカナ)をLLMで解決し、見つからなければ名前だけのアーティスト/アルバムは作らず保留にする
          strict: true,
        }),
      })

        json = await res.json()
        // LLM(Gemini・Groq)の無料枠切れは、保留にせず、30分待って同じ作品をやり直す
        if (!json.success && json.pending && (json.message ?? '').startsWith('LLM判定に失敗')) {
          queue.push(row)
          deferredStreak++
          if (deferredStreak >= 5) {
            console.log('  LLMの無料枠が尽きています。後回しが続いたので、30分待ちます')
            await new Promise((r) => setTimeout(r, 30 * 60 * 1000))
            deferredStreak = 0
          }
          json.deferred = true
          break
        }
        if (!json.retry) break
        const waitSec = Math.min(Math.max(json.cooldownSec ?? 60, 30), 660) + 5
        console.log(`  iTunesが一時的に使えません。${waitSec}秒待ってやり直します(${attempt + 1}/40)`)
        await new Promise((r) => setTimeout(r, waitSec * 1000))
      }
      if (json.deferred) continue
      deferredStreak = 0
      if (json.retry) {
        failed++
        console.log(`[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> iTunesが使えず中断(後で再実行すると続きから処理します)`)
        continue
      }

      if (!json.success && json.pending) {
        pending.push({ year: row.year, artist_name: row.artist_name, title: row.title, reason: json.message ?? '' })
        console.log(`[${done}/${rows.length}] ${row.artist_name} / ${row.title} -> 保留: ${json.message}`)
        continue
      }
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

  writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 1))
  console.log(
    `\n完了: ${done}件処理、iTunes一致${matched}件、最小限登録${fallback}件、既に登録済み${alreadyLinked}件、保留${pending.length}件、失敗${failed}件。`
  )
  console.log(`保留一覧: ${PENDING_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
