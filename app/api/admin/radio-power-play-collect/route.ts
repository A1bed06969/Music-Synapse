// app/api/admin/radio-power-play-collect/route.ts
//
// 管理画面の「今すぐ全局を収集する」ボタンから呼ばれる。media.power_play_urlが
// 設定済みの全局について、パワープレイ/ヘビーローテーションをGeminiで抽出し、
// 今月分の重複を除いた新規候補をradio_airplay_pickへ登録する(カタログへの
// 本登録は行わない。既存の人力確認フロー/admin/data/media/radio-airplay-pickに
// 委ねる)。サイト全体を保護するBasic認証(proxy.ts)の内側にあるため、
// このルート自体に追加の認証チェックは不要。
//
// 局数(2026-09時点で50局超)が多く、Gemini(gemini-3.1-flash-lite)無料枠の
// 1分15リクエスト制限に収まるよう局間に間隔を空けると、全局を1リクエストで
// 処理しきる前にVercelのmaxDuration(300秒)へ達してしまう実例を確認した。
// そのためoffset/limitでバッチ処理できるようにし、クライアント側
// (CollectButton.tsx)が全局終わるまで繰り返し呼び出す設計にしている。
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { extractRadioPicksFromUrl } from '@/utils/geminiRadioPickExtract'
import { findItunesCandidate, isRateLimitError } from '@/utils/radioPickMatching'

export const maxDuration = 300

const DEFAULT_BATCH_SIZE = 10

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function firstDayOfCurrentMonthISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

type StationResult = { station: string; extracted: number; inserted: number; error?: string }

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0)
  const limit = Math.max(1, Number(searchParams.get('limit') ?? String(DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE)

  const supabase = createAdminClient()

  const { data: allStations, error: stationsError } = await supabase
    .from('media')
    .select('name, area, prefecture, power_play_url')
    .eq('media_type', 'radio')
    .not('power_play_url', 'is', null)
    .order('name')

  if (stationsError) {
    return NextResponse.json({ error: stationsError.message }, { status: 500 })
  }

  const total = (allStations ?? []).length
  const batch = (allStations ?? []).slice(offset, offset + limit)

  const monthStart = firstDayOfCurrentMonthISO()
  const todayDate = new Date().toISOString().slice(0, 10)
  const results: StationResult[] = []
  let totalInserted = 0

  // Gemini(gemini-3.1-flash-lite)無料枠の1分15リクエスト制限に収まるよう、
  // 局間に間隔を空ける(待機なしで52局を連続実行し429が多発した実例あり)。
  const GEMINI_PACING_MS = 4_500
  let isFirstStation = true

  for (const station of batch) {
    if (!isFirstStation) await sleep(GEMINI_PACING_MS)
    isFirstStation = false

    try {
      const candidates = await extractRadioPicksFromUrl(station.name, station.power_play_url as string)
      let inserted = 0

      for (const candidate of candidates) {
        const { data: existing, error: dedupError } = await supabase
          .from('radio_airplay_pick')
          .select('id')
          .eq('station_name', station.name)
          .ilike('artist_name', candidate.artistName)
          .ilike('track_title', candidate.trackTitle)
          .gte('created_at', monthStart)
          .limit(1)

        if (dedupError || (existing && existing.length > 0)) continue

        let itunesMatch = null
        try {
          itunesMatch = await findItunesCandidate(candidate.artistName, candidate.trackTitle)
        } catch (err) {
          if (isRateLimitError(err)) {
            await sleep(60_000)
          }
        }

        const { error: insertError } = await supabase.from('radio_airplay_pick').insert({
          region: station.area ?? station.prefecture ?? '不明',
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

  const nextOffset = offset + batch.length < total ? offset + batch.length : null

  return NextResponse.json({ stations: total, processed: batch.length, nextOffset, totalInserted, results })
}
