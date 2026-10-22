// scripts/run-discogs-credits.ts
/**
 * Discogs からクレジット(プロデューサー・ミックス・マスタリング・作曲・作詞・編曲・ジャケットの制作者・演奏者)を取り込む、優先順の一括処理。
 * 既存の autoImportFromDiscogs(アルバム名が正規化して完全一致したリリースだけを採用)を使う。
 *   ・対象: Apple Music に配信のあるアルバム(最小限の行は除く)。すでに artist_credit があるアルバムは飛ばす
 *   ・優先: キュレーション・アワード・フェスに載るアーティスト → それ以外はアルバム数の多い順
 *   ・試したアルバムは /private/tmp/discogs-credits-state.json に残し、一致しなかったものを毎回やり直さない(再開できる)
 *   ・Discogs API は 60件/分(utils/discogs.ts が600ms間隔で呼ぶ)。1アルバムで検索+取得の2回
 * 同時に動かしてよい: iTunes・LLM は使わない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/run-discogs-credits.ts [--max-minutes=N] [--limit-artists=N]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import { autoImportFromDiscogs } from '@/utils/creditImport'

const STATE = '/private/tmp/discogs-credits-state.json'
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max-minutes='))?.split('=')[1] ?? 0)
const LIMIT_ARTISTS = Number(process.argv.find((a) => a.startsWith('--limit-artists='))?.split('=')[1] ?? 0)

type State = { tried: Record<string, string>; artistsDone: string[] }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { tried: {}, artistsDone: [] }
const save = () => writeFileSync(STATE, JSON.stringify(state))

async function main() {
  const supabase = createAdminClient()
  const started = Date.now()

  // 優先度: キュレーション・アワード・フェスに載っているアーティスト
  const priority = new Map<string, number>()
  for (const [table, w] of [['ranking_entry', 3], ['award_entry', 3], ['event_appearance_artist', 1]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from(table).select('artist_id').not('artist_id', 'is', null).range(from, from + 999)
      for (const r of data ?? []) priority.set(r.artist_id as string, (priority.get(r.artist_id as string) ?? 0) + w)
      if ((data ?? []).length < 1000) break
    }
  }
  // 候補アーティスト: Discogs IDを持つ人(アルバムの照合は名前の完全一致なので、アーティスト名の一致は別途要らない)
  const artists: { id: string; name: string; albums: number }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('artist').select('id, name').not('discogs_artist_id', 'is', null).range(from, from + 999)
    for (const a of data ?? []) artists.push({ id: a.id as string, name: a.name as string, albums: 0 })
    if ((data ?? []).length < 1000) break
  }
  const albumCount = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('album').select('artist_id').not('apple_music_album_id', 'is', null).range(from, from + 999)
    for (const r of data ?? []) albumCount.set(r.artist_id as string, (albumCount.get(r.artist_id as string) ?? 0) + 1)
    if ((data ?? []).length < 1000) break
  }
  for (const a of artists) a.albums = albumCount.get(a.id) ?? 0
  const done = new Set(state.artistsDone)
  const queue = artists
    .filter((a) => a.albums > 0 && !done.has(a.id))
    .sort((x, y) => (priority.get(y.id) ?? 0) - (priority.get(x.id) ?? 0) || y.albums - x.albums)
  console.log(`対象アーティスト ${queue.length}(処理済み ${done.size})`)

  const tally = { albums: 0, matched: 0, credits: 0, relations: 0, instruments: 0, noMatch: 0, failed: 0 }
  let n = 0
  for (const a of queue) {
    if (LIMIT_ARTISTS && n >= LIMIT_ARTISTS) break
    if (MAX_MIN && (Date.now() - started) / 60000 > MAX_MIN) break
    n++
    const { data: albums } = await supabase.from('album').select('id, title').eq('artist_id', a.id).not('apple_music_album_id', 'is', null)
    const { data: credited } = await supabase.from('artist_credit').select('album_id').eq('artist_id', a.id)
    const creditedSet = new Set((credited ?? []).map((r) => r.album_id as string))
    for (const al of albums ?? []) {
      if (creditedSet.has(al.id as string) || state.tried[al.id as string]) continue
      tally.albums++
      const msg = await autoImportFromDiscogs(supabase, a.id, a.name, { id: al.id as string, title: al.title as string })
      state.tried[al.id as string] = msg.slice(0, 40)
      const m = msg.match(/関係(\d+)\/クレジット(\d+)\/楽器(\d+)/)
      if (m) {
        tally.matched++
        tally.relations += Number(m[1]); tally.credits += Number(m[2]); tally.instruments += Number(m[3])
      } else if (/一致なし|0件/.test(msg)) tally.noMatch++
      else tally.failed++
      if (/失敗/.test(msg) && /429|rate/i.test(msg)) { console.log('レート制限のため60秒待ちます'); await new Promise((r) => setTimeout(r, 60000)) }
    }
    state.artistsDone.push(a.id)
    if (n % 5 === 0) {
      save()
      console.log(`[${n}] ${a.name} | ${JSON.stringify(tally)}`)
    }
  }
  save()
  console.log(`=== 終了 === ${JSON.stringify(tally)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
