import Link from 'next/link'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import { hubContent } from '@/app/components/hub/hubContents'
import { countryLabel, fetchPlaceCounts, placeLabel } from '@/utils/placeData'
import { createClient } from '@/utils/Supabase/server'
import GlobeLoader from './globe/GlobeLoader'
import PlanetDiscover, { type RareCountry } from './PlanetDiscover'
import { PlanetLayerProvider, PlanetLayerSwitcher, type PlanetLayer } from './PlanetLayers'

export const metadata = { title: 'Music Planet Tour | Music Synapse' }

/** Music Planet Tour: 地球儀で、アーティストの出身地をたどる。
 * ライブ会場・レコードショップの層は、平面の地図(/map/flat)に残している */
type SpotRow = { id: string; name: string; address: string | null; city: string | null; country: string | null; latitude: number; longitude: number } & Record<string, unknown>

/** 地球儀に点で出す店・ライブハウス(座標のあるもの全件。1リクエスト1000件までなので、ページを分けて取る) */
async function fetchSpots(supabase: Awaited<ReturnType<typeof createClient>>, table: 'livehouse' | 'recordshop', urlColumn: string) {
  const out: { id: string; name: string; address: string | null; city: string | null; country: string | null; url: string | null; lat: number; lng: number }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from(table)
      .select(`id, name, address, city, country, latitude, longitude, ${urlColumn}`)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('id')
      .range(from, from + 999)
    const rows = (data ?? []) as unknown as SpotRow[]
    for (const r of rows) {
      out.push({ id: r.id, name: r.name, address: r.address, city: r.city, country: r.country, url: (r[urlColumn] as string | null) ?? null, lat: Number(r.latitude), lng: Number(r.longitude) })
    }
    if (rows.length < 1000) break
  }
  return out
}

export default async function MapPage() {
  const supabase = await createClient()
  const c = hubContent('planet')
  const [counts, { data: countryRows }, livehouseSpots, shopSpots] = await Promise.all([
    fetchPlaceCounts(supabase),
    supabase.rpc('country_artist_counts'),
    fetchSpots(supabase, 'livehouse', 'url'),
    fetchSpots(supabase, 'recordshop', 'official_site_url'),
  ])
  const spots = { livehouse: livehouseSpots, shop: shopSpots }
  const places = counts.map((p) => ({
    id: p.id,
    label: placeLabel(p),
    country: countryLabel(p.countryCode),
    countryCode: p.countryCode,
    lat: p.latitude,
    lng: p.longitude,
    count: p.artistCount,
  }))
  const total = counts.reduce((s, p) => s + p.artistCount, 0)
  const countries = new Set(counts.map((p) => p.countryCode)).size
  // 発見用: 1〜2組しかいない国(写真のあるアーティストを先に)
  const rareCountries: RareCountry[] = (
    (countryRows ?? []) as {
      country_code: string
      artist_count: number
      sample_artist_id: string
      sample_artist_name: string
      sample_image_url: string | null
    }[]
  )
    .filter((r) => r.artist_count <= 2)
    .map((r) => ({
      countryCode: r.country_code,
      artistCount: r.artist_count,
      artistId: r.sample_artist_id,
      artistName: r.sample_artist_name,
      imageUrl: r.sample_image_url,
    }))
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)))

  // 右カラムのレイヤー。アーティスト以外は、データがそろったら ready にして地球儀に描く
  const layers: PlanetLayer[] = [
    {
      key: 'artist',
      label: 'アーティスト',
      color: c.color,
      description: '出身地(都市)ごとに、出身アーティストの数を光の柱で。',
      count: total,
      ready: true,
    },
    {
      key: 'genre',
      label: 'ジャンル',
      color: '#5cc8ff',
      description: 'ジャンルを選ぶと、その出身アーティストが多い街が浮かび上がります(発祥の地と、広がりの偏りが見える)。',
      count: null,
      ready: false,
    },
    {
      key: 'livehouse',
      label: 'ライブハウス',
      color: '#ffb35c',
      description: '各地のライブハウス・フェス会場を、街ごとに。',
      count: livehouseSpots.length,
      ready: livehouseSpots.length > 0,
    },
    {
      key: 'shop',
      label: 'レコードショップ',
      color: '#52e05f',
      description: '国内外のレコードショップを、街ごとに。',
      count: shopSpots.length,
      ready: shopSpots.length > 0,
    },
  ]

  const left = (
    <div className="grid gap-4 text-xs leading-relaxed text-white/55">
      <p>
        {countries}か国・{places.length}都市から、{total}
        組。光の柱が高いほど、その街の出身アーティストが多い。寄ると地図に切り替わり、街ごとに見られます。
      </p>
      <Link href="/map/flat" className="font-bold" style={{ color: c.color }}>
        平面の地図で見る(ライブ会場・レコードショップ) →
      </Link>
    </div>
  )
  const body = (
    <>
      <GlobeLoader places={places} spots={spots} />
      <PlanetDiscover cities={counts} rareCountries={rareCountries} />
    </>
  )

  return (
    <PlanetLayerProvider layers={layers}>
      <HubShell
        hubKey="planet"
        stats={[
          { label: 'アーティスト', value: total },
          { label: '都市', value: places.length },
          { label: '国', value: countries },
        ]}
        leftExtra={left}
        rightExtra={<PlanetLayerSwitcher />}
        mobileContent={
          <>
            <HubIdentity hubKey="planet" />
            <div className="mt-4">
              <PlanetLayerSwitcher />
            </div>
            <div className="mt-6">{body}</div>
            <div className="mt-6">{left}</div>
          </>
        }
      >
        {body}
      </HubShell>
    </PlanetLayerProvider>
  )
}
