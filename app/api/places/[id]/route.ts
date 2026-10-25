import { NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { artworkAt } from '@/utils/artworkSize'
import { countryLabel, fetchPlace, fetchPlaceArtists, placeLabel } from '@/utils/placeData'

/** 地球儀で都市をタップしたときのカード用: 都市名・人数・代表アーティスト(写真のある、リリースの多い順に12組) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const place = await fetchPlace(supabase, id)
  if (!place) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const artists = await fetchPlaceArtists(supabase, id)
  const top = [...artists]
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || b.albumCount - a.albumCount)
    .slice(0, 12)
    .map((a) => ({ id: a.id, name: a.name, imageUrl: artworkAt(a.imageUrl, 160), firstYear: a.firstYear }))
  return NextResponse.json({
    id: place.id,
    label: placeLabel(place),
    name: place.name,
    country: countryLabel(place.countryCode),
    total: artists.length,
    artists: top,
  })
}
