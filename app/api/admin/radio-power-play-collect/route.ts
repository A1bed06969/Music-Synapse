// app/api/admin/radio-power-play-collect/route.ts
//
// 管理画面の「今すぐ全局を収集する」ボタンから呼ばれる。media.power_play_urlが
// 設定済みの全局について、パワープレイ/ヘビーローテーションをGeminiで抽出し、
// 今月分の重複を除いた新規候補をradio_airplay_pickへ登録する(カタログへの
// 本登録は行わない。既存の人力確認フロー/admin/data/media/radio-airplay-pickに
// 委ねる)。サイト全体を保護するBasic認証(proxy.ts)の内側にあるため、
// このルート自体に追加の認証チェックは不要。
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { extractRadioPicksFromUrl } from '@/utils/geminiRadioPickExtract'
import { findItunesCandidate, isRateLimitError } from '@/utils/radioPickMatching'

export const maxDuration = 300

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function firstDayOfCurrentMonthISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

type StationResult = { station: string; extracted: number; inserted: number; error?: string }

export async function POST() {
  const supabase = createAdminClient()

  const { data: stations, error: stationsError } = await supabase
    .from('media')
    .select('name, area, prefecture, power_play_url')
    .eq('media_type', 'radio')
    .not('power_play_url', 'is', null)

  if (stationsError) {
    return NextResponse.json({ error: stationsError.message }, { status: 500 })
  }

  const monthStart = firstDayOfCurrentMonthISO()
  const todayDate = new Date().toISOString().slice(0, 10)
  const results: StationResult[] = []
  let totalInserted = 0

  for (const station of stations ?? []) {
    try {
      const candidates = await extractRadioPicksFromUrl(station.name, station.power_play_url as string)
      let inserted = 0

      for (const candidate of candidates) {
        const { data: existing } = await supabase
          .from('radio_airplay_pick')
          .select('id')
          .eq('station_name', station.name)
          .ilike('artist_name', candidate.artistName)
          .ilike('track_title', candidate.trackTitle)
          .gte('created_at', monthStart)
          .maybeSingle()

        if (existing) continue

        let itunesMatch = null
        try {
          itunesMatch = await findItunesCandidate(candidate.artistName, candidate.trackTitle)
        } catch (err) {
          if (isRateLimitError(err)) {
            await sleep(60_000)
          }
        }

        const { error: insertError } = await supabase.from('radio_airplay_pick').insert({
          region: station.prefecture ?? station.area ?? '不明',
          station_name: station.name,
          campaign_name: candidate.campaignName,
          picked_date: todayDate,
          artist_name: candidate.artistName,
          track_title: candidate.trackTitle,
          candidate_track_id: itunesMatch?.trackId ?? null,
          candidate_track_name: itunesMatch?.trackName ?? null,
          candidate_artist_name: itunesMatch?.artistName ?? null,
          candidate_collection_id: itunesMatch?.collectionId ?? null,
          candidate_collection_name: itunesMatch?.collectionName ?? null,
          candidate_artwork_url: itunesMatch?.artworkUrl100 ?? null,
        })

        if (!insertError) inserted++
      }

      totalInserted += inserted
      results.push({ station: station.name, extracted: candidates.length, inserted })
    } catch (err) {
      results.push({ station: station.name, extracted: 0, inserted: 0, error: (err as Error).message })
    }
  }

  return NextResponse.json({ stations: (stations ?? []).length, totalInserted, results })
}
