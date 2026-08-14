/**
 * マップのアーティスト一覧に国名/県名を表示するための下準備。
 * origin_prefecture(日本人アーティスト向け)が入っていないアーティストについて、
 * origin_latitude/longitudeをNominatim(OpenStreetMapの無料リバースジオコーディング)で
 * 国名に逆引きし、hometown_countryへ日本語で登録する。
 *
 * Nominatimの利用ポリシーに従い、リクエスト間隔を1秒空け、
 * 識別可能なUser-Agentを付与する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-artist-hometown-country.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'

const REQUEST_INTERVAL_MS = 1000
const USER_AGENT = 'MusicSynapse-Dev/1.0 (personal project, hometown_country backfill)'

type ArtistRow = {
  id: string
  name: string
  origin_latitude: number
  origin_longitude: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reverseGeocodeCountry(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3&accept-language=ja`

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as { address?: { country?: string } }
  return data.address?.country ?? null
}

async function main() {
  const supabase = createAdminClient()

  const { data: artists, error } = await supabase
    .from('artist')
    .select('id, name, origin_latitude, origin_longitude')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)
    .is('origin_prefecture', null)
    .is('hometown_country', null)

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

  let updated = 0
  let notFound = 0
  let failed = 0

  for (const [index, artist] of rows.entries()) {
    console.log(`[${index + 1}/${rows.length}] ${artist.name}`)

    try {
      const country = await reverseGeocodeCountry(artist.origin_latitude, artist.origin_longitude)
      if (!country) {
        console.log('  ❌ 国名を取得できませんでした')
        notFound += 1
      } else {
        const { error: updateError } = await supabase
          .from('artist')
          .update({ hometown_country: country })
          .eq('id', artist.id)
        if (updateError) {
          console.log(`  ❌ 保存失敗: ${updateError.message}`)
          failed += 1
        } else {
          console.log(`  ✅ 登録: ${country}`)
          updated += 1
        }
      }
    } catch (err) {
      console.log(`  ❌ 取得失敗: ${(err as Error).message}`)
      failed += 1
    }

    if (index < rows.length - 1) {
      await sleep(REQUEST_INTERVAL_MS)
    }
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`登録成功: ${updated}/${rows.length}件`)
  console.log(`国名取得失敗: ${notFound}/${rows.length}件`)
  console.log(`DB保存失敗: ${failed}/${rows.length}件`)
}

main()
