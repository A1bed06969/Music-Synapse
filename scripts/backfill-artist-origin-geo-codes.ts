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
 * メインループの後、既にorigin_country_codeが解決済みのアーティストのうち、
 * 対応するgeo_boundary行が(ネットワーク不調等で)欠けているものを再取得する
 * 補修パスを実行する(冪等・何度実行してもキャッシュ済みなら追加コスト無し)。
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
): Promise<boolean> {
  const muniCode = await fetchMuniCode(artist.origin_latitude, artist.origin_longitude)
  await sleep(REQUEST_INTERVAL_MS)

  const { error: updateError } = await supabase
    .from('artist')
    .update({ origin_country_code: countryCode, origin_muni_code: muniCode })
    .eq('id', artist.id)

  if (updateError) {
    console.error(`  DB保存失敗: ${updateError.message}`)
    return false
  }

  if (!muniCode) {
    console.log('  日本 / 市区町村コード取得できず')
    return true
  }
  const boundary = await getOrFetchMunicipalityBoundary(supabase, muniCode)
  console.log(`  日本 / muniCd=${muniCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
  return true
}

async function resolveOtherArtist(
  supabase: ReturnType<typeof createAdminClient>,
  artist: ArtistRow,
  countryCode: string,
  regionCode: string | null,
  admin1Features: NaturalEarthAdmin1Feature[]
): Promise<boolean> {
  const { error: updateError } = await supabase
    .from('artist')
    .update({ origin_country_code: countryCode, origin_region_code: regionCode })
    .eq('id', artist.id)

  if (updateError) {
    console.error(`  DB保存失敗: ${updateError.message}`)
    return false
  }

  if (!regionCode) {
    console.log(`  ${countryCode} / 州地域コード無し(国ブロック表示にフォールバック)`)
    return true
  }
  const boundary = await getOrFetchRegionBoundary(supabase, regionCode, admin1Features)
  console.log(`  ${countryCode} / region=${regionCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
  return true
}

/**
 * 既にorigin_muni_code/origin_region_codeが保存済みのアーティストのうち、対応する
 * geo_boundary行が無いものを再取得する補修パス。メインループとは独立して、
 * 何度でも安全に再実行できる(取得済みのものはコスト無しでスキップされる)。
 * GB/FRの一部の州地域コードのようにNatural Earthに恒久的に収録が無いケースは
 * 毎回「取得失敗」と表示され続けるが、これは既知のデータ欠落であり不具合ではない。
 */
async function repairMissingBoundaries(
  supabase: ReturnType<typeof createAdminClient>,
  admin1Features: NaturalEarthAdmin1Feature[]
) {
  const { data: muniRows } = await supabase.from('artist').select('origin_muni_code').not('origin_muni_code', 'is', null)
  const { data: regionRows } = await supabase
    .from('artist')
    .select('origin_region_code')
    .not('origin_region_code', 'is', null)
  const { data: cachedBoundaries } = await supabase.from('geo_boundary').select('level, code')

  const cachedMuni = new Set((cachedBoundaries ?? []).filter((b) => b.level === 'municipality').map((b) => b.code))
  const cachedRegion = new Set((cachedBoundaries ?? []).filter((b) => b.level === 'region').map((b) => b.code))

  const missingMuni = [...new Set((muniRows ?? []).map((r) => r.origin_muni_code as string))].filter(
    (c) => !cachedMuni.has(c)
  )
  const missingRegion = [...new Set((regionRows ?? []).map((r) => r.origin_region_code as string))].filter(
    (c) => !cachedRegion.has(c)
  )

  if (missingMuni.length === 0 && missingRegion.length === 0) {
    console.log('補修対象の境界ポリゴンはありません。')
    return
  }
  console.log(`\n境界ポリゴンの補修: 市区町村${missingMuni.length}件・州地域${missingRegion.length}件`)

  for (const muniCode of missingMuni) {
    const boundary = await getOrFetchMunicipalityBoundary(supabase, muniCode)
    console.log(`  muniCd=${muniCode}${boundary ? ' 取得成功' : '(取得失敗、既知のデータ欠落の可能性)'}`)
  }
  for (const regionCode of missingRegion) {
    const boundary = await getOrFetchRegionBoundary(supabase, regionCode, admin1Features)
    console.log(`  region=${regionCode}${boundary ? ' 取得成功' : '(取得失敗、既知のデータ欠落の可能性)'}`)
  }
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

  console.log('Natural Earthの州・地域データを取得中(約40MB、数十秒かかります)...')
  const admin1Features = await fetchNaturalEarthAdmin1Features()
  console.log(`取得完了: ${admin1Features.length}件\n`)

  let resolved = 0
  let noCountryCode = 0
  let failed = 0

  if (rows.length === 0) {
    console.log('対象のアーティストはいません。')
  } else {
    console.log(`対象: ${rows.length}件\n`)

    for (const [index, artist] of rows.entries()) {
      console.log(`[${index + 1}/${rows.length}] ${artist.name}`)
      try {
        const { countryCode, regionCode } = await fetchCountryAndRegion(artist.origin_latitude, artist.origin_longitude)
        if (index < rows.length - 1) {
          await sleep(REQUEST_INTERVAL_MS)
        }

        if (!countryCode) {
          console.log('  国コードを取得できませんでした')
          noCountryCode += 1
          continue
        }

        const success =
          countryCode === 'jp'
            ? await resolveJapaneseArtist(supabase, artist, countryCode)
            : await resolveOtherArtist(supabase, artist, countryCode, regionCode, admin1Features)

        if (success) {
          resolved += 1
        } else {
          failed += 1
        }
      } catch (err) {
        console.error(`  失敗: ${err instanceof Error ? err.message : err}`)
        failed += 1
      }
    }

    console.log('\n--- 結果サマリー ---')
    console.log(`解決成功: ${resolved}/${rows.length}件`)
    console.log(`国コード取得できず: ${noCountryCode}/${rows.length}件`)
    console.log(`失敗: ${failed}/${rows.length}件`)
  }

  await repairMissingBoundaries(supabase, admin1Features)

  console.log('\nDONE')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
