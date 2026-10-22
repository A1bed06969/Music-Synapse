// scripts/backfill-discogs-ids-from-links.ts
/**
 * artist_external_link(link_type='discogs')のURLから、artist.discogs_artist_id を埋める。
 * Discogsを検索せず(APIを使わず)、MusicBrainz/Wikidata由来で既に紐づいているリンクをそのまま使う。
 * クレジットの取り込み(utils/creditImport.ts)が、クレジットされた人をカタログのアーティストと照合するために使う。
 *
 * 安全のため、次の組は飛ばす(誤って別人に付かないように):
 *   ・同じDiscogs IDのリンクが複数のアーティストに付いている(連名アーティスト行など、人物IDが混ざった行)
 *   ・名前に連名の記号(& , × / feat. with and)を含むアーティスト
 *   ・すでに discogs_artist_id が入っている行
 * 何度実行しても安全。
 *
 * 実行方法: npx tsx --env-file=.env.local scripts/backfill-discogs-ids-from-links.ts [--apply]
 */
import { createAdminClient } from '@/utils/Supabase/admin'

const APPLY = process.argv.includes('--apply')
const COMPOSITE = /[&＆,、×/]| feat\.?| with | and /i

async function main() {
  const supabase = createAdminClient()
  const links: { artist_id: string; id: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('artist_external_link').select('artist_id, url').eq('link_type', 'discogs').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const m = (r.url as string).match(/discogs\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/)
      if (m) links.push({ artist_id: r.artist_id as string, id: m[1] })
    }
    if ((data ?? []).length < 1000) break
  }
  const owners = new Map<string, Set<string>>()
  for (const l of links) (owners.get(l.id) ?? owners.set(l.id, new Set()).get(l.id)!).add(l.artist_id)
  const byArtist = new Map<string, Set<string>>()
  for (const l of links) (byArtist.get(l.artist_id) ?? byArtist.set(l.artist_id, new Set()).get(l.artist_id)!).add(l.id)

  const names = new Map<string, { name: string; has: string | null }>()
  const ids = Array.from(byArtist.keys())
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('artist').select('id, name, discogs_artist_id').in('id', ids.slice(i, i + 200))
    for (const a of data ?? []) names.set(a.id as string, { name: a.name as string, has: (a.discogs_artist_id as string | null) ?? null })
  }

  const todo: { artist_id: string; discogs: string }[] = []
  const skip = { shared: 0, multi: 0, composite: 0, already: 0 }
  for (const [artistId, set] of byArtist) {
    const a = names.get(artistId)
    if (!a) continue
    if (a.has) { skip.already++; continue }
    if (set.size !== 1) { skip.multi++; continue }
    const id = Array.from(set)[0]
    if ((owners.get(id)?.size ?? 0) !== 1) { skip.shared++; continue }
    if (COMPOSITE.test(a.name)) { skip.composite++; continue }
    todo.push({ artist_id: artistId, discogs: id })
  }
  console.log(`リンクのあるアーティスト ${byArtist.size} / 書き込み対象 ${todo.length} / 飛ばした ${JSON.stringify(skip)}`)
  if (!APPLY) return console.log('(--apply なし: 何も書いていません)')
  let done = 0
  for (const t of todo) {
    const { error } = await supabase.from('artist').update({ discogs_artist_id: t.discogs }).eq('id', t.artist_id).is('discogs_artist_id', null)
    if (error) console.error(t.artist_id, error.message)
    else done++
  }
  console.log(`=== 更新 ${done}件 ===`)
}

main().catch((e) => { console.error(e); process.exit(1) })
