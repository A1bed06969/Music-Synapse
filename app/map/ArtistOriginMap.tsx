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
  resolveCountryIso,
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

// レンダー毎に新しい配列リテラルを作らないための安定した空配列参照(LeafletMap.tsxの
// EMPTY_POLYGONS定数と同じ狙い)。useMemoの各ブランチが「今回は自分の出番ではない」時に
// これを返すことで、その他のブランチ用データが変わってもLeafletMapへ渡すpropsの参照が
// 不必要に変化しないようにする。
const EMPTY_MARKERS: MapMarker[] = []
const EMPTY_POLYGONS: MapPolygon[] = []
const EMPTY_ARTISTS: ArtistOriginRow[] = []

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
  const [highResCountryFeatures, setHighResCountryFeatures] = useState<BoundaryFeature[]>([])

  const countryToContinent = useMemo(() => buildCountryToContinentMap(countryFeatures), [countryFeatures])
  const countryFeatureByCode = useMemo(() => {
    const map = new Map<string, NaturalEarthCountryFeature>()
    for (const feature of countryFeatures) {
      const iso = resolveCountryIso(feature.properties)
      if (iso) map.set(iso, feature)
    }
    return map
  }, [countryFeatures])

  // アーティスト一覧から選択されたら、そのアーティストの国の階層まで直接ドリルダウンする
  // (市区町村/州地域そのものへのズームはCountry状態のLeafletMapのfocusIdで行う)。
  // 側リストを高速にホバーで通過するだけで対象国が変わらないことも多いため、
  // 解決先の国が実際に変わった時だけstateを更新する(prevをそのまま返して
  // オブジェクト参照を保つことで、下のポリゴン取得effectの不要な再実行を防ぐ)。
  useEffect(() => {
    if (!selectedArtistId) return
    const artist = artists.find((a) => a.id === selectedArtistId)
    if (!artist?.countryCode) return
    const countryCode = artist.countryCode.toLowerCase()
    setDrill((prev) =>
      prev.level === 'country' && prev.countryCode === countryCode
        ? prev
        : { level: 'country', continent: countryToContinent.get(countryCode) ?? 'その他', countryCode }
    )
  }, [selectedArtistId, artists, countryToContinent])

  const activeCountryCode = drill.level === 'country' ? drill.countryCode : null

  // Country状態に入ったら、その国のアーティスト達が使っているregion/muniコードに
  // 対応するポリゴンだけをオンデマンドで取得する(geo_boundary全件は絶対に取らない)。
  // activeCountryCodeにのみ依存させることで、対象国が変わらない限り(drillオブジェクトの
  // 参照だけが変わっても)再フェッチしない。
  useEffect(() => {
    if (!activeCountryCode) {
      setRegionFeatures((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === activeCountryCode)
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
  }, [activeCountryCode, artists])

  const activeContinent = drill.level === 'continent' ? drill.continent : null

  // Continent状態に入ったら、世界地図に同梱の低解像度国境データ(初期表示用の
  // フォールバック、下のcontinentPolygonsで使用)とは別に、実際に表示する国だけの
  // 高解像度ポリゴンをオンデマンドで取得する(geo_boundaryの'country'レベル)。
  // 取得できるまでは低解像度のまま表示され、届き次第差し替わる。
  useEffect(() => {
    if (!activeContinent) {
      setHighResCountryFeatures((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const codes = groupArtistsByCountry(artists, activeContinent, countryToContinent).map((c) => c.countryCode)
    if (codes.length === 0) {
      setHighResCountryFeatures((prev) => (prev.length === 0 ? prev : []))
      return
    }

    let cancelled = false
    async function load() {
      const res = await fetch(`/api/map/geo-boundary?level=country&codes=${codes.join(',')}`)
      if (res.ok && !cancelled) {
        setHighResCountryFeatures((await res.json()) as BoundaryFeature[])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeContinent, artists, countryToContinent])

  const highResGeometryByCode = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    for (const feature of highResCountryFeatures) map.set(feature.code, feature.geometry)
    return map
  }, [highResCountryFeatures])

  // 3つのドリルダウン段階それぞれのmarkers/polygonsをuseMemoで作る。Reactのフック規則上
  // (呼び出し順序をレンダー間で変えてはいけない)、下のif分岐の中でuseMemoを呼ぶことは
  // できないため、ここで全段階分をあらかじめ計算し、該当しない段階では安定した空配列
  // (EMPTY_MARKERS/EMPTY_POLYGONS)を返すことで、他の段階のデータが変化しても
  // このコンポーネントが今いない段階の配列の参照までは変わらないようにする。

  // World段階
  const worldMarkers: MapMarker[] = useMemo(() => {
    if (drill.level !== 'world') return EMPTY_MARKERS
    const continents = groupArtistsByContinent(artists, countryToContinent)
    return continents
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
  }, [drill.level, artists, countryToContinent])

  // 大陸段階の表示位置。CONTINENT_CENTERの固定中心へ固定ズームで表示する(理由は
  // LeafletMap.tsxのviewOverrideのコメント参照)。オブジェクト参照を安定させないと
  // 毎レンダーでLeafletMapのレイヤー再構築effectが余計に走ってしまうためuseMemo化。
  const continentViewOverride = useMemo(() => {
    if (drill.level !== 'continent') return undefined
    const center = CONTINENT_CENTER[drill.continent]
    return center ? { center, zoom: 4 } : undefined
  }, [drill])

  // Continent段階。塗りつぶし自体は高解像度データ(geo_boundaryのcountryレベル、
  // 届くまでは低解像度のworld-countries.jsonをフォールバックとして使用)。
  // ドリルダウンしない国(州地域データが無い国)のポップアップには、クリックで
  // 選べるようその国のアーティスト一覧(スクロール可)を埋め込む。
  const continentPolygons: MapPolygon[] = useMemo(() => {
    if (drill.level !== 'continent') return EMPTY_POLYGONS
    const countries = groupArtistsByCountry(artists, drill.continent, countryToContinent)
    return countries
      .map((c) => {
        const lowResFeature = countryFeatureByCode.get(c.countryCode)
        const geometry = highResGeometryByCode.get(c.countryCode) ?? lowResFeature?.geometry
        if (!geometry) return null

        const artistsInThisCountry = artists.filter((a) => a.countryCode?.toLowerCase() === c.countryCode)
        const willDrillDown = hasBoundaryDataForCountry(
          artistsInThisCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
          boundaryCodeSet
        )

        let popupHtml = ''
        if (!willDrillDown) {
          const adminName = lowResFeature?.properties.ADMIN ?? c.countryCode.toUpperCase()
          const artistListHtml = artistsInThisCountry
            .map(
              (a) =>
                `<div style="margin-top:4px;"><a href="/artists/${escapeHtml(a.id)}" style="color:inherit;">${escapeHtml(a.name)}</a></div>`
            )
            .join('')
          popupHtml = `<div style="font-weight:bold;">${escapeHtml(adminName)}: ${c.artistCount}組</div><div style="margin-top:6px;max-height:200px;overflow-y:auto;">${artistListHtml}</div>`
        }

        return {
          id: `country-${c.countryCode}`,
          geometry,
          color: '#5aa9e6',
          popupHtml,
        }
      })
      .filter((p): p is MapPolygon => p !== null)
  }, [drill, artists, countryFeatureByCode, highResGeometryByCode, boundaryCodeSet, countryToContinent])

  // Country段階
  const artistsInCountry: ArtistOriginRow[] = useMemo(() => {
    if (!activeCountryCode) return EMPTY_ARTISTS
    return artists.filter((a) => a.countryCode?.toLowerCase() === activeCountryCode)
  }, [artists, activeCountryCode])

  // #3: artistsInCountryは定義上countryCodeを持つアーティストしか含まないため、
  // resolveArtistTargetが'point'を返すことはない(countryCodeがnullの時のみ'point')。
  // 'country'レベル(=そのアーティストの国にはregion/muniポリゴンがまだ無い、または
  // 一部のアーティストだけキャッシュ済み、という混在ケース)までを取りこぼさず点表示する。
  const fallbackMarkers: MapMarker[] = useMemo(() => {
    if (!activeCountryCode) return EMPTY_MARKERS
    return artistsInCountry
      .filter((a) => {
        const level = resolveArtistTarget(a, boundaryCodeSet).level
        return level === 'point' || level === 'country'
      })
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
  }, [activeCountryCode, artistsInCountry, boundaryCodeSet])

  const countryPolygons: MapPolygon[] = useMemo(() => {
    if (!activeCountryCode) return EMPTY_POLYGONS
    return regionFeatures.map((feature) => {
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
  }, [activeCountryCode, regionFeatures, artistsInCountry])

  if (drill.level === 'world') {
    return (
      <LeafletMap
        markers={worldMarkers}
        showMarkerLabels
        onMarkerClick={(id) => setDrill({ level: 'continent', continent: id.replace('continent-', '') })}
      />
    )
  }

  if (drill.level === 'continent') {
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
          markers={EMPTY_MARKERS}
          polygons={continentPolygons}
          viewOverride={continentViewOverride}
          onPolygonClick={(id) => {
            const countryCode = id.replace('country-', '')
            const artistsInClickedCountry = artists.filter((a) => a.countryCode?.toLowerCase() === countryCode)
            const willDrillDown = hasBoundaryDataForCountry(
              artistsInClickedCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
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

  // 選択中のアーティストがこの国に属するなら、そのアーティストの解決済み最深レベル
  // (市区町村/州地域のポリゴン、または解決できなければ点マーカー)までズームする
  const selectedArtist = artistsInCountry.find((a) => a.id === selectedArtistId)
  const focusId = selectedArtist
    ? (() => {
        const target = resolveArtistTarget(selectedArtist, boundaryCodeSet)
        if (target.level === 'municipality' || target.level === 'region') return `boundary-${target.code}`
        if (target.level === 'point' || target.level === 'country') return `artist-${selectedArtist.id}`
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
      <LeafletMap markers={fallbackMarkers} polygons={countryPolygons} focusId={focusId} />
    </div>
  )
}
