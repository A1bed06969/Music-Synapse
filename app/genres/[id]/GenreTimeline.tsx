import Link from 'next/link'
import { buildGenreTimeline, type GenreTimelineInput } from '@/utils/genreTimeline'

type ChildGenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_country: string | null
  origin_city: string | null
}
type HighlightRow = {
  id: number
  genre_id: string
  note: string | null
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

export default function GenreTimeline({
  genreId,
  genreName,
  originYear,
  originCountry,
  originCity,
  children,
  highlights,
  releases,
}: {
  genreId: string
  genreName: string
  originYear: number | null
  originCountry: string | null
  originCity: string | null
  children: ChildGenreRow[]
  highlights: HighlightRow[]
  releases: ReleaseRow[]
}) {
  const input: GenreTimelineInput = {
    genreId,
    genreName,
    originYear,
    originPlace: [originCountry, originCity].filter(Boolean).join(' / ') || null,
    children: children.map((c) => ({
      genreId: c.id,
      genreName: c.name,
      originYear: c.origin_year,
      originPlace: [c.origin_country, c.origin_city].filter(Boolean).join(' / ') || null,
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

  const entries = buildGenreTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <ul className="mt-4 space-y-3 border-l border-white/10 pl-4 text-sm">
      {entries.map((entry, i) => {
        const year = entry.date.slice(0, 4)
        const prevYear = i > 0 ? entries[i - 1].date.slice(0, 4) : null
        return (
          <li key={i} className={entry.indent ? 'ml-4' : undefined}>
            {year !== prevYear && <p className="-ml-4 mb-1 text-xs font-semibold text-white/40">{year}</p>}
            <div className="relative">
              <span className="absolute -left-[21px] top-0.5 text-xs">{KIND_ICON[entry.kind]}</span>
              {entry.href ? (
                <Link href={entry.href} className="text-white/80 hover:text-white">
                  {entry.title}
                </Link>
              ) : (
                <span className="text-white/80">{entry.title}</span>
              )}
              {entry.subtitle && <span className="ml-2 text-xs text-white/40">{entry.subtitle}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
