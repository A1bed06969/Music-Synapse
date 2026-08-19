// scripts/backfill-artist-origin-geo-codes.ts
/**
 * アーティスト出身地マップの塗りつぶし表示のための下準備。
 * origin_latitude/longitudeが登録済みでorigin_country_codeが未設定のアーティストに
 * ついて、Nominatimで国コード・州地域コード(ISO3166-2)を、日本国内なら国土地理院APIで
 * 市区町村コードも解決してartistテーブルに保存する。同時に、該当する市区町村/州地域の
 * 境界ポリゴンをgeo_boundaryにキャッシュする。
 *
 * Nominatim/GSIともに利用ポリシーに配慮し、リクエスト間隔を1秒空ける。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-artist-origin-geo-codes.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchCountryAndRegion, fetchMuniCode } from '@/utils/originGeoResolve'
import {
  getOrFetchMunicipalityBoundary,
  getOrFetchRegionBoundary,
  fetchNaturalEarthAdmin1Features,
  type NaturalEarthAdmin1Feature,
} from '@/utils/geoBoundaryCache'

const REQUEST_INTERVAL_MS = 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ArtistRow = { id: string; name: string; origin_latitude: number; origin_longitude: number }

async function resolveJapaneseArtist(
  supabase: ReturnType<typeof createAdminClient>,
  artist: ArtistRow,
  countryCode: string
) {
  const muniCode = await fetchMuniCode(artist.origin_latitude, artist.origin_longitude)
  await sleep(REQUEST_INTERVAL_MS)

  await supabase.from('artist').update({ origin_country_code: countryCode, origin_muni_code: muniCode }).eq('id', artist.id)

  if (!muniCode) {
    console.log('  日本 / 市区町村コード取得できず')
    return
  }
  const boundary = await getOrFetchMunicipalityBoundary(supabase, muniCode)
  console.log(`  日本 / muniCd=${muniCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
}

async function resolveOtherArtist(
  supabase: ReturnType<typeof createAdminClient>,
  artist: ArtistRow,
  countryCode: string,
  regionCode: string | null,
  admin1Features: NaturalEarthAdmin1Feature[]
) {
  await supabase.from('artist').update({ origin_country_code: countryCode, origin_region_code: regionCode }).eq('id', artist.id)

  if (!regionCode) {
    console.log(`  ${countryCode} / 州地域コード無し(国ブロック表示にフォールバック)`)
    return
  }
  const boundary = await getOrFetchRegionBoundary(supabase, regionCode, admin1Features)
  console.log(`  ${countryCode} / region=${regionCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
}

async function main() {
  const supabase = createAdminClient()

  const { data: artists, error } = await supabase
    .from('artist')
    .select('id, name, origin_latitude, origin_longitude')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)
    .is('origin_country_code', null)

  if (error) {
    console.error('アーティスト取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows = (artists ?? []) as ArtistRow[]
  if (rows.length === 0) {
    console.log('対象のアーティストはいません。')
    return
  }
  console.log(`対象: ${rows.length}件\n`)

  console.log('Natural Earthの州・地域データを取得中(約40MB、数十秒かかります)...')
  const admin1Features = await fetchNaturalEarthAdmin1Features()
  console.log(`取得完了: ${admin1Features.length}件\n`)

  for (const [index, artist] of rows.entries()) {
    console.log(`[${index + 1}/${rows.length}] ${artist.name}`)
    try {
      const { countryCode, regionCode } = await fetchCountryAndRegion(artist.origin_latitude, artist.origin_longitude)
      await sleep(REQUEST_INTERVAL_MS)

      if (!countryCode) {
        console.log('  国コードを取得できませんでした')
        continue
      }

      if (countryCode === 'jp') {
        await resolveJapaneseArtist(supabase, artist, countryCode)
      } else {
        await resolveOtherArtist(supabase, artist, countryCode, regionCode, admin1Features)
      }
    } catch (err) {
      console.error(`  失敗: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log('\nDONE')
}

main()
