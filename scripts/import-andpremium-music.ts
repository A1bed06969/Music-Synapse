// scripts/import-andpremium-music.ts
/**
 * 雑誌『&Premium』の連載「土曜の朝と日曜の夜の音楽」と、併設コーナー「土曜の夜と日曜の朝のジャズ」を、
 * キュレーション企画(ranking / ranking_entry)として登録する。曲単位の企画で、選曲者・曜日は metric_label に
 * 「選曲者 / 土曜の朝」の形で入れる。選曲日は period_date(月までのものは1日で補う)。
 *
 * 登録するのは、カタログに既にある「アーティスト(名前の完全一致・大文字小文字無視で1人に決まる)の、曲(正規化した曲名の完全一致)」だけ。
 * カタログに無いアーティスト・曲は、何も作らず(名前だけのスタブを作らない)、レポートに残す。
 * それらは、iTunesが空いてから prepare-curation-artists 相当の手順で登録してから、このスクリプトを再実行する(再実行しても安全)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-andpremium-music.ts <extract-andpremium-music.tsが出したJSON> [--apply]
 *   --apply なしは何も書かない(件数の確認だけ)。レポートは /private/tmp/andpremium-report.json
 */
import { readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'
import type { AndPremiumPick } from './extract-andpremium-music'

const APPLY = process.argv.includes('--apply')
const jsonPath = process.argv.slice(2).find((a) => !a.startsWith('--'))

const CORNERS = {
  music: {
    name: '土曜の朝と日曜の夜の音楽',
    description:
      '雑誌『&Premium』の連載。ミュージシャンや選曲家など毎回のゲストが、週末の「土曜の朝」と「日曜の夜」に聴きたい曲を選ぶ。2015年11月に始まり、2026年10月現在も続いている。',
  },
  jazz: {
    name: '土曜の夜と日曜の朝のジャズ',
    description: '雑誌『&Premium』の連載「土曜の朝と日曜の夜の音楽」と同じ枠で、2016年8月〜12月に掲載された、ジャズの小コーナー。ゲストが「土曜の夜」と「日曜の朝」に聴きたいジャズを選ぶ。',
  },
} as const
const SOURCE = '&Premium'
const SOURCE_URL = 'https://andpremium.jp/'

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/^the\s+/, '').replace(/[\s'’".,!?・&\-_/()[\]:]/g, '')
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

async function main() {
  if (!jsonPath) throw new Error('使い方: ... import-andpremium-music.ts <json> [--apply]')
  const picks: AndPremiumPick[] = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const supabase = createAdminClient()

  // 1) アーティスト: 名前(大文字小文字無視)で1人に決まる人だけ
  const names = Array.from(new Set(picks.map((p) => p.artist_name)))
  const artistId = new Map<string, string | 'ambiguous' | null>()
  for (const name of names) {
    const { data } = await supabase.from('artist').select('id, name').ilike('name', escapeLike(name)).limit(5)
    const exact = (data ?? []).filter((a) => norm(a.name as string) === norm(name))
    artistId.set(name, exact.length === 1 ? (exact[0].id as string) : exact.length === 0 ? null : 'ambiguous')
  }

  // 2) 曲: そのアーティストの曲のうち、正規化した曲名が完全一致するもの。複数あれば、最も古いアルバムのものを採る
  const trackCache = new Map<string, { id: string; title: string; release: string }[]>()
  async function tracksOf(aid: string) {
    const hit = trackCache.get(aid)
    if (hit) return hit
    const { data } = await supabase.from('track').select('id, title, album:album_id(release_date)').eq('artist_id', aid).limit(3000)
    const list = (data ?? []).map((t) => {
      const al = Array.isArray(t.album) ? t.album[0] : t.album
      return { id: t.id as string, title: t.title as string, release: ((al as { release_date?: string } | null)?.release_date ?? '9999') as string }
    })
    trackCache.set(aid, list)
    return list
  }

  const resolved: { pick: AndPremiumPick; artist_id: string; track_id: string; multi: boolean }[] = []
  const missing: { pick: AndPremiumPick; reason: string }[] = []
  for (const p of picks) {
    const aid = artistId.get(p.artist_name)
    if (!aid) { missing.push({ pick: p, reason: 'artist_not_in_catalog' }); continue }
    if (aid === 'ambiguous') { missing.push({ pick: p, reason: 'artist_ambiguous' }); continue }
    const cands = (await tracksOf(aid)).filter((t) => norm(t.title) === norm(p.track_title))
    if (cands.length === 0) { missing.push({ pick: p, reason: 'track_not_in_catalog' }); continue }
    cands.sort((a, b) => a.release.localeCompare(b.release))
    resolved.push({ pick: p, artist_id: aid, track_id: cands[0].id, multi: cands.length > 1 })
  }

  const byReason: Record<string, number> = {}
  for (const m of missing) byReason[m.reason] = (byReason[m.reason] ?? 0) + 1
  const perCorner = (c: string) => `${resolved.filter((r) => r.pick.corner === c).length}/${picks.filter((p) => p.corner === c).length}`
  console.log(`カタログで確定: 音楽 ${perCorner('music')} / ジャズ ${perCorner('jazz')}(同名の曲が複数あり最古のアルバムを採った分 ${resolved.filter((r) => r.multi).length})`)
  console.log('確定できなかった理由:', JSON.stringify(byReason))
  writeFileSync('/private/tmp/andpremium-report.json', JSON.stringify({ apply: APPLY, resolved: resolved.length, missing }, null, 1))
  if (!APPLY) {
    console.log('(--apply なし: 何も書いていません。レポート /private/tmp/andpremium-report.json)')
    return
  }

  // 3) メディア(雑誌)と企画
  let { data: media } = await supabase.from('media').select('id').eq('name', SOURCE).eq('media_type', 'magazine').maybeSingle()
  if (!media) {
    const { data, error } = await supabase.from('media').insert({ name: SOURCE, media_type: 'magazine', url: SOURCE_URL }).select('id').single()
    if (error) throw error
    media = data
  }
  const rankingId: Record<string, string> = {}
  for (const [corner, c] of Object.entries(CORNERS)) {
    const { data: ex } = await supabase.from('ranking').select('id').eq('name', c.name).eq('source', SOURCE).maybeSingle()
    if (ex) { rankingId[corner] = ex.id as string; continue }
    const { data, error } = await supabase
      .from('ranking')
      .insert({ media_id: media!.id, name: c.name, source: SOURCE, description: c.description, list_type: 'selection', source_url: SOURCE_URL, image_url: corner === 'music' ? '/images/curation/andpremium-logo.jpg' : null })
      .select('id')
      .single()
    if (error) throw error
    rankingId[corner] = data.id as string
  }

  // 4) 選曲(再実行しても二重に入れない: 企画・曲・日付・選曲者/曜日が同じものは飛ばす)
  let inserted = 0, skipped = 0
  for (const corner of ['music', 'jazz'] as const) {
    const { data: ex } = await supabase.from('ranking_entry').select('track_id, period_date, metric_label').eq('ranking_id', rankingId[corner]).limit(100000)
    const seen = new Set((ex ?? []).map((e) => `${e.track_id}|${e.period_date}|${e.metric_label}`))
    const rows = resolved
      .filter((r) => r.pick.corner === corner)
      .map((r) => ({
        ranking_id: rankingId[corner], artist_id: r.artist_id, track_id: r.track_id, period_date: r.pick.picked_date,
        metric_label: [r.pick.curator, r.pick.weekday_slot].filter(Boolean).join(' / '),
      }))
      .filter((r) => {
        const k = `${r.track_id}|${r.period_date}|${r.metric_label}`
        if (seen.has(k)) { skipped++; return false }
        seen.add(k)
        return true
      })
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('ranking_entry').insert(rows.slice(i, i + 200))
      if (error) throw error
    }
    inserted += rows.length
  }
  console.log(`=== 登録 ${inserted}件 / 既存で飛ばした ${skipped}件 ===`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
