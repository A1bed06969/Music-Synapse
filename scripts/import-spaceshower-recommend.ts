// scripts/import-spaceshower-recommend.ts
/**
 * extract-spaceshower-recommend.ts が書き出した、スペースシャワーTV公式サイトの
 * 選曲JSON(POWER PUSH / POWER PUSH INTERNATIONAL / Waves! / It!)を radio_airplay_pick へ反映する。
 *
 * - 既に同じ月・同じアーティスト・同じ曲がある行(HR/PPシート由来)は、新しく入れずに
 *   企画名だけ公式サイトの表記へ直す(シートでは POWER PUSH と INTERNATIONAL が1つの
 *   「POWER PUSH」にまとまっていた)
 * - 無い行だけを追加する
 * 表記ゆれ(「」・括弧書き・記号・長音・大文字小文字)をならして同じ曲かを判定する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-spaceshower-recommend.ts <JSONのパス> [--dry-run]
 */
import { readFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'

type Pick = {
  region: string
  station_name: string
  campaign_name: string | null
  picked_date: string
  artist_name: string | null
  track_title: string | null
  is_domestic: boolean | null
}

type DbRow = { id: string; campaign_name: string | null; picked_date: string; artist_name: string | null; track_title: string | null; is_domestic: boolean | null }

function norm(v: string | null): string {
  return String(v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[(（][^)）]*[)）]/g, '') // 括弧書き((album version)・（Dirty Ver.）など)
    .replace(/[「」『』"'’‘`“”]/g, '')
    .replace(/[\s.・&,!?\-~〜～ー_/\\:;]/g, '')
}

const contains = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))

async function main() {
  const jsonPath = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')
  if (!jsonPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-spaceshower-recommend.ts <JSONのパス> [--dry-run]')
    process.exit(1)
  }
  const picks: Pick[] = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const supabase = createAdminClient()

  const existing: DbRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('radio_airplay_pick')
      .select('id, campaign_name, picked_date, artist_name, track_title, is_domestic')
      .eq('region', 'TV')
      .eq('station_name', 'スペースシャワーTV')
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    existing.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const byMonth = new Map<string, DbRow[]>()
  for (const r of existing) {
    const m = r.picked_date.slice(0, 7)
    byMonth.set(m, [...(byMonth.get(m) ?? []), r])
  }

  const toInsert: Pick[] = []
  const toRecampaign: { id: string; campaign: string | null; domestic: boolean | null }[] = []
  const claimed = new Set<string>()
  let alreadySame = 0
  for (const p of picks) {
    const a = norm(p.artist_name)
    const t = norm(p.track_title)
    const candidates = byMonth.get(p.picked_date.slice(0, 7)) ?? []
    const hit = candidates.find((r) => !claimed.has(r.id) && contains(norm(r.artist_name), a) && contains(norm(r.track_title), t))
    if (!hit) {
      toInsert.push(p)
      continue
    }
    claimed.add(hit.id)
    if (hit.campaign_name === p.campaign_name && (p.is_domestic === null || hit.is_domestic === p.is_domestic)) {
      alreadySame++
    } else {
      toRecampaign.push({ id: hit.id, campaign: p.campaign_name, domestic: p.is_domestic })
    }
  }

  const by = new Map<string, number>()
  for (const p of toInsert) by.set(p.campaign_name ?? '', (by.get(p.campaign_name ?? '') ?? 0) + 1)
  console.log(`サイト ${picks.length}件 / 既存TV(スペシャ) ${existing.length}件`)
  console.log(`  同じ内容で登録済み ${alreadySame}件 / 企画名を直す ${toRecampaign.length}件 / 新規追加 ${toInsert.length}件`)
  for (const [k, n] of by) console.log(`    新規: ${k} ${n}件`)
  if (dryRun) {
    console.log('(dry-run)')
    return
  }

  for (const r of toRecampaign) {
    const patch: Record<string, unknown> = { campaign_name: r.campaign }
    if (r.domestic !== null) patch.is_domestic = r.domestic
    const { error } = await supabase.from('radio_airplay_pick').update(patch).eq('id', r.id)
    if (error) throw new Error(`企画名の更新に失敗: ${error.message}`)
  }
  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase.from('radio_airplay_pick').insert(toInsert.slice(i, i + 500))
    if (error) throw new Error(`追加に失敗: ${error.message}`)
  }
  console.log('完了')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
