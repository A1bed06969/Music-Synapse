'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapMarker = {
  id: string
  latitude: number
  longitude: number
  color: string
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

export default function LeafletMap({ markers }: { markers: MapMarker[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

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

    for (const marker of spreadMarkers) {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${marker.color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.6);"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      L.marker([marker.latitude, marker.longitude], { icon }).addTo(layerGroup).bindPopup(marker.popupHtml)
    }

    if (markers.length > 0) {
      map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
    }

    return () => {
      layerGroup.remove()
    }
  }, [markers])

  return <div ref={containerRef} className="h-[600px] w-full rounded-lg" />
}
