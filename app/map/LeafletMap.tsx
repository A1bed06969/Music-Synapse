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

    for (const marker of markers) {
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
