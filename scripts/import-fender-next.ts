// Fender NEXT(2019〜2026年、計210組)の選出アーティストをカタログに取り込む。
// ユーザー提供のスプレッドシートをCSVエクスポートしたもの(年度・アーティスト名・
// 国名の3列)を読み込み、既存artistと名前完全一致すればそれにリンク、
// 一致しなければ新規artist行(nameのみ)を作成してリンクする。
// 既存のranking/ranking_entryスキーマ(タワレコメン等の「キュレーションコンテンツ」
// と同じ枠組み、list_type='selection')にそのまま乗せる形にしていて、専用テーブルは
// 持たない。「ranking.name = 'Fender NEXT'」の行を無ければ作成し(あれば再利用)、
// ranking_entryへ(ranking_id, artist_id, period_date)の組が無いものだけ挿入する
// (再実行しても安全)。period_dateは年の代表として`{year}-01-01`を使う
// (import-towerecomen.tsと同じ考え方)。
//
// 実行: npx tsx scripts/import-fender-next.ts <csvのパス>

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const RANKING_NAME = 'Fender NEXT'
const RANKING_SOURCE = 'Fender'
const RANKING_DESCRIPTION =
  'Fenderが毎年発表する、次世代を担うアーティストの育成プログラム。2019年開始、年ごとにグローバルなアーティストを選出。'

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// 簡易CSVパーサ。ダブルクォート囲み+カンマ含有フィールド("nothing,nowhere"等)に対応。
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

/** 全アーティストの正規化名 -> idマップを1回だけ構築する(210件それぞれに
 * 曖昧なilike検索をかけるより、全件を一度読み込んでJS側で完全一致させる方が
 * 確実で速い)。 */
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

async function findOrCreateFenderNextRanking(): Promise<string> {
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
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('使い方: npx tsx scripts/import-fender-next.ts <csvのパス>')
    process.exit(1)
  }

  const raw = fs.readFileSync(csvPath, 'utf-8')
  const allRows = parseCsv(raw)
  // 先頭の空行+ヘッダー行(年度,アーティスト名,国名)を飛ばす
  const dataRows = allRows.filter((r) => r.length >= 3 && /^\d{4}$/.test(r[0].trim()))
  const rows: Row[] = dataRows.map((r) => ({ year: parseInt(r[0].trim(), 10), name: r[1].trim() }))

  console.log(`対象: ${rows.length}件`)

  const rankingId = await findOrCreateFenderNextRanking()
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
