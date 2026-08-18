import Link from 'next/link'
import { buildLabelTimeline, type LabelTimelineInput } from '@/utils/labelTimeline'
import { formatDate } from '@/utils/format'

type FounderRow = { role: string | null; person: { name: string } | { name: string }[] | null }
type RosterRow = {
  start_date: string | null
  end_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}
type CatalogRow = {
  id: string
  title: string
  release_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}
type AwardRow = {
  year: number
  category: string | null
  result: string | null
  award: { name: string } | { name: string }[] | null
  artist: { name: string } | { name: string }[] | null
  album: { title: string } | { title: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  founded: '🏷️',
  founder: '👤',
  joined: '➕',
  left: '➖',
  release: '💿',
  award: '🏆',
}

export default function LabelTimeline({
  foundedYear,
  founders,
  roster,
  catalog,
  awards,
}: {
  foundedYear: number | null
  founders: FounderRow[]
  roster: RosterRow[]
  catalog: CatalogRow[]
  awards: AwardRow[]
}) {
  const input: LabelTimelineInput = {
    foundedYear,
    founders: founders.map((f) => ({ name: firstOf(f.person)?.name ?? '', role: f.role })).filter((f) => f.name),
    roster: roster
      .map((r) => {
        const artist = firstOf(r.artist)
        return artist
          ? { artistId: artist.id, artistName: artist.name, startDate: r.start_date, endDate: r.end_date }
          : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
    catalog: catalog
      .map((c) => {
        const artist = firstOf(c.artist)
        return artist
          ? { albumId: c.id, albumTitle: c.title, artistName: artist.name, releaseDate: c.release_date }
          : null
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
    awards: awards.map((a) => ({
      year: a.year,
      awardName: firstOf(a.award)?.name ?? '',
      category: a.category,
      result: a.result,
      subjectName: firstOf(a.artist)?.name ?? firstOf(a.album)?.title ?? '',
    })),
  }

  const entries = buildLabelTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <ul className="mt-4 space-y-3 border-l border-white/10 pl-4 text-sm">
      {entries.map((entry, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[21px] top-0.5 text-xs">{KIND_ICON[entry.kind]}</span>
          <span className="text-xs text-white/40">{formatDate(entry.date)}</span>{' '}
          {entry.href ? (
            <Link href={entry.href} className="text-white/80 hover:text-white">
              {entry.title}
            </Link>
          ) : (
            <span className="text-white/80">{entry.title}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
