/**
 * 出身地未設定アーティストのorigin_country_codeを、MusicBrainzのartist.country
 * (ISO 3166-1)から直接埋める一括バッチ。
 *
 * 既存のscripts/backfill-artist-origin-geo-codes.tsはorigin_latitude/longitudeが
 * 既に設定済みのアーティスト(全体の14%程度、admin画面の手動ジオ検索でのみ増える)
 * を対象にした逆ジオコーディングで、出身地不明なアーティストの新規解決はできない。
 * 一方、artistの55%は既にmusicbrainz_idを持っており、MusicBrainzのartist
 * ルックアップ自体がISO国コードを直接返すため、ジオコーディング無しで国レベルの
 * 出身地を大量に埋められる(市区町村/州地域レベルはMusicBrainzのarea階層だけでは
 * 精度が足りないため対象外、地図の国ブロック表示フォールバックには十分)。
 *
 * このスクリプトはorigin_country_codeのみを設定する。地図の境界ポリゴン
 * キャッシュ(geo_boundary)は、既存スクリプトの補修パス(repairMissingBoundaries)が
 * 拾ってくれるので、このスクリプトの後にscripts/backfill-artist-origin-geo-codes.ts
 * を再実行すること(メインループの対象は0件になるが、補修パスは動く)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-artist-origin-from-musicbrainz.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistOrigin } from '@/utils/musicbrainz'

type ArtistRow = { id: string; name: string; musicbrainz_id: string }

/** PostgRESTの1000行制限を.range()でページネーションして回避する
 * (このプロジェクトで繰り返し踏んでいるバグ。utils/fetchAllRows.tsのdoc
 * comment参照)。 */
async function fetchCandidates(supabase: ReturnType<typeof createAdminClient>): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, musicbrainz_id')
      .not('musicbrainz_id', 'is', null)
      .is('origin_country_code', null)
      .is('origin_latitude', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function main() {
  const supabase = createAdminClient()

  let rows: ArtistRow[]
  try {
    rows = await fetchCandidates(supabase)
  } catch (error) {
    console.error('アーティスト取得に失敗しました:', error instanceof Error ? error.message : error)
    process.exit(1)
    return
  }

  console.log(`対象: ${rows.length}件`)

  let resolved = 0
  let noCountry = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const artist = rows[i]
    try {
      const origin = await fetchArtistOrigin(artist.musicbrainz_id)
      if (!origin.countryCode) {
        noCountry++
      } else {
        const { error: updateError } = await supabase
          .from('artist')
          .update({ origin_country_code: origin.countryCode })
          .eq('id', artist.id)
        if (updateError) {
          console.error(`FAIL(更新失敗): "${artist.name}": ${updateError.message}`)
          failed++
        } else {
          resolved++
        }
      }
    } catch (err) {
      console.error(`ERROR: "${artist.name}" の処理中にエラー:`, err instanceof Error ? err.message : err)
      failed++
    }

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`--- 進捗 ${i + 1}/${rows.length}: resolved=${resolved}, noCountry=${noCountry}, failed=${failed} ---`)
    }
  }

  console.log(`=== 完了: resolved=${resolved}, noCountry=${noCountry}, failed=${failed} (対象${rows.length}件) ===`)
  console.log('次に scripts/backfill-artist-origin-geo-codes.ts を再実行して境界ポリゴンキャッシュを補修してください。')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
