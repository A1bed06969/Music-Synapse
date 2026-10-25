// scripts/register-andpremium-unmatched.ts
/**
 * &Premium「土曜の朝と日曜の夜の音楽」の選曲のうち、カタログに無かったもの(アーティストが無い・曲が無い・同名で決まらない)を、
 * 「アーティスト名+曲名」でApple Music(日本→米国)から探して、その曲の入ったアルバムごとカタログに登録する。
 * 判定はタイアップと同じ /api/admin/sync/register-track(歌い手・曲名が正規化して一致するものだけ。LLMは使わない)。
 * 登録したあとに scripts/import-andpremium-music.ts --apply を流し直すと、企画に紐付く。
 * iTunesは他の処理と同時に流さないこと。続きから再開できる(/private/tmp/andpremium-register-state.json)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/register-andpremium-unmatched.ts [レポートJSON(既定: /private/tmp/andpremium-report.json)]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { fetchDevServer } from '@/utils/devServerFetch'
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

const REPORT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/private/tmp/andpremium-report.json'
const STATE = '/private/tmp/andpremium-register-state.json'
const BASE_URL = internalApiBaseUrl()
const authHeader = 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

type Missing = { pick: { artist_name: string; track_title: string }; reason: string }
type Result = { success?: boolean; retry?: boolean; noMatch?: boolean; cooldownSec?: number; message?: string; artistName?: string; trackName?: string; collectionName?: string }

async function register(artistName: string, songTitle: string): Promise<Result> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetchDevServer(`${BASE_URL}/api/admin/sync/register-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ artistName, songTitle }),
    })
    const json = (await res.json()) as Result
    if (!json.retry) return json
    const waitSec = Math.min(Math.max(json.cooldownSec ?? 60, 30), 660) + 5
    console.log(`  iTunesが一時的に使えません。${waitSec}秒待ってやり直します(${attempt}/8)`)
    await new Promise((r) => setTimeout(r, waitSec * 1000))
  }
  return { success: false, message: 'iTunesが使えず中断' }
}

async function main() {
  const missing = (JSON.parse(readFileSync(REPORT, 'utf-8')) as { missing: Missing[] }).missing
  const state: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf-8')) : {}
  // 同じ曲は1回だけ
  const picks = Array.from(new Map(missing.map((m) => [`${m.pick.artist_name}\t${m.pick.track_title}`, m.pick])).values())
  console.log(`対象: ${picks.length}曲(処理済み ${Object.keys(state).length})`)
  const tally = { registered: 0, noMatch: 0, failed: 0 }
  let i = 0
  for (const p of picks) {
    i++
    const key = `${p.artist_name}\t${p.track_title}`
    if (state[key]) continue
    const r = await register(p.artist_name, p.track_title)
    if (r.success) {
      tally.registered++
      state[key] = 'registered'
      console.log(`[${i}/${picks.length}] 登録: ${p.artist_name}「${p.track_title}」→ ${r.artistName}『${r.collectionName}』`)
    } else if (r.noMatch) {
      tally.noMatch++
      state[key] = 'no-match'
      console.log(`[${i}/${picks.length}] 一致なし: ${p.artist_name}「${p.track_title}」`)
    } else {
      tally.failed++
      console.log(`[${i}/${picks.length}] 失敗: ${p.artist_name}「${p.track_title}」 ${r.message ?? ''}`)
    }
    writeFileSync(STATE, JSON.stringify(state))
  }
  console.log(`=== 完了 === 登録 ${tally.registered}曲 / 一致なし ${tally.noMatch}曲 / 失敗 ${tally.failed}曲`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
