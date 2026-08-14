/**
 * preview_urlが未設定の既存トラックに、iTunes Lookup APIのバッチ取得
 * (id=をカンマ区切りで複数渡す)でpreviewUrlを一括バックフィルする。
 * アーティスト単位で全アルバム・トラックを再取込みする既存のiTunesバルク登録
 * フローに比べ、トラックIDだけを直接まとめて引けるため大幅に高速。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-track-preview-url.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const BATCH_SIZE = 150
const REQUEST_INTERVAL_MS = 800

type TrackRow = { id: string; apple_music_track_id: string }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// PostgRESTの1回のクエリ上限(1000件)を超えるため、range()でページングして全件取得する
async function fetchEligibleTracks(supabase: SupabaseClient): Promise<TrackRow[]> {
  const pageSize = 1000
  const rows: TrackRow[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('track')
      .select('id, apple_music_track_id')
      .not('apple_music_track_id', 'is', null)
      .is('preview_url', null)
      .range(offset, offset + pageSize - 1)
    if (!data || data.length === 0) break
    rows.push(...(data as TrackRow[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function fetchPreviewUrlsBatch(appleMusicTrackIds: string[]): Promise<Map<string, string>> {
  const url = `https://itunes.apple.com/lookup?id=${appleMusicTrackIds.join(',')}&country=JP`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    throw new Error(`iTunes API error: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  const map = new Map<string, string>()
  for (const r of data.results ?? []) {
    if (r.wrapperType === 'track' && r.trackId != null && r.previewUrl) {
      map.set(String(r.trackId), r.previewUrl as string)
    }
  }
  return map
}

async function main() {
  const supabase = createAdminClient()

  const tracks = await fetchEligibleTracks(supabase)
  if (tracks.length === 0) {
    console.log('対象のトラックはいません。')
    return
  }

  const internalIdByAppleId = new Map<string, string>()
  for (const t of tracks) internalIdByAppleId.set(t.apple_music_track_id, t.id)

  const batches = chunk(
    tracks.map((t) => t.apple_music_track_id),
    BATCH_SIZE
  )

  console.log(`対象: ${tracks.length}件 / ${batches.length}バッチ(${BATCH_SIZE}件ずつ)\n`)

  let updated = 0
  let notFound = 0
  let failedBatches = 0

  for (const [index, batchIds] of batches.entries()) {
    console.log(`[${index + 1}/${batches.length}] ${batchIds.length}件取得中...`)

    try {
      const previewMap = await fetchPreviewUrlsBatch(batchIds)

      const updates: { id: string; preview_url: string }[] = []
      for (const appleId of batchIds) {
        const previewUrl = previewMap.get(appleId)
        const internalId = internalIdByAppleId.get(appleId)
        if (previewUrl && internalId) {
          updates.push({ id: internalId, preview_url: previewUrl })
        } else {
          notFound++
        }
      }

      if (updates.length > 0) {
        const results = await Promise.all(
          updates.map((u) => supabase.from('track').update({ preview_url: u.preview_url }).eq('id', u.id))
        )
        const failedUpdates = results.filter((r) => r.error).length
        updated += updates.length - failedUpdates
        if (failedUpdates > 0) {
          console.log(`  ⚠️ DB更新失敗: ${failedUpdates}件`)
        }
      }
      console.log(`  ✅ ${updates.length}件登録`)
    } catch (err) {
      console.log(`  ❌ バッチ取得失敗: ${(err as Error).message}`)
      failedBatches++
    }

    if (index < batches.length - 1) {
      await sleep(REQUEST_INTERVAL_MS)
    }
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`登録成功: ${updated}/${tracks.length}件`)
  console.log(`previewUrlなし/未ヒット: ${notFound}件`)
  console.log(`失敗バッチ: ${failedBatches}/${batches.length}`)
}

main()
