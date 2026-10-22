// scripts/import-wikidata-memberships.ts
/**
 * Wikidata から、バンド・グループのメンバー(在籍関係)を取り込む。
 * カタログのアーティストのうち、Wikidata の ID(artist_external_link の link_type='wikidata')を持つ人だけが対象で、
 *   ・「メンバー」(P527: グループ → 人)と「所属」(P463: 人 → グループ)の両方向を読み、
 *   ・グループと人の「両方」がカタログにある組だけを artist_relation(relation_type='membership')に入れる。
 * どちらかがカタログに無い組は、名前だけのアーティストを作らずに飛ばす(スタブを増やさない)。
 * artist_relation は a = メンバー(人)、b = グループ、description = 在籍期間(例「2004–2012」「2020–」)。
 * LLM・iTunes は使わない。何度実行しても安全(同じ組は追加しない)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-wikidata-memberships.ts [--apply] [--limit=N]
 *   --apply なしは何も書かない(件数の確認だけ)。レポートは /private/tmp/wikidata-memberships.json
 */
import { writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'

const APPLY = process.argv.includes('--apply')
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0)
const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse; personal research)'
const CHUNK = 120
const GAP_MS = 1600

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = { band: string; member: string; start: string | null; end: string | null }

async function sparql(query: string): Promise<{ band: { value: string }; member: { value: string }; start?: { value: string }; end?: { value: string } }[]> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } })
      if (res.ok) return (await res.json()).results.bindings
      if (res.status === 429 || res.status >= 500) {
        await sleep(6000 * attempt)
        continue
      }
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (attempt === 5) throw e
      await sleep(4000 * attempt)
    }
  }
  return []
}

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1)
const yearOf = (s?: { value: string }) => (s ? s.value.slice(0, 4) : null)

async function main() {
  const supabase = createAdminClient()

  // カタログの Wikidata ID → アーティスト
  const qidToArtist = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('artist_external_link').select('artist_id, url').eq('link_type', 'wikidata').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const m = (r.url as string).match(/\/(Q\d+)$/)
      if (m) qidToArtist.set(m[1], r.artist_id as string)
    }
    if ((data ?? []).length < 1000) break
  }
  const qids = Array.from(qidToArtist.keys())
  console.log(`Wikidata IDを持つアーティスト: ${qids.length}`)
  const targets = LIMIT ? qids.slice(0, LIMIT) : qids

  const pairs = new Map<string, Row>()
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK)
    const values = chunk.map((q) => `wd:${q}`).join(' ')
    const query = `SELECT ?band ?member ?start ?end WHERE {
  VALUES ?band { ${values} }
  { ?band p:P527 ?st . ?st ps:P527 ?member . } UNION { ?member p:P463 ?st . ?st ps:P463 ?band . }
  OPTIONAL { ?st pq:P580 ?start . }
  OPTIONAL { ?st pq:P582 ?end . }
}`
    const rows = await sparql(query)
    for (const r of rows) {
      const band = qidOf(r.band.value)
      const member = qidOf(r.member.value)
      if (band === member) continue
      const key = `${member}|${band}`
      const prev = pairs.get(key)
      const start = yearOf(r.start)
      const end = yearOf(r.end)
      // 同じ組が複数の期間で出てきたら、最も早い開始と最も遅い終了にまとめる(終了が無い期間があれば現役扱い)
      if (!prev) pairs.set(key, { band, member, start, end })
      else {
        if (start && (!prev.start || start < prev.start)) prev.start = start
        if (!end || !prev.end) prev.end = null
        else if (end > prev.end) prev.end = end
      }
    }
    if ((i / CHUNK) % 10 === 0) console.log(`${Math.min(i + CHUNK, targets.length)}/${targets.length} 組 ${pairs.size}`)
    await sleep(GAP_MS)
  }

  // 両方がカタログにある組だけ
  const inCatalog = Array.from(pairs.values()).filter((p) => qidToArtist.has(p.member) && qidToArtist.has(p.band))
  console.log(`Wikidata上の在籍関係 ${pairs.size} 組のうち、両方がカタログにある組: ${inCatalog.length}`)

  // 既存(向きが逆のものも含む)を飛ばす
  const existing = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('artist_relation').select('artist_id_a, artist_id_b, relation_type').eq('relation_type', 'membership').range(from, from + 999)
    for (const r of data ?? []) {
      existing.add(`${r.artist_id_a}|${r.artist_id_b}`)
      existing.add(`${r.artist_id_b}|${r.artist_id_a}`)
    }
    if ((data ?? []).length < 1000) break
  }
  const rows = inCatalog
    .map((p) => ({
      artist_id_a: qidToArtist.get(p.member)!,
      artist_id_b: qidToArtist.get(p.band)!,
      relation_type: 'membership',
      relation_style: 'solid',
      description: p.start || p.end ? `在籍 ${p.start ?? ''}–${p.end ?? ''}` : '在籍',
    }))
    .filter((r) => r.artist_id_a !== r.artist_id_b && !existing.has(`${r.artist_id_a}|${r.artist_id_b}`))
  console.log(`新しく入れる組: ${rows.length}`)
  writeFileSync('/private/tmp/wikidata-memberships.json', JSON.stringify({ apply: APPLY, wikidataPairs: pairs.size, inCatalog: inCatalog.length, newRows: rows.length, sample: rows.slice(0, 20) }, null, 1))

  if (!APPLY) {
    console.log('(--apply なし: 何も書いていません)')
    return
  }
  let done = 0
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('artist_relation').upsert(rows.slice(i, i + 200), { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    done += Math.min(200, rows.length - i)
  }
  console.log(`=== 登録 ${done}件 ===`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
