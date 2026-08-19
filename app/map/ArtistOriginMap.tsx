// app/map/ArtistOriginMap.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { escapeHtml } from '@/utils/format'
import type { MapMarker, MapPolygon } from './LeafletMap'
import {
  buildCountryToContinentMap,
  groupArtistsByContinent,
  groupArtistsByCountry,
  CONTINENT_CENTER,
  type NaturalEarthCountryFeature,
} from '@/utils/artistOriginMap'
import { hasBoundaryDataForCountry, resolveArtistTarget, type BoundaryCodeSet } from '@/utils/artistOriginBoundary'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

export type ArtistOriginRow = {
  id: string
  name: string
  imageUrl: string | null
  latitude: number
  longitude: number
  countryCode: string | null
  regionCode: string | null
  muniCode: string | null
  /** アーティスト単体の点マーカー用ポップアップ(既存page.tsxの書式を流用) */
  popupHtml: string
}

type DrillState =
  | { level: 'world' }
  | { level: 'continent'; continent: string }
  | { level: 'country'; continent: string; countryCode: string }

type BoundaryFeature = { code: string; name: string | null; geometry: Record<string, unknown> }

export default function ArtistOriginMap({
  artists,
  countryFeatures,
  boundaryCodeSet,
  selectedArtistId,
  onSelectArtist,
}: {
  artists: ArtistOriginRow[]
  countryFeatures: NaturalEarthCountryFeature[]
  boundaryCodeSet: BoundaryCodeSet
  /** 一覧パネルでアーティストが選ばれたら、そのアーティストの粒度まで直接ドリルダウンする */
  selectedArtistId: string | null
  onSelectArtist: (id: string | null) => void
}) {
  const [drill, setDrill] = useState<DrillState>({ level: 'world' })
  const [regionFeatures, setRegionFeatures] = useState<BoundaryFeature[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)

  const countryToContinent = useMemo(() => buildCountryToContinentMap(countryFeatures), [countryFeatures])
  const countryFeatureByCode = useMemo(() => {
    const map = new Map<string, NaturalEarthCountryFeature>()
    for (const feature of countryFeatures) {
      const iso = feature.properties.ISO_A2?.toLowerCase()
      if (iso) map.set(iso, feature)
    }
    return map
  }, [countryFeatures])

  // アーティスト一覧から選択されたら、そのアーティストの国の階層まで直接ドリルダウンする
  // (市区町村/州地域そのものへのズームはCountry状態のLeafletMapのfocusIdで行う)
  useEffect(() => {
    if (!selectedArtistId) return
    const artist = artists.find((a) => a.id === selectedArtistId)
    if (!artist?.countryCode) return
    const continent = countryToContinent.get(artist.countryCode.toLowerCase()) ?? 'その他'
    setDrill({ level: 'country', continent, countryCode: artist.countryCode.toLowerCase() })
  }, [selectedArtistId, artists, countryToContinent])

  // Country状態に入ったら、その国のアーティスト達が使っているregion/muniコードに
  // 対応するポリゴンだけをオンデマンドで取得する(geo_boundary全件は絶対に取らない)
  useEffect(() => {
    if (drill.level !== 'country') {
      setRegionFeatures([])
      return
    }
    const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === drill.countryCode)
    const muniCodes = [...new Set(artistsInCountry.map((a) => a.muniCode).filter((c): c is string => Boolean(c)))]
    const regionCodes = [...new Set(artistsInCountry.map((a) => a.regionCode).filter((c): c is string => Boolean(c)))]

    let cancelled = false
    async function load() {
      setLoadingRegions(true)
      const results: BoundaryFeature[] = []
      if (muniCodes.length > 0) {
        const res = await fetch(`/api/map/geo-boundary?level=municipality&codes=${muniCodes.join(',')}`)
        if (res.ok) results.push(...((await res.json()) as BoundaryFeature[]))
      }
      if (regionCodes.length > 0) {
        const res = await fetch(`/api/map/geo-boundary?level=region&codes=${regionCodes.join(',')}`)
        if (res.ok) results.push(...((await res.json()) as BoundaryFeature[]))
      }
      if (!cancelled) {
        setRegionFeatures(results)
        setLoadingRegions(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [drill, artists])

  if (drill.level === 'world') {
    const continents = groupArtistsByContinent(artists, countryToContinent)
    const markers: MapMarker[] = continents
      .filter((c) => CONTINENT_CENTER[c.continent])
      .map((c) => ({
        id: `continent-${c.continent}`,
        latitude: CONTINENT_CENTER[c.continent][0],
        longitude: CONTINENT_CENTER[c.continent][1],
        color: '#e8a63c',
        category: 'artist' as const,
        label: `${c.continent}(${c.artistCount})`,
        popupHtml: `<div style="font-weight:bold;">${escapeHtml(c.continent)}: ${c.artistCount}組</div>`,
      }))

    return (
      <LeafletMap
        markers={markers}
        onMarkerClick={(id) => setDrill({ level: 'continent', continent: id.replace('continent-', '') })}
      />
    )
  }

  if (drill.level === 'continent') {
    const countries = groupArtistsByCountry(artists, drill.continent, countryToContinent)
    const polygons: MapPolygon[] = countries
      .map((c) => {
        const feature = countryFeatureByCode.get(c.countryCode)
        if (!feature) return null
        const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === c.countryCode)
        const willDrillDown = hasBoundaryDataForCountry(
          artistsInCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
          boundaryCodeSet
        )
        return {
          id: `country-${c.countryCode}`,
          geometry: feature.geometry,
          color: '#5aa9e6',
          popupHtml: willDrillDown
            ? ''
            : `<div style="font-weight:bold;">${escapeHtml(feature.properties.ADMIN ?? c.countryCode.toUpperCase())}: ${c.artistCount}組</div>`,
        }
      })
      .filter((p): p is MapPolygon => p !== null)

    return (
      <div>
        <button
          type="button"
          onClick={() => setDrill({ level: 'world' })}
          className="mb-2 text-xs text-white/40 hover:text-white/70"
        >
          ← 大陸一覧に戻る
        </button>
        <LeafletMap
          markers={[]}
          polygons={polygons}
          onPolygonClick={(id) => {
            const countryCode = id.replace('country-', '')
            const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === countryCode)
            const willDrillDown = hasBoundaryDataForCountry(
              artistsInCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
              boundaryCodeSet
            )
            if (willDrillDown) {
              setDrill({ level: 'country', continent: drill.continent, countryCode })
            }
          }}
        />
      </div>
    )
  }

  // drill.level === 'country'
  const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === drill.countryCode)
  const fallbackMarkers: MapMarker[] = artistsInCountry
    .filter((a) => resolveArtistTarget(a, boundaryCodeSet).level === 'point')
    .map((a) => ({
      id: `artist-${a.id}`,
      latitude: a.latitude,
      longitude: a.longitude,
      color: '#e85d5d',
      category: 'artist' as const,
      label: a.name,
      imageUrl: a.imageUrl,
      popupHtml: a.popupHtml,
    }))
  const polygons: MapPolygon[] = regionFeatures.map((feature) => {
    const matchingArtists = artistsInCountry.filter((a) => a.muniCode === feature.code || a.regionCode === feature.code)
    const artistListHtml = matchingArtists
      .map(
        (a) =>
          `<div style="margin-top:4px;"><a href="/artists/${escapeHtml(a.id)}" style="color:inherit;">${escapeHtml(a.name)}</a></div>`
      )
      .join('')
    return {
      id: `boundary-${feature.code}`,
      geometry: feature.geometry,
      color: '#e85d5d',
      popupHtml: `<div style="font-weight:bold;">${escapeHtml(feature.name ?? feature.code)}</div>${artistListHtml}`,
    }
  })

  // 選択中のアーティストがこの国に属するなら、そのアーティストの解決済み最深レベル
  // (市区町村/州地域のポリゴン、または解決できなければ点マーカー)までズームする
  const selectedArtist = artistsInCountry.find((a) => a.id === selectedArtistId)
  const focusId = selectedArtist
    ? (() => {
        const target = resolveArtistTarget(selectedArtist, boundaryCodeSet)
        if (target.level === 'municipality' || target.level === 'region') return `boundary-${target.code}`
        if (target.level === 'point') return `artist-${selectedArtist.id}`
        return null
      })()
    : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setDrill({ level: 'continent', continent: drill.continent })}
        className="mb-2 text-xs text-white/40 hover:text-white/70"
      >
        ← {drill.continent}の国一覧に戻る
      </button>
      {loadingRegions && <p className="mb-2 text-xs text-white/40">読み込み中...</p>}
      <LeafletMap markers={fallbackMarkers} polygons={polygons} focusId={focusId} />
    </div>
  )
}
