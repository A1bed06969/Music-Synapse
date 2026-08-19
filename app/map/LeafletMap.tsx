'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapCategory = 'artist' | 'venue' | 'shop'

export type MapMarker = {
  id: string
  latitude: number
  longitude: number
  color: string
  popupHtml: string
  category: MapCategory
  /** 一覧パネル表示用の短いラベル(ポップアップ内のHTMLとは別に持つ) */
  label: string
  /** 一覧パネルのサムネイル用(未設定の場合は色付きドットにフォールバック) */
  imageUrl?: string | null
  /** 一覧パネル行末に表示する地域名(国名/都道府県名など) */
  region?: string | null
}

export type MapPolygon = {
  id: string
  /** GeoJSON Geometry(Polygon/MultiPolygon)。geo_boundaryやworld-countries.jsonの
   * featureからそのまま渡す想定 */
  geometry: Record<string, unknown>
  color: string
  /** 空文字列ならポップアップを出さない(親コンポーネント側で「ここは即座に
   * さらにドリルダウンするのでポップアップ不要」と判断した場合に使う) */
  popupHtml: string
}

// 座標が完全に一致するマーカーはピンが重なって隠れてしまうため、
// 同じ座標をグループ化し、円状に少しずつずらして全て見えるようにする
function spreadOverlapping(markers: MapMarker[]): MapMarker[] {
  const groups = new Map<string, MapMarker[]>()
  for (const marker of markers) {
    const key = `${marker.latitude.toFixed(5)},${marker.longitude.toFixed(5)}`
    const group = groups.get(key)
    if (group) group.push(marker)
    else groups.set(key, [marker])
  }

  const result: MapMarker[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }
    const radiusDegrees = 0.006
    group.forEach((marker, i) => {
      const angle = (2 * Math.PI * i) / group.length
      const latRad = (marker.latitude * Math.PI) / 180
      result.push({
        ...marker,
        latitude: marker.latitude + radiusDegrees * Math.sin(angle),
        longitude: marker.longitude + (radiusDegrees * Math.cos(angle)) / Math.max(Math.cos(latRad), 0.1),
      })
    })
  }
  return result
}

// ホバー/クリックでピンにフォーカスした際にズームインする目標レベル。
// 現在のズームがこれより既に大きい(寄っている)場合はズームアウトさせない。
const FOCUS_ZOOM = 14

// デフォルト引数に `[]` リテラルを直接書くとレンダーの度に新しい配列参照が
// 生成され、下のuseEffectの依存配列([markers, polygons])が毎回変化したと
// 誤認識してlayerGroupを不要に再構築してしまう(例: ホバーでfocusIdが変わる
// 度にTabbedMapViewが再レンダーされ、polygonsを渡していない呼び出し元でも
// マーカーがちらつく)。参照を安定させるためモジュールスコープの定数にする。
const EMPTY_POLYGONS: MapPolygon[] = []

export default function LeafletMap({
  markers,
  polygons = EMPTY_POLYGONS,
  heightClassName = 'h-[600px]',
  focusId,
  onMarkerHover,
  onMarkerClick,
  onPolygonClick,
}: {
  markers: MapMarker[]
  polygons?: MapPolygon[]
  heightClassName?: string
  /** 一覧パネルなどからピンを選んだ時にセットすると、そのピンへスムーズにフライト+ポップアップを開く(ポリゴンのidも対象) */
  focusId?: string | null
  /** ピン自体にマウスホバーした時に呼ばれる(一覧パネル側のハイライトなどに利用) */
  onMarkerHover?: (id: string | null) => void
  /** ピン自体をクリックした時に呼ばれる */
  onMarkerClick?: (id: string) => void
  /** ポリゴンをクリックした時に呼ばれる(ドリルダウンの状態遷移などに利用) */
  onPolygonClick?: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const leafletMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const leafletPolygonsRef = useRef<Map<string, L.GeoJSON>>(new Map())
  // マーカー生成エフェクトを再実行させずに常に最新のコールバックを呼べるようref経由で保持する
  const onMarkerHoverRef = useRef(onMarkerHover)
  const onMarkerClickRef = useRef(onMarkerClick)
  const onPolygonClickRef = useRef(onPolygonClick)
  useEffect(() => {
    onMarkerHoverRef.current = onMarkerHover
    onMarkerClickRef.current = onMarkerClick
    onPolygonClickRef.current = onPolygonClick
  }, [onMarkerHover, onMarkerClick, onPolygonClick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView([35.6812, 139.7671], 5)
    mapRef.current = map

    // 白ベース(CartoDB Positron)ですっきりとした明るい地図にする
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const layerGroup = L.featureGroup().addTo(map)
    const spreadMarkers = spreadOverlapping(markers)
    const leafletMarkers = new Map<string, L.Marker>()

    for (const marker of spreadMarkers) {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${marker.color};border:2px solid #1a1a1a;box-shadow:0 0 2px rgba(0,0,0,0.3);"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      const leafletMarker = L.marker([marker.latitude, marker.longitude], { icon })
        .addTo(layerGroup)
        .bindPopup(marker.popupHtml)
        .on('mouseover', () => onMarkerHoverRef.current?.(marker.id))
        .on('mouseout', () => onMarkerHoverRef.current?.(null))
        .on('click', () => onMarkerClickRef.current?.(marker.id))
      leafletMarkers.set(marker.id, leafletMarker)
    }
    leafletMarkersRef.current = leafletMarkers

    const leafletPolygons = new Map<string, L.GeoJSON>()
    for (const polygon of polygons) {
      const geoJsonLayer = L.geoJSON(polygon.geometry as unknown as GeoJSON.GeoJsonObject, {
        style: {
          color: polygon.color,
          weight: 1,
          fillColor: polygon.color,
          fillOpacity: 0.35,
        },
      }).addTo(layerGroup)
      if (polygon.popupHtml) {
        geoJsonLayer.bindPopup(polygon.popupHtml)
      }
      geoJsonLayer.on('click', () => onPolygonClickRef.current?.(polygon.id))
      leafletPolygons.set(polygon.id, geoJsonLayer)
    }
    leafletPolygonsRef.current = leafletPolygons

    if (markers.length > 0 || polygons.length > 0) {
      map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
    }

    return () => {
      layerGroup.remove()
    }
  }, [markers, polygons])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusId) return

    const marker = leafletMarkersRef.current.get(focusId)
    if (marker) {
      const targetZoom = Math.max(map.getZoom(), FOCUS_ZOOM)
      map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.8 })
      marker.openPopup()
      return
    }

    const polygon = leafletPolygonsRef.current.get(focusId)
    if (polygon) {
      map.flyToBounds(polygon.getBounds(), { padding: [60, 60], duration: 0.8 })
      polygon.openPopup()
    }
  }, [focusId])

  return <div ref={containerRef} className={`w-full rounded-lg ${heightClassName}`} />
}
