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

export default function LeafletMap({
  markers,
  heightClassName = 'h-[600px]',
  focusId,
  onMarkerHover,
  onMarkerClick,
}: {
  markers: MapMarker[]
  heightClassName?: string
  /** 一覧パネルなどからピンを選んだ時にセットすると、そのピンへスムーズにフライト+ポップアップを開く */
  focusId?: string | null
  /** ピン自体にマウスホバーした時に呼ばれる(一覧パネル側のハイライトなどに利用) */
  onMarkerHover?: (id: string | null) => void
  /** ピン自体をクリックした時に呼ばれる */
  onMarkerClick?: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const leafletMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  // マーカー生成エフェクトを再実行させずに常に最新のコールバックを呼べるようref経由で保持する
  const onMarkerHoverRef = useRef(onMarkerHover)
  const onMarkerClickRef = useRef(onMarkerClick)
  useEffect(() => {
    onMarkerHoverRef.current = onMarkerHover
    onMarkerClickRef.current = onMarkerClick
  }, [onMarkerHover, onMarkerClick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView([35.6812, 139.7671], 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
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
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${marker.color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.6);"></span>`,
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

    if (markers.length > 0) {
      map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
    }

    return () => {
      layerGroup.remove()
    }
  }, [markers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusId) return
    const marker = leafletMarkersRef.current.get(focusId)
    if (!marker) return
    const targetZoom = Math.max(map.getZoom(), FOCUS_ZOOM)
    map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.8 })
    marker.openPopup()
  }, [focusId])

  return <div ref={containerRef} className={`w-full rounded-lg ${heightClassName}`} />
}
