import Link from 'next/link'
import { buildArtistTimeline, type ArtistTimelineInput } from '@/utils/artistTimeline'

type AlbumRow = { id: string; title: string; jacket_url: string | null; release_date: string | null }
type MusicEventRow = { id: string; name: string; event_date: string | null; venue: string | null }
type EventAppearanceRow = {
  id: number
  venue: string | null
  event_edition: { venue: string | null; event: { name: string } | { name: string }[] | null } | { venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
  start_time: string | null
}
type TieUpRow = {
  id: number
  usage_detail: string | null
  sync_work: { title: string; work_type: string; year: number | null } | { title: string; work_type: string; year: number | null }[] | null
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

const KIND_LABEL: Record<string, string> = {
  release: 'リリース',
  live: 'ライブ',
  festival: 'フェス',
  tieup: 'タイアップ',
}

/** アーティストの年表を文章メインの行リストとして表示する。ディスコグラフィー欄と
 * 見た目が近くなりすぎないよう、横スクロールのジャケット一覧ではなく小さな
 * サムネイル+日付+出来事のテキストを縦に並べる形式にしている。
 * groupByYearを立てると年が変わるたびに小さな年見出しを挟む(詳細表示用)。 */
export default function ArtistTimeline({
  albums,
  musicEvents,
  eventAppearances,
  tieUps,
  groupByYear = false,
}: {
  albums: AlbumRow[]
  musicEvents: MusicEventRow[]
  eventAppearances: EventAppearanceRow[]
  tieUps: TieUpRow[]
  groupByYear?: boolean
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
        const syncWork = firstOf(t.sync_work)
        const track = firstOf(t.track)
        return syncWork && track
          ? {
              id: t.id,
              trackTitle: track.title,
              workType: syncWork.work_type,
              workTitle: syncWork.title,
              year: syncWork.year,
              usageDetail: t.usage_detail,
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

  let previousYear: string | null = null

  return (
    <div className="mt-4 divide-y divide-white/5">
      {entries.map((entry, i) => {
        const year = entry.date.slice(0, 4)
        const showYearHeading = groupByYear && year !== previousYear
        previousYear = year

        return (
          <div key={i}>
            {showYearHeading && (
              <div className="flex items-center gap-3 pt-8 first:pt-0">
                <span className="text-base font-bold text-white">{year}年</span>
                <span className="h-px flex-1 bg-white/15" />
              </div>
            )}
            <div className="flex items-center gap-2.5 py-1.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-white/5 text-xs">
                {entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover" />
                ) : (
                  <span>{KIND_ICON[entry.kind]}</span>
                )}
              </div>
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="text-xs text-white/40">{entry.date}</span>
                <span className="mx-1.5 text-white/20">・</span>
                <span className="text-[10px] text-white/40">{KIND_LABEL[entry.kind]}</span>
                <span className="mx-1.5 text-white/20">・</span>
                {entry.href ? (
                  <Link href={entry.href} className="font-medium hover:underline">
                    {entry.title}
                  </Link>
                ) : (
                  <span className="font-medium">{entry.title}</span>
                )}
                {entry.subtitle && <span className="ml-1.5 text-xs text-white/40">({entry.subtitle})</span>}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
