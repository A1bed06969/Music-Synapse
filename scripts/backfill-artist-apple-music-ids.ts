// アーティスト単体のApple Music ID未紐付け(3097件)を、iTunes Artist Searchの
// 完全一致(かつ候補が1件のみ)という保守的な条件でのみ自動紐付けする一括バッチ。
// 過検出より過小検出を優先する(あいまいな場合は自動リンクせず手動レビューに残す)。
// 既存のitunes-mergeページ(1件ずつの手動統合UI)と同じロジック(重複紐付け防止・
// 既存行のUPDATEのみで新規行は作らない・dispatchAlbumSyncでアルバム/トラックを
// バックグラウンド同期)をバッチ実行できるようにしたもの。
//
// 実行: npx tsx scripts/backfill-artist-apple-music-ids.ts
// (ローカルのnext devサーバーが起動している必要がある。dispatchAlbumSyncが
// localhost:3000のAPIルートへ実際にfetchするため)

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { searchArtist, fetchArtistWithAlbums } from '../utils/itunes'
import { dispatchAlbumSync } from '../utils/albumSyncDispatch'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const LOG_PATH = path.join(
  '/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad',
  'apple-music-backfill.log'
)

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_PATH, line + '\n')
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function fetchCandidates(): Promise<{ id: string; name: string; official_site_url: string | null }[]> {
  const rows: { id: string; name: string; official_site_url: string | null }[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, official_site_url')
      .is('apple_music_artist_id', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function main() {
  const candidates = await fetchCandidates()
  log(`=== 開始: 対象${candidates.length}件 ===`)

  let matched = 0
  let ambiguous = 0
  let noMatch = 0
  let conflict = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i++) {
    const { id, name, official_site_url } = candidates[i]
    try {
      const results = await searchArtist(name)
      const normTarget = normalize(name)
      const exactMatches = results.filter((r) => normalize(r.artistName) === normTarget)

      if (exactMatches.length !== 1) {
        if (exactMatches.length === 0) noMatch++
        else ambiguous++
        continue
      }

      const candidateArtist = exactMatches[0]
      const appleId = String(candidateArtist.artistId)

      const { data: owner } = await supabase
        .from('artist')
        .select('id, name')
        .eq('apple_music_artist_id', appleId)
        .neq('id', id)
        .maybeSingle()

      if (owner) {
        conflict++
        log(`SKIP(重複): "${name}"(${id}) -> appleId ${appleId} は既に "${owner.name}" に紐付け済み`)
        continue
      }

      const { error: updateError } = await supabase
        .from('artist')
        .update({
          apple_music_artist_id: appleId,
          official_site_url: official_site_url ?? candidateArtist.artistLinkUrl ?? null,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (updateError) {
        failed++
        log(`FAIL(更新失敗): "${name}"(${id}): ${updateError.message}`)
        continue
      }

      matched++
      log(`MATCHED: "${name}"(${id}) -> "${candidateArtist.artistName}"(appleId=${appleId})`)

      try {
        const { albums } = await fetchArtistWithAlbums(appleId)
        await dispatchAlbumSync(id, name, appleId, albums)
      } catch (err) {
        log(`WARN: "${name}" のアルバム同期ディスパッチに失敗: ${err instanceof Error ? err.message : err}`)
      }
    } catch (err) {
      failed++
      log(`ERROR: "${name}"(${id}) の処理中にエラー: ${err instanceof Error ? err.message : err}`)
    }

    if ((i + 1) % 50 === 0 || i === candidates.length - 1) {
      log(
        `--- 進捗 ${i + 1}/${candidates.length}: matched=${matched}, ambiguous=${ambiguous}, noMatch=${noMatch}, conflict=${conflict}, failed=${failed} ---`
      )
    }
  }

  log(
    `=== 完了: matched=${matched}, ambiguous=${ambiguous}, noMatch=${noMatch}, conflict=${conflict}, failed=${failed} (対象${candidates.length}件) ===`
  )
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : err}`)
  process.exit(1)
})
