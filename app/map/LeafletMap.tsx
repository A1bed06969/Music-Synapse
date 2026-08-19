'use client'

import { useCallback, useEffect, useRef } from 'react'
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
  showMarkerLabels = false,
  viewOverride,
  onMarkerHover,
  onMarkerClick,
  onPolygonClick,
}: {
  markers: MapMarker[]
  polygons?: MapPolygon[]
  heightClassName?: string
  /** 一覧パネルなどからピンを選んだ時にセットすると、そのピンへスムーズにフライト+ポップアップを開く(ポリゴンのidも対象) */
  focusId?: string | null
  /** trueならmarker.labelを常時表示のツールチップとしてピンの上に出す(世界地図の
   * 大陸別件数表示用。クリックしないと件数が見えないのは不親切、という要望に対応)。
   * 他の呼び出し元(ライブ会場・ショップ等)には影響しないようデフォルトfalse */
  showMarkerLabels?: boolean
  /** 指定するとfitBoundsの代わりにこの中心・ズームへ固定表示する(海外県を含む国の
   * 飛び地でboundsが暴れるのを避けるため、大陸段階で使用) */
  viewOverride?: { center: [number, number]; zoom: number }
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

  // focusIdが指すマーカー/ポリゴンへフライトしてポップアップを開く。
  // 「初回ドリル時のfly-to取りこぼし」対策として、以下2箇所から呼ぶ:
  //   1. レイヤー(markers/polygons)描画エフェクトの末尾 — 非同期フェッチで
  //      polygonsが後から揃った直後、focusId自体は変わっていなくても改めて狙う
  //   2. focusId自体が変化した時の既存エフェクト — レイヤーが既に安定した状態で
  //      フォーカス対象だけが変わるケース(一覧の別項目にホバー等)
  const applyFocus = useCallback((id: string | null | undefined) => {
    const map = mapRef.current
    if (!map || !id) return

    const marker = leafletMarkersRef.current.get(id)
    if (marker) {
      const targetZoom = Math.max(map.getZoom(), FOCUS_ZOOM)
      map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.8 })
      marker.openPopup()
      return
    }

    const polygon = leafletPolygonsRef.current.get(id)
    if (polygon) {
      map.flyToBounds(polygon.getBounds(), { padding: [60, 60], duration: 0.8 })
      polygon.openPopup()
    }
  }, [])

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
      if (showMarkerLabels) {
        leafletMarker.bindTooltip(marker.label, { permanent: true, direction: 'top', offset: [0, -8] })
      }
      leafletMarkers.set(marker.id, leafletMarker)
    }
    leafletMarkersRef.current = leafletMarkers

    const leafletPolygons = new Map<string, L.GeoJSON>()
    for (const polygon of polygons) {
      const geoJsonLayer = L.geoJSON(polygon.geometry as unknown as GeoJSON.GeoJsonObject, {
        style: {
          // 枠線を塗りと同じ色にすると、隣接する国同士(例: フランスとベルギー)が
          // 境目の無い1つの塊に見えてしまう。枠線だけ白で分離してコントラストを出す
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.9,
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

    if (viewOverride) {
      // 国境ポリゴンの生boundsに単純にfitBoundsすると、一部の国(例: フランス本土+
      // 仏領ギアナ・レユニオン等の海外県)のように、実データ上は同じ1国の
      // MultiPolygonでも地理的に大陸をまたいで遠く離れた飛び地を含む場合があり、
      // その飛び地までbounds計算に含まれて地図が異常に引いて見えてしまう
      // (実データで確認済み)。大陸段階では代わりに、その大陸のおおよその中心へ
      // 固定ズームで移動する(親コンポーネントが指定)
      map.setView(viewOverride.center, viewOverride.zoom)
    } else if (markers.length > 0 || polygons.length > 0) {
      map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
    }

    // レイヤーがちょうど揃った直後(特に非同期フェッチでpolygonsが後から届いた時)に
    // 現在のfocusIdへ改めてフォーカスする。focusId自体は変わっていないことが多いため
    // 依存配列には含めない — 含めると、フォーカス対象が変わるたびにこの重い
    // レイヤー再構築エフェクト全体が再実行され、ユーザーの手動パン/ズームを
    // 巻き戻してしまう(このコンポーネントを渡すmarkers/polygonsはArtistOriginMap側で
    // useMemoにより安定した参照になっているため、この効果自体は本当にレイヤーの
    // 中身が変わった時だけ発火する)。
    applyFocus(focusId)

    return () => {
      layerGroup.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, polygons, showMarkerLabels, viewOverride])

  // フォーカス対象自体が変化した時(レイヤーは既に安定している状態で、一覧の
  // 別の項目にホバー/クリックしたなど)に改めてフォーカスする。
  useEffect(() => {
    applyFocus(focusId)
  }, [focusId, applyFocus])

  return <div ref={containerRef} className={`w-full rounded-lg ${heightClassName}`} />
}
