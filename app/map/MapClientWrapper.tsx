'use client'

import dynamic from 'next/dynamic'
import type { MapMarker } from './LeafletMap'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

export default function MapClientWrapper({
  markers,
  heightClassName,
}: {
  markers: MapMarker[]
  heightClassName?: string
}) {
  return <LeafletMap markers={markers} heightClassName={heightClassName} />
}
