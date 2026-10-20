// scripts/register-sync-unmatched.ts
/**
 * sync_candidate のうち「アーティスト/曲がカタログに無い」(unmatched)ものを、Apple Music(iTunes)で探して、
 * アルバムごとカタログに登録する。登録できたら候補を pending に戻すので、そのあと
 * scripts/match-sync-candidates.ts を流せば、曲に紐付いて反映される。
 *
 * 登録の判定は決定的(歌い手・曲名が正規化して一致するものだけ。LLMは使わない)。一致しないものは登録せず、
 * 「Apple Musicに一致なし」と残して、次回以降は飛ばす(--retry-tried で再挑戦)。
 * 実際の登録は after() を使うため、ローカルのサーバー(localhost:3000)のAPIを呼ぶ。
 * iTunesは他の処理と同時に流さないこと(レート制限)。制限に当たったら、待ってやり直す。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/register-sync-unmatched.ts [--limit=N] [--retry-tried]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchDevServer } from '@/utils/devServerFetch'
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

const BASE_URL = internalApiBaseUrl()
const RETRY_TRIED = process.argv.includes('--retry-tried')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined
const authHeader = 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

type Result = { success?: boolean; retry?: boolean; noMatch?: boolean; cooldownSec?: number; message?: string; artistName?: string; trackName?: string }

async function register(artistName: string, songTitle: string): Promise<Result> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetchDevServer(`${BASE_URL}/api/admin/sync/register-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ artistName, songTitle }),
    })
    const json = (await res.json().catch(() => ({}))) as Result
    if (json.retry) {
      const wait = Math.max(30, json.cooldownSec ?? 120)
      console.log(`  iTunesが一時的に使えません。${wait}秒待ってやり直します(${attempt}/8)`)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    return json
  }
  return { success: false, message: 'iTunesが使えず中断(あとで再実行すると続きから処理します)' }
}

async function main() {
  const supabase = createAdminClient()
  const rows: { id: string; artist_name: string; song_title: string; match_method: string | null }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase
      .from('sync_candidate')
      .select('id, artist_name, song_title, match_method')
      .eq('status', 'unmatched')
      .neq('artist_name', '')
      .order('created_at')
      .range(offset, offset + 999)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const todo = rows.filter((r) => RETRY_TRIED || r.match_method !== 'itunes_no_match')

  // 同じ(歌い手, 曲名)は1回だけ探す(複数の作品に使われた曲)
  const groups = new Map<string, { artist: string; song: string; ids: string[] }>()
  for (const r of todo) {
    const key = `${r.artist_name}\t${r.song_title}`
    const g = groups.get(key) ?? { artist: r.artist_name, song: r.song_title, ids: [] }
    g.ids.push(r.id)
    groups.set(key, g)
  }
  const list = [...groups.values()].slice(0, LIMIT)
  console.log(`未登録の候補 ${rows.length}件 → 探す曲 ${list.length}件(飛ばした ${rows.length - todo.length}件)\n`)

  let registered = 0, noMatch = 0, failed = 0
  for (const [i, g] of list.entries()) {
    const r = await register(g.artist, g.song)
    if (r.success) {
      registered++
      console.log(`[${i + 1}/${list.length}] 登録: ${g.artist}「${g.song}」→ ${r.artistName}「${r.trackName}」`)
      await supabase.from('sync_candidate').update({ status: 'pending', match_method: null, match_reason: null }).in('id', g.ids)
    } else if (r.noMatch) {
      noMatch++
      console.log(`[${i + 1}/${list.length}] 一致なし: ${g.artist}「${g.song}」`)
      await supabase.from('sync_candidate').update({ match_method: 'itunes_no_match', match_reason: r.message ?? 'Apple Musicに一致なし' }).in('id', g.ids)
    } else {
      failed++
      console.log(`[${i + 1}/${list.length}] 失敗: ${g.artist}「${g.song}」 ${r.message ?? ''}`)
      if (r.message?.includes('中断')) break
    }
  }
  console.log(`\n=== 完了 === 登録 ${registered}件 / 一致なし ${noMatch}件 / 失敗 ${failed}件`)
  console.log('続けて、紐付けを実行してください: npx tsx --env-file=.env.local scripts/match-sync-candidates.ts')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
