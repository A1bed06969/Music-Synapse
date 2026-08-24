import Link from 'next/link'
import { buildGenreTimeline, type GenreTimelineInput } from '@/utils/genreTimeline'

type ChildGenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_year_label: string | null
  origin_country: string | null
  origin_city: string | null
  background_note: string | null
}
type HighlightRow = {
  id: number
  genre_id: string
  note: string | null
  event_year: number | null
  event_year_label: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
  album: { id: string; title: string } | { id: string; title: string }[] | null
}
type ReleaseRow = {
  id: string
  title: string
  release_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  origin: '🌱',
  derived: '↳',
  release: '💿',
  highlight: '⭐',
}

// 年代を共通の目盛りにした縦軸タイムライン(年代を縦軸、エリアを横並びの
// カラムとして配置する。各出来事はその年の実際の縦位置にプロットする)。
const HEADER_HEIGHT = 28
const TICK_COL_WIDTH = 44
const COLUMN_GAP = 24
const PX_PER_YEAR = 5
const MIN_TRACK_HEIGHT = 480
const ENTRY_SLOT_PX = 52 // 1件のラベルが縦方向に必要とする最小高さ(この間隔より近い年は別サブカラムに逃がす)
const SUB_COLUMN_WIDTH = 116

function niceTickStep(span: number): number {
  const candidates = [5, 10, 20, 25, 50, 100, 200]
  for (const step of candidates) {
    if (span / step <= 12) return step
  }
  return candidates[candidates.length - 1]
}

/** 同じカラム(エリア)内で年が近い出来事同士がラベルで重ならないよう、
 * サブカラム(横方向の列)へ貪欲法で振り分ける。戻り値は0始まりの列番号。 */
function packIntoSubColumns(entries: { pctTop: number }[], minGapPct: number): number[] {
  const columnBottomEdges: number[] = [] // 各サブカラムで直前に置いた要素の下端(%)
  const columns: number[] = []
  for (const e of entries) {
    let col = columnBottomEdges.findIndex((edge) => e.pctTop - edge >= minGapPct)
    if (col === -1) {
      col = columnBottomEdges.length
      columnBottomEdges.push(e.pctTop)
    } else {
      columnBottomEdges[col] = e.pctTop
    }
    columns.push(col)
  }
  return columns
}

export default function GenreTimeline({
  genreId,
  genreName,
  originYear,
  originYearLabel,
  originCountry,
  originCity,
  backgroundNote,
  children,
  highlights,
  releases,
}: {
  genreId: string
  genreName: string
  originYear: number | null
  originYearLabel: string | null
  originCountry: string | null
  originCity: string | null
  backgroundNote: string | null
  children: ChildGenreRow[]
  highlights: HighlightRow[]
  releases: ReleaseRow[]
}) {
  const input: GenreTimelineInput = {
    genreId,
    genreName,
    originYear,
    originYearLabel,
    originCountry,
    backgroundNote,
    children: children.map((c) => ({
      genreId: c.id,
      genreName: c.name,
      originYear: c.origin_year,
      originYearLabel: c.origin_year_label,
      originCountry: c.origin_country,
      backgroundNote: c.background_note,
    })),
    highlights: highlights
      .map((h) => {
        const artist = firstOf(h.artist)
        const album = firstOf(h.album)
        if (!artist && !album) return null
        return {
          genreId: h.genre_id,
          artistId: artist?.id ?? null,
          artistName: artist?.name ?? null,
          albumId: album?.id ?? null,
          albumTitle: album?.title ?? null,
          note: h.note,
          eventYear: h.event_year,
          eventYearLabel: h.event_year_label,
        }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null),
    releases: releases
      .map((r) => {
        const artist = firstOf(r.artist)
        return artist
          ? { albumId: r.id, albumTitle: r.title, artistName: artist.name, releaseDate: r.release_date }
          : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  }

  const groups = buildGenreTimeline(input)

  if (groups.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  // originCityは発祥国と別に取得済みだが、Wikipedia取込の現状では発祥地欄の
  // テキストがまるごとorigin_countryに入るため、都市情報が別途あるケースのみ
  // このジャンル自身の見出し行に補足として添える(エリアのグルーピング自体は
  // originCountryのテキストで行う)。
  const homeAreaNote = originCity ? `(${originCity})` : null

  const allYears = groups.flatMap((g) => g.entries.map((e) => Number(e.date.slice(0, 4))))
  const rawMin = Math.min(...allYears)
  const rawMax = Math.max(...allYears)
  const span = Math.max(rawMax - rawMin, 1)
  const pad = Math.max(Math.round(span * 0.08), 3)
  const minYear = rawMin - pad
  const maxYear = rawMax + pad
  const scaleSpan = maxYear - minYear
  const trackHeight = Math.max(Math.round(scaleSpan * PX_PER_YEAR), MIN_TRACK_HEIGHT)
  const minGapPct = (ENTRY_SLOT_PX / trackHeight) * 100

  // 年が古いほど上(0%)、新しいほど下(100%)になるよう、上から下へ進む向きにする
  const pctFor = (year: number) => ((year - minYear) / scaleSpan) * 100

  const tickStep = niceTickStep(scaleSpan)
  const ticks: number[] = []
  for (let y = Math.ceil(minYear / tickStep) * tickStep; y <= maxYear; y += tickStep) {
    ticks.push(y)
  }
  const tickGapPct = (tickStep / scaleSpan) * 100

  const columnGroups = groups.map((group) => {
    const positioned = group.entries.map((entry) => ({
      entry,
      pctTop: pctFor(Number(entry.date.slice(0, 4))),
    }))
    const subCols = packIntoSubColumns(positioned, minGapPct)
    const subColumnCount = Math.max(...subCols, 0) + 1
    return {
      area: group.area,
      subColumnCount,
      items: positioned.map((p, i) => ({ ...p, subCol: subCols[i] })),
    }
  })

  // position:stickyは「縦横どちらもこの箱の中でスクロールする」形にしないと、
  // 目盛り列(左固定)と各エリア見出し(上固定)を同時には効かせられない
  // (親要素にoverflow-x:autoだけを指定しても、CSSの仕様上overflow-yが暗黙に
  // autoへ変換され、ページ本体のスクロールに対する上固定が効かなくなるため)。
  // そのためタイムライン全体を独立したスクロール領域(縦横ともにこの中で
  // スクロール)にする。
  return (
    <div className="mt-4 overflow-auto rounded-lg border border-white/10 p-3" style={{ maxHeight: '75vh' }}>
      <div className="flex" style={{ minWidth: 'max-content' }}>
        {/* 年の目盛り列(横スクロールしても左端に固定表示、縦の目盛り線は右側の
            各カラムに共通の背景グリッドとして描画する) */}
        <div
          className="sticky left-0 z-20 shrink-0 bg-[#0a0a0a] text-[10px] text-white/40"
          style={{ width: TICK_COL_WIDTH, marginTop: HEADER_HEIGHT }}
        >
          <div className="relative" style={{ height: trackHeight }}>
            {ticks.map((y) => (
              <span key={y} className="absolute -translate-y-1/2" style={{ top: `${pctFor(y)}%` }}>
                {y}
              </span>
            ))}
          </div>
        </div>

        {columnGroups.map((col) => (
          <div
            key={col.area}
            className="shrink-0 border-l border-white/10 pl-3"
            style={{ width: col.subColumnCount * SUB_COLUMN_WIDTH, marginLeft: COLUMN_GAP }}
          >
            <h3
              className="sticky top-0 z-10 bg-[#0a0a0a] text-xs font-semibold uppercase leading-tight tracking-wide text-white/50"
              style={{ height: HEADER_HEIGHT }}
            >
              🌍 {col.area}
              {col.area === originCountry && homeAreaNote}
            </h3>
            <div
              className="relative"
              style={{
                height: trackHeight,
                backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
                backgroundSize: `100% ${tickGapPct}%`,
              }}
            >
              {col.items.map(({ entry, pctTop, subCol }, i) => (
                <div
                  key={i}
                  className="absolute flex -translate-y-1/2 items-start gap-1.5"
                  style={{ top: `${pctTop}%`, left: subCol * SUB_COLUMN_WIDTH, width: SUB_COLUMN_WIDTH }}
                >
                  <span className="shrink-0 text-xs leading-none">{KIND_ICON[entry.kind]}</span>
                  <div className="min-w-0">
                    {entry.href ? (
                      <Link
                        href={entry.href}
                        title={entry.title}
                        className="line-clamp-2 text-[10px] leading-tight text-white/80 hover:text-white"
                      >
                        {entry.title}
                      </Link>
                    ) : (
                      <span title={entry.title} className="line-clamp-2 text-[10px] leading-tight text-white/80">
                        {entry.title}
                      </span>
                    )}
                    {entry.subtitle && (
                      <p title={entry.subtitle} className="line-clamp-1 text-[9px] leading-tight text-white/40">
                        {entry.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
