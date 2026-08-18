import Link from 'next/link'
import { buildArtistTimeline, type ArtistTimelineInput } from '@/utils/artistTimeline'
import { formatDate } from '@/utils/format'

type AlbumRow = { id: string; title: string; jacket_url: string | null; release_date: string | null }
type MusicEventRow = { id: string; name: string; event_date: string | null; venue: string | null }
type EventAppearanceRow = {
  id: number
  venue: string | null
  event_edition: { venue: string | null; event: { name: string } | { name: string }[] | null } | { venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
  start_time: string | null
}
type TieUpRow = {
  id: string
  category: string
  work_title: string
  year: number | null
  track: { title: string; album_id: string | null } | { title: string; album_id: string | null }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  release: '💿',
  live: '🎤',
  festival: '🎪',
  tieup: '📺',
}

export default function ArtistTimeline({
  albums,
  musicEvents,
  eventAppearances,
  tieUps,
}: {
  albums: AlbumRow[]
  musicEvents: MusicEventRow[]
  eventAppearances: EventAppearanceRow[]
  tieUps: TieUpRow[]
}) {
  const input: ArtistTimelineInput = {
    releases: albums.map((a) => ({ albumId: a.id, title: a.title, releaseDate: a.release_date, jacketUrl: a.jacket_url })),
    lives: musicEvents.map((e) => ({ id: e.id, name: e.name, eventDate: e.event_date, venue: e.venue })),
    festivals: eventAppearances.map((row) => {
      const edition = firstOf(row.event_edition)
      const event = edition ? firstOf(edition.event) : null
      return {
        appearanceId: row.id,
        eventName: event?.name ?? '—',
        startTime: row.start_time,
        venue: row.venue ?? edition?.venue ?? null,
      }
    }),
    tieUps: tieUps
      .map((t) => {
        const track = firstOf(t.track)
        return track
          ? {
              id: t.id,
              trackTitle: track.title,
              category: t.category,
              workTitle: t.work_title,
              year: t.year,
              albumId: track.album_id,
            }
          : null
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  }

  const entries = buildArtistTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
      {entries.map((entry, i) => (
        <div key={i} className="block w-32 flex-shrink-0">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-white/5 text-2xl">
            {entry.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover" />
            ) : (
              <span>{KIND_ICON[entry.kind]}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-white/40">{formatDate(entry.date)}</p>
          {entry.href ? (
            <Link href={entry.href} className="block truncate text-sm font-medium hover:underline">
              {entry.title}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{entry.title}</p>
          )}
          {entry.subtitle && <p className="truncate text-xs text-white/40">{entry.subtitle}</p>}
        </div>
      ))}
    </div>
  )
}
