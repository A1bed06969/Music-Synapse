// Rolling Stone Japan「Future of Music」日本代表(2024〜2026年、計75組)を
// カタログに取り込む。2024年分は日本代表25組発表記事(第1回)からの手拾い、
// 2025・2026年分はユーザー提供のスプレッドシートを元にしたCSV(年度・
// アーティスト名の2列)。既存artistと名前完全一致すればそれにリンク、一致
// しなければ新規artist行(nameのみ)を作成してリンクする。
// scripts/import-fender-next.tsと同じ構造(ranking/ranking_entryスキーマ、
// list_type='selection'、period_dateは`{year}-01-01`、再実行しても安全)。
//
// 米国版(Rolling Stone US「Future 25」、2023〜2026年)も同じスクリプトで、別の企画として取り込める
// (--edition=us)。日本版は既定(--edition 省略)。
//
// 実行: npx tsx --env-file=.env.local scripts/import-future-of-music.ts <csvのパス> [--edition=jp|us]

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const EDITIONS = {
  jp: {
    name: 'Future of Music',
    source: 'Rolling Stone Japan',
    description:
      'Rolling Stone誌のグローバル連動企画「Future of Music」の日本版。世界各国のRolling Stone誌が次世代を担うアーティストを選出する中、日本版が独自にピックアップした「日本代表」25組を毎年紹介する。2024年開始。',
  },
  us: {
    name: 'Future of Music (Rolling Stone US)',
    source: 'Rolling Stone',
    description:
      'Rolling Stone誌(米国版)の企画「Future of Music」の「Future 25」。毎年、次世代を担う世界のアーティスト25組を、ジャンル・国を問わず選出する(2023年は「Meet Music\'s Future 25」)。2023年開始。',
  },
} as const
const edition = (process.argv.find((a) => a.startsWith('--edition=')) ?? '--edition=jp').replace('--edition=', '') as keyof typeof EDITIONS
if (!(edition in EDITIONS)) {
  console.error('--edition は jp か us を指定してください。')
  process.exit(1)
}
const RANKING_NAME = EDITIONS[edition].name
const RANKING_SOURCE = EDITIONS[edition].source
const RANKING_DESCRIPTION = EDITIONS[edition].description

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// 簡易CSVパーサ。ダブルクォート囲み+カンマ含有フィールドに対応。
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // skip
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

type Row = { year: number; name: string }

/** 全アーティストの正規化名 -> idマップを1回だけ構築する。 */
async function buildArtistNameIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase.from('artist').select('id, name').range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    for (const row of page) {
      index.set(normalize(row.name), row.id)
    }
    if (page.length < pageSize) break
    offset += pageSize
  }
  return index
}

async function findOrCreateRanking(): Promise<string> {
  const { data: existing, error: findError } = await supabase.from('ranking').select('id').eq('name', RANKING_NAME).maybeSingle()
  if (findError) throw findError
  if (existing) return existing.id

  const { data: created, error: createError } = await supabase
    .from('ranking')
    .insert({ name: RANKING_NAME, source: RANKING_SOURCE, description: RANKING_DESCRIPTION, list_type: 'selection' })
    .select('id')
    .single()
  if (createError || !created) throw createError ?? new Error('ranking insert returned no row')
  return created.id
}

/** 既存ranking_entryの(artist_id, period_date)組の集合。再実行時の重複挿入を防ぐ。 */
async function fetchExistingEntryKeys(rankingId: string): Promise<Set<string>> {
  const keys = new Set<string>()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('ranking_entry')
      .select('artist_id, period_date')
      .eq('ranking_id', rankingId)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    for (const row of page) {
      keys.add(`${row.artist_id}:${row.period_date}`)
    }
    if (page.length < pageSize) break
    offset += pageSize
  }
  return keys
}

async function main() {
  const csvPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
  if (!csvPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-future-of-music.ts <csvのパス> [--edition=jp|us]')
    process.exit(1)
  }

  const raw = fs.readFileSync(csvPath, 'utf-8')
  const allRows = parseCsv(raw)
  // 先頭のヘッダー行(年度,アーティスト名)を飛ばす
  const dataRows = allRows.filter((r) => r.length >= 2 && /^\d{4}$/.test(r[0].trim()))
  const rows: Row[] = dataRows.map((r) => ({ year: parseInt(r[0].trim(), 10), name: r[1].trim() }))

  console.log(`対象: ${rows.length}件`)

  const rankingId = await findOrCreateRanking()
  console.log(`ranking: ${RANKING_NAME} (${rankingId})`)

  const artistIndex = await buildArtistNameIndex()
  const existingEntryKeys = await fetchExistingEntryKeys(rankingId)
  console.log(`既存アーティスト索引: ${artistIndex.size}件, 登録済みentry: ${existingEntryKeys.size}件`)

  let createdArtists = 0
  let matchedArtists = 0
  let insertedEntries = 0
  let skippedExisting = 0
  let failed = 0

  for (const row of rows) {
    try {
      const normTarget = normalize(row.name)
      const existingId = artistIndex.get(normTarget)

      let artistId: string

      if (existingId) {
        artistId = existingId
        matchedArtists++
      } else {
        const { data: created, error: createError } = await supabase
          .from('artist')
          .insert({ name: row.name })
          .select('id')
          .single()
        if (createError || !created) throw createError ?? new Error('artist insert returned no row')
        artistId = created.id
        artistIndex.set(normTarget, artistId)
        createdArtists++
        console.log(`CREATED: "${row.name}" -> ${artistId}`)
      }

      const periodDate = `${row.year}-01-01`
      const entryKey = `${artistId}:${periodDate}`
      if (existingEntryKeys.has(entryKey)) {
        skippedExisting++
        continue
      }

      const { error: insertError } = await supabase
        .from('ranking_entry')
        .insert({ ranking_id: rankingId, period_date: periodDate, artist_id: artistId })

      if (insertError) throw insertError
      existingEntryKeys.add(entryKey)
      insertedEntries++
    } catch (err) {
      failed++
      console.error(`ERROR: "${row.name}"(${row.year}) の処理中にエラー:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(
    `=== 完了: matched=${matchedArtists}, created=${createdArtists}, inserted=${insertedEntries}, skipped=${skippedExisting}, failed=${failed} (対象${rows.length}件) ===`
  )
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
