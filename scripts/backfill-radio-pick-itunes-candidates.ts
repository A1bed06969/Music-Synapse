// scripts/backfill-radio-pick-itunes-candidates.ts
/**
 * radio_airplay_pick の各行(artist_name + track_title)についてApple Musicを
 * 検索し、上位1件を「候補」として記録する。自動での本紐付け(artist/track本体との
 * リンク)は行わない — 件数が多く誤マッチのリスクがあるため、後で人力確認する前提の
 * 参考情報として保持するのみ。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-radio-pick-itunes-candidates.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks } from '@/utils/itunes'
import { fetchAllRows } from '@/utils/fetchAllRows'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// iTunes側の(非公式・undocumentedな)IPレート制限は、fetchItunes内の
// 400ms間隔だけでは足りず、数百件を連続で叩き続けると403/429が数分間
// ブロックされる形で発生することを確認済み(utils/itunes.tsのコメント参照)。
// 403/429を検知したら、次の1件に進む前にクールダウンを挟んで自己回復させる。
const RATE_LIMIT_COOLDOWN_MS = 60_000

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('403') || message.includes('429')
}

async function main() {
  const supabase = createAdminClient()

  type Row = { id: string; artist_name: string | null; track_title: string | null; candidate_track_id: number | null }
  const allRows = await fetchAllRows<Row>(
    supabase,
    'radio_airplay_pick',
    'id, artist_name, track_title, candidate_track_id',
    'id'
  )
  const rows = allRows.filter((r) => r.candidate_track_id === null && r.artist_name && r.track_title)

  if (rows.length === 0) {
    console.log('対象のレコードはありません。')
    return
  }

  console.log(`対象: ${rows.length}件\n`)

  let done = 0
  let matched = 0
  for (const row of rows) {
    done++
    try {
      const results = await searchTracks(`${row.artist_name} ${row.track_title}`, 1)
      const top = results[0]
      if (top) {
        const { error: updateError } = await supabase
          .from('radio_airplay_pick')
          .update({
            candidate_track_id: top.trackId,
            candidate_track_name: top.trackName,
            candidate_artist_name: top.artistName,
            candidate_collection_id: top.collectionId,
            candidate_collection_name: top.collectionName,
            candidate_artwork_url: top.artworkUrl100 ?? null,
          })
          .eq('id', row.id)
        if (updateError) {
          console.error(`[${done}/${rows.length}] ${row.id}: 更新失敗 - ${updateError.message}`)
        } else {
          matched++
          console.log(`[${done}/${rows.length}] ${row.id}: ${row.artist_name} / ${row.track_title} -> ${top.artistName} / ${top.trackName}`)
        }
      } else {
        console.log(`[${done}/${rows.length}] ${row.id}: ${row.artist_name} / ${row.track_title} -> 候補なし`)
      }
    } catch (err) {
      console.error(`[${done}/${rows.length}] ${row.id}: 検索失敗 - ${(err as Error).message}`)
      if (isRateLimitError(err)) {
        console.log(`レート制限を検知、${RATE_LIMIT_COOLDOWN_MS / 1000}秒クールダウンします...`)
        await sleep(RATE_LIMIT_COOLDOWN_MS)
      }
    }
  }

  console.log(`\n完了: ${done}件処理、${matched}件に候補を付与。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
