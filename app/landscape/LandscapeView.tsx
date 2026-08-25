'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react'
import { UNCLASSIFIED_COLOR } from '@/lib/landscape/genreColors'

export type LandscapeArtist = {
  artistId: string
  name: string
  imageUrl: string | null
  rootGenre: string | null
  specificGenre: string | null
  origin: string | null
  formedYear: number | null
  x: number
  y: number
  importance: number
  color: string
}

// ロジック座標([-1,1])を描画するviewBox空間([0,VIEW_W] x [0,VIEW_H])。
// ズーム/パンはこの空間の上でtranslate/scaleするだけなので、
// レスポンシブ対応(実ピクセルサイズへの変換)はSVG自体のwidth/heightに任せられる。
const VIEW_W = 1000
const VIEW_H = 720
const BASE_R = 6.5
const MIN_SCALE = 0.6
const MAX_SCALE = 8
const ALL_GENRES = '__all__'

function toViewX(x: number) {
  return ((x + 1) / 2) * VIEW_W
}
function toViewY(y: number) {
  return ((y + 1) / 2) * VIEW_H
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

type Transform = { scale: number; tx: number; ty: number }

function initialTransform(): Transform {
  return { scale: 1, tx: 0, ty: 0 }
}

// ノード描画だけを切り出したメモ化コンポーネント。ドラッグ/ホバー移動のたびに
// 発生するpointer座標の更新(親の頻繁な再レンダー)から切り離すことで、
// 799件のcircle/text(+インラインの各種イベントハンドラ)を毎フレーム
// 作り直さないようにする。これをやらないと、モバイルでのドラッグ中に
// 大量の再レンダーが積み重なりWebKitのコンテンツプロセスが応答不能になる
// (実際にモバイルSafariでクラッシュする不具合として発生した)。
const LandscapeNodes = memo(function LandscapeNodes({
  artists,
  matchedIds,
  hasQuery,
  selectedId,
  hoveredId,
  focusedId,
  zoomLevel,
  onHover,
  onUnhover,
  onFocusNode,
  onBlurNode,
  onSelect,
}: {
  artists: LandscapeArtist[]
  matchedIds: Set<string>
  hasQuery: boolean
  selectedId: string | null
  hoveredId: string | null
  focusedId: string | null
  // 生のズーム倍率(ピンチ/ホイール中は毎フレーム変わる)ではなく、離散化した
  // 段階(0/1/2)を受け取る。生の値をそのまま使うと、ピンチズーム中に799ノード
  // 全てがフレームごとに再レンダーされ、モバイルで重くなる原因になっていた
  zoomLevel: 0 | 1 | 2
  onHover: (id: string) => void
  onUnhover: (id: string) => void
  onFocusNode: (id: string) => void
  onBlurNode: (id: string) => void
  onSelect: (id: string) => void
}) {
  function shouldShowLabel(artist: LandscapeArtist): boolean {
    if (artist.artistId === selectedId) return true
    if (artist.artistId === hoveredId || artist.artistId === focusedId) return true
    if (matchedIds.has(artist.artistId)) return true
    if (zoomLevel >= 2) return true
    if (zoomLevel >= 1 && artist.importance >= 1.24) return true
    return false
  }

  return (
    <>
      {artists.map((artist) => {
        const cx = toViewX(artist.x)
        const cy = toViewY(artist.y)
        const isSearchMatch = matchedIds.has(artist.artistId)
        const isDimmedBySearch = hasQuery && !isSearchMatch
        const isDimmedByFocus = selectedId !== null && artist.artistId !== selectedId
        // 半径はワールド座標側の固定値にする(スケールに応じて割り引かない)。
        // ズームすると外側のtransform(1要素)が拡大するのでノードも自然に
        // 大きく見える。ズームごとに799件全部のrを再計算しない設計にすることで
        // ピンチ操作中の再レンダーコストを避けている
        const r = BASE_R * artist.importance * (isSearchMatch ? 1.6 : 1)
        const opacity = isDimmedBySearch ? 0.12 : isDimmedByFocus ? 0.25 : 1

        return (
          <g key={artist.artistId} opacity={opacity} className="landscape-node">
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={artist.color === UNCLASSIFIED_COLOR ? 'transparent' : artist.color}
              stroke={artist.color}
              strokeWidth={artist.color === UNCLASSIFIED_COLOR ? 1 : 0}
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`${artist.name}${artist.rootGenre ? `、${artist.rootGenre}` : '、未分類'}`}
              onMouseEnter={() => onHover(artist.artistId)}
              onMouseLeave={() => onUnhover(artist.artistId)}
              onFocus={() => onFocusNode(artist.artistId)}
              onBlur={() => onBlurNode(artist.artistId)}
              onClick={() => onSelect(artist.artistId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(artist.artistId)
                }
              }}
            />
            {(artist.artistId === selectedId || artist.artistId === focusedId) && (
              <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.8} />
            )}
            {shouldShowLabel(artist) && (
              <text
                x={cx + r + 5}
                y={cy + 3.5}
                fontSize={11}
                fill="rgba(255,255,255,0.85)"
                pointerEvents="none"
                className="landscape-label"
              >
                {artist.name}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
})

export default function LandscapeView({
  artists,
  genreOptions,
}: {
  artists: LandscapeArtist[]
  genreOptions: string[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<Transform>(initialTransform)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [genreFilter, setGenreFilter] = useState<string>(ALL_GENRES)
  const [query, setQuery] = useState('')
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 600 })

  const dragRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null)
  const pinchRef = useRef<{ startDist: number; startScale: number; midX: number; midY: number } | null>(null)

  // コンテナの実サイズは初回計測+リサイズ時だけ更新する(pointermoveの
  // たびに毎回getBoundingClientRectを呼んで再レンダーを引き起こさないため)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const rect = svg.getBoundingClientRect()
      setContainerSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const selectedArtist = useMemo(() => artists.find((a) => a.artistId === selectedId) ?? null, [artists, selectedId])

  // 生のscaleを離散段階に落とす。ピンチ/ホイールズーム中はscaleがフレームごとに
  // 動き続けるが、zoomLevelは閾値をまたいだ時だけ値が変わるため、
  // LandscapeNodes(memo化済み)への再レンダー伝播を最小限にできる
  const zoomLevel: 0 | 1 | 2 = transform.scale >= 2.6 ? 2 : transform.scale >= 1.3 ? 1 : 0

  const normalizedQuery = query.trim().toLowerCase()
  const matchedIds = useMemo(() => {
    if (!normalizedQuery) return new Set<string>()
    return new Set(artists.filter((a) => a.name.toLowerCase().includes(normalizedQuery)).map((a) => a.artistId))
  }, [artists, normalizedQuery])

  const visibleArtists = useMemo(
    () => (genreFilter === ALL_GENRES ? artists : artists.filter((a) => a.rootGenre === genreFilter)),
    [artists, genreFilter]
  )

  // viewBox単位への変換(SVGの実描画サイズに依存しないよう、要素の
  // 表示サイズとviewBoxの比率から換算する)
  const clientDeltaToViewBox = useCallback((dx: number, dy: number) => {
    const svg = svgRef.current
    if (!svg) return { dx, dy }
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { dx: 0, dy: 0 }
    return { dx: (dx * VIEW_W) / rect.width, dy: (dy * VIEW_H) / rect.height }
  }, [])
  const clientPointToViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    return { x: ((clientX - rect.left) * VIEW_W) / rect.width, y: ((clientY - rect.top) * VIEW_H) / rect.height }
  }, [])

  const zoomAt = useCallback((pointX: number, pointY: number, factor: number) => {
    setTransform((prev) => {
      const newScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE)
      const ratio = newScale / prev.scale
      return {
        scale: newScale,
        tx: pointX - (pointX - prev.tx) * ratio,
        ty: pointY - (pointY - prev.ty) * ratio,
      }
    })
  }, [])

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const pt = clientPointToViewBox(e.clientX, e.clientY)
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    zoomAt(pt.x, pt.y, factor)
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'touch') return // タッチはTouch系イベントで別処理(ピンチと衝突するため)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTx: transform.tx, startTy: transform.ty }
    setIsDragging(true)
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (rect) setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    if (!dragRef.current) return
    const { dx, dy } = clientDeltaToViewBox(e.clientX - dragRef.current.startX, e.clientY - dragRef.current.startY)
    setTransform((prev) => ({ ...prev, tx: dragRef.current!.startTx + dx, ty: dragRef.current!.startTy + dy }))
  }
  function handlePointerUp() {
    dragRef.current = null
    setIsDragging(false)
  }
  function handlePointerLeave() {
    dragRef.current = null
    setIsDragging(false)
    setPointer(null)
    setHoveredId(null)
  }

  function touchDistance(t: React.TouchList) {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.hypot(dx, dy)
  }
  function handleTouchStart(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 2) {
      const mid = clientPointToViewBox(
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2
      )
      const dist = touchDistance(e.touches)
      if (dist > 0) pinchRef.current = { startDist: dist, startScale: transform.scale, midX: mid.x, midY: mid.y }
      dragRef.current = null
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startTx: transform.tx, startTy: transform.ty }
      pinchRef.current = null
    }
  }
  function handleTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 2 && pinchRef.current) {
      const dist = touchDistance(e.touches)
      if (dist <= 0 || pinchRef.current.startDist <= 0) return
      const factor = dist / pinchRef.current.startDist
      const newScale = clamp(pinchRef.current.startScale * factor, MIN_SCALE, MAX_SCALE)
      setTransform((prev) => {
        const ratio = newScale / prev.scale
        return {
          scale: newScale,
          tx: pinchRef.current!.midX - (pinchRef.current!.midX - prev.tx) * ratio,
          ty: pinchRef.current!.midY - (pinchRef.current!.midY - prev.ty) * ratio,
        }
      })
    } else if (e.touches.length === 1 && dragRef.current) {
      const { dx, dy } = clientDeltaToViewBox(e.touches[0].clientX - dragRef.current.startX, e.touches[0].clientY - dragRef.current.startY)
      setTransform((prev) => ({ ...prev, tx: dragRef.current!.startTx + dx, ty: dragRef.current!.startTy + dy }))
    }
  }
  function handleTouchEnd(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 0) {
      dragRef.current = null
      pinchRef.current = null
    }
  }

  function zoomButton(factor: number) {
    zoomAt(VIEW_W / 2, VIEW_H / 2, factor)
  }
  function resetView() {
    setTransform(initialTransform())
    setSelectedId(null)
  }

  const handleHover = useCallback((id: string) => setHoveredId(id), [])
  const handleUnhover = useCallback((id: string) => setHoveredId((prev) => (prev === id ? null : prev)), [])
  const handleFocusNode = useCallback((id: string) => setFocusedId(id), [])
  const handleBlurNode = useCallback((id: string) => setFocusedId((prev) => (prev === id ? null : prev)), [])
  const handleSelect = useCallback((id: string) => setSelectedId(id), [])

  const hoveredArtist = artists.find((a) => a.artistId === hoveredId) ?? null

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <style>{`
        .landscape-node { transition: opacity 200ms ease; }
        .landscape-label { paint-order: stroke; stroke: #0a0a0c; stroke-width: 3px; }
      `}</style>
      {/* Genre Filter */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 p-3">
        <button
          type="button"
          onClick={() => setGenreFilter(ALL_GENRES)}
          className={`rounded-full border px-3 py-1 text-xs ${
            genreFilter === ALL_GENRES ? 'border-white bg-white text-black' : 'border-white/15 text-white/60 hover:border-white/30'
          }`}
        >
          ALL
        </button>
        {genreOptions.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGenreFilter((prev) => (prev === g ? ALL_GENRES : g))}
            className={`rounded-full border px-3 py-1 text-xs uppercase ${
              genreFilter === g ? 'border-white bg-white text-black' : 'border-white/15 text-white/60 hover:border-white/30'
            }`}
          >
            {g}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artists..."
            className="w-48 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
        </div>
      </div>

      {/* Landscape本体 */}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[520px] w-full touch-none select-none sm:h-[640px]"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ cursor: isDragging ? 'grabbing' : 'grab', background: '#0a0a0c' }}
          role="img"
          aria-label="アーティストをジャンルの近さで配置したミュージックランドスケープ"
        >
          <defs>
            <radialGradient id="landscape-vignette" cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="#141418" />
              <stop offset="100%" stopColor="#08080a" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#landscape-vignette)" />

          <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {/* 薄いグリッド(「チャート」ではなく「地図」に見えるよう控えめに) */}
            <g opacity={0.5 / Math.max(transform.scale, 1)}>
              {Array.from({ length: 9 }, (_, i) => (i + 1) * (VIEW_W / 10)).map((gx) => (
                <line key={`gx-${gx}`} x1={gx} y1={0} x2={gx} y2={VIEW_H} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              ))}
              {Array.from({ length: 6 }, (_, i) => (i + 1) * (VIEW_H / 7)).map((gy) => (
                <line key={`gy-${gy}`} x1={0} y1={gy} x2={VIEW_W} y2={gy} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              ))}
              <line x1={VIEW_W / 2} y1={0} x2={VIEW_W / 2} y2={VIEW_H} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
              <line x1={0} y1={VIEW_H / 2} x2={VIEW_W} y2={VIEW_H / 2} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            </g>

            <LandscapeNodes
              artists={visibleArtists}
              matchedIds={matchedIds}
              hasQuery={normalizedQuery.length > 0}
              selectedId={selectedId}
              hoveredId={hoveredId}
              focusedId={focusedId}
              zoomLevel={zoomLevel}
              onHover={handleHover}
              onUnhover={handleUnhover}
              onFocusNode={handleFocusNode}
              onBlurNode={handleBlurNode}
              onSelect={handleSelect}
            />
          </g>
        </svg>

        {/* Axis Labels */}
        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex justify-between text-[10px] uppercase tracking-wider text-white/30">
          <span>Organic</span>
          <span>Electronic</span>
        </div>
        <div className="pointer-events-none absolute inset-y-3 left-2 flex flex-col justify-between text-[10px] uppercase tracking-wider text-white/30">
          <span style={{ writingMode: 'vertical-rl' }}>Experimental</span>
          <span style={{ writingMode: 'vertical-rl' }}>Traditional</span>
        </div>

        {/* Zoom Controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => zoomButton(1.3)}
            aria-label="ズームイン"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-sm text-white/80 hover:bg-black/80"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomButton(1 / 1.3)}
            aria-label="ズームアウト"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-sm text-white/80 hover:bg-black/80"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="表示をリセット"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-[10px] text-white/80 hover:bg-black/80"
          >
            ⟲
          </button>
        </div>

        {/* Hover Tooltip */}
        {hoveredArtist && pointer && (
          <div
            className="pointer-events-none absolute z-20 max-w-[220px] rounded-md border border-white/15 bg-black/90 px-3 py-2 text-xs shadow-lg"
            style={{
              left: clamp(pointer.x + 14, 0, containerSize.width - 230),
              top: clamp(pointer.y + 14, 0, containerSize.height - 100),
            }}
          >
            <p className="font-semibold text-white">{hoveredArtist.name}</p>
            {hoveredArtist.rootGenre && <p className="mt-0.5 text-white/70">{hoveredArtist.rootGenre}</p>}
            {hoveredArtist.specificGenre && hoveredArtist.specificGenre !== hoveredArtist.rootGenre && (
              <p className="text-white/50">{hoveredArtist.specificGenre}</p>
            )}
            {hoveredArtist.origin && <p className="mt-0.5 text-white/40">{hoveredArtist.origin}</p>}
            {hoveredArtist.formedYear && <p className="text-white/40">{hoveredArtist.formedYear}–</p>}
          </div>
        )}

        {/* Click Drawer */}
        {selectedArtist && (
          <div className="absolute right-0 top-0 z-30 flex h-full w-64 flex-col gap-3 border-l border-white/15 bg-[#0d0d0f]/95 p-4 backdrop-blur">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="閉じる"
              className="self-end text-white/40 hover:text-white"
            >
              ✕
            </button>
            {selectedArtist.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedArtist.imageUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-md bg-white/5 text-3xl text-white/20">
                🎤
              </div>
            )}
            <p className="text-lg font-bold text-white">{selectedArtist.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {selectedArtist.rootGenre ? (
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px]"
                  style={{ borderColor: selectedArtist.color, color: selectedArtist.color }}
                >
                  {selectedArtist.rootGenre}
                </span>
              ) : (
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/40">未分類</span>
              )}
              {selectedArtist.specificGenre && selectedArtist.specificGenre !== selectedArtist.rootGenre && (
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60">
                  {selectedArtist.specificGenre}
                </span>
              )}
            </div>
            {(selectedArtist.origin || selectedArtist.formedYear) && (
              <p className="text-xs text-white/40">
                {selectedArtist.origin}
                {selectedArtist.origin && selectedArtist.formedYear ? ' ・ ' : ''}
                {selectedArtist.formedYear ? `${selectedArtist.formedYear}–` : ''}
              </p>
            )}
            <Link
              href={`/artists/${selectedArtist.artistId}`}
              className="mt-auto rounded-md border border-white/20 py-2 text-center text-sm font-semibold text-white hover:bg-white/10"
            >
              VIEW ARTIST
            </Link>
          </div>
        )}
      </div>

      <p className="border-t border-white/10 px-3 py-2 text-[11px] text-white/30">
        {visibleArtists.length} artists ・ ドラッグでパン、ホイール/ピンチでズーム
      </p>
    </div>
  )
}
