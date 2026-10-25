import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchPlaceCounts } from '@/utils/placeData'

/** 「どこかへ旅する」: 出身アーティストのいる都市から無作為に1つ選んで、その都市のページへ飛ぶ。
 * 大都市ばかりにならないよう、先に国を無作為に選んでから、その国の都市を選ぶ */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const places = await fetchPlaceCounts(supabase)
  if (places.length === 0) return NextResponse.redirect(new URL('/map', request.url))
  const byCountry = new Map<string, typeof places>()
  for (const p of places) byCountry.set(p.countryCode, [...(byCountry.get(p.countryCode) ?? []), p])
  const countries = [...byCountry.keys()]
  const list = byCountry.get(countries[Math.floor(Math.random() * countries.length)])!
  const pick = list[Math.floor(Math.random() * list.length)]
  return NextResponse.redirect(new URL(`/map/places/${pick.id}`, request.url))
}

export const dynamic = 'force-dynamic'
