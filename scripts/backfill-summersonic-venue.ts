// scripts/backfill-summersonic-venue.ts
//
// SUMMER SONIC(東京・大阪同時開催)の既存出演情報は、都市(venue)を出演情報自体に
// 記録する仕組みが登録処理に無かった時期に登録されたため、ほぼ全件event_appearance.venue
// がNULLのままになっている。これが原因で、イベント詳細ページの都市タブ(東京/大阪)で
// 絞り込んでも常に全都市の出演者が表示されてしまう不具合があった(登録処理自体は
// scripts実行後の分から修正済み: app/admin/data/events/festival-pilot/actions.ts)。
//
// festival_pilot_dataset(key='summersonic')のpicksには、day欄に埋め込まれた都市名
// ("東京 2026-08-14"等)からregion列を抽出済み(2026-08-24のマイグレーション作業で追加)。
// これとevent_appearance(artist_id + stage + start_timeで一意に近い形で対応付け)を
// 突き合わせてvenueを埋める。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-summersonic-venue.ts

import { createAdminClient } from '@/utils/Supabase/admin'

async function main() {
  const supabase = createAdminClient()

  const { data: datasetRow } = await supabase
    .from('festival_pilot_dataset')
    .select('picks')
    .eq('key', 'summersonic')
    .single()
  if (!datasetRow) {
    console.error('summersonicのfestival_pilot_datasetが見つかりません')
    return
  }
  const picks = datasetRow.picks as {
    artistName: string
    stage: string | null
    performanceDate: string | null
    startAt: string | null
    region: string | null
  }[]

  const { data: event } = await supabase.from('event').select('id').eq('name', 'SUMMER SONIC').single()
  if (!event) {
    console.error('SUMMER SONICのeventが見つかりません')
    return
  }
  const { data: edition } = await supabase
    .from('event_edition')
    .select('id')
    .eq('event_id', event.id)
    .eq('year', 2026)
    .single()
  if (!edition) {
    console.error('SUMMER SONIC 2026のevent_editionが見つかりません')
    return
  }

  const { data: editionDates } = await supabase
    .from('event_edition_date')
    .select('region, venue')
    .eq('event_edition_id', edition.id)
  const venueByRegion = new Map((editionDates ?? []).map((d) => [d.region, d.venue]))

  const { data: artists } = await supabase.from('artist').select('id, name')
  const artistIdByName = new Map((artists ?? []).map((a) => [a.name.trim().toUpperCase(), a.id]))
  const { data: artistLinks } = await supabase
    .from('festival_pilot_artist_link')
    .select('pick_name, artist_id')
    .eq('dataset_key', 'summersonic')
  for (const link of artistLinks ?? []) {
    artistIdByName.set(link.pick_name, link.artist_id)
  }

  // pick 1件ごとに、対応するartist_id + 開始時刻(なければ正午の仮時刻)のキーを作る
  // (registerFestivalAppearance/importAndRegisterFestivalArtistが登録時に使うのと同じ変換)
  type PickKey = { artistId: string; stage: string | null; startTime: string | null; region: string | null }
  const pickKeys: PickKey[] = []
  for (const pick of picks) {
    const artistId = artistIdByName.get(pick.artistName.trim().toUpperCase())
    if (!artistId) continue
    const startTime = pick.startAt || (pick.performanceDate ? `${pick.performanceDate}T12:00:00+00:00` : null)
    pickKeys.push({ artistId, stage: pick.stage, startTime, region: pick.region })
  }

  const { data: appearances } = await supabase
    .from('event_appearance')
    .select('id, artist_id, stage, start_time, venue')
    .eq('event_edition_id', edition.id)
    .is('venue', null)

  let updated = 0
  let unmatched = 0
  for (const appearance of appearances ?? []) {
    const match = pickKeys.find(
      (k) =>
        k.artistId === appearance.artist_id &&
        k.stage === appearance.stage &&
        k.startTime &&
        appearance.start_time &&
        new Date(k.startTime).getTime() === new Date(appearance.start_time).getTime()
    )
    if (!match || !match.region) {
      unmatched++
      continue
    }
    const venue = venueByRegion.get(match.region)
    if (!venue) {
      unmatched++
      continue
    }
    const { error } = await supabase.from('event_appearance').update({ venue }).eq('id', appearance.id)
    if (error) {
      console.error(`更新失敗(appearance id=${appearance.id}):`, error.message)
      unmatched++
    } else {
      updated++
    }
  }

  console.log(`完了: 更新${updated}件 / 未一致${unmatched}件(対象${appearances?.length ?? 0}件中)`)
}

main()
