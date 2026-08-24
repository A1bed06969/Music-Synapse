import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistMediaSelections } from '@/utils/fetchArtistMediaSelections'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import ArtistTimeline from '../ArtistTimeline'

type TimelineAlbumRow = { id: string; title: string; jacket_url: string | null; release_date: string | null }
type TimelineAppearanceRow = {
  id: number
  venue: string | null
  start_time: string | null
  event_edition: { venue: string | null; event: { name: string } | { name: string }[] | null } | { venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
}

/** アーティスト年表の詳細表示。アーティスト詳細ページの簡易版年表(主要リリースのみ)
 * と違い、シングル・EPも含めた全リリースを年ごとにまとめて表示する。表示形式は
 * ArtistTimelineをgroupByYear付きで再利用し、簡易版と統一する。 */
export default async function ArtistTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: artist, error },
    { data: albums },
    { data: musicEvents },
    { data: eventAppearances },
    { data: tieUps },
    { data: awardEntries },
    mediaSelections,
  ] = await Promise.all([
    supabase.from('artist').select('id, name').eq('id', id).single(),
    buildArtistAlbumQuery<TimelineAlbumRow>(supabase, id, 'id, title, jacket_url, release_date'),
    supabase
      .from('music_event')
      .select('id, name, event_date, venue')
      .eq('artist_id', id)
      .order('event_date', { ascending: false, nullsFirst: false }),
    buildArtistAppearanceQuery<TimelineAppearanceRow>(
      supabase,
      id,
      'id, venue, start_time, event_edition:event_edition_id(venue, event:event_id(name))'
    ),
    supabase
      .from('sync_entry')
      .select('id, usage_detail, sync_work:sync_work_id(title, work_type, year), track:track_id!inner(title, album_id, artist_id)')
      .eq('track.artist_id', id),
    supabase
      .from('award_entry')
      .select('id, year, category, result, award:award_id(name)')
      .eq('artist_id', id)
      .order('year', { ascending: false }),
    fetchArtistMediaSelections(supabase, id),
  ])

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/artists/${id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name}のページに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} 年表</h1>
      <p className="mt-1 text-xs text-white/40">シングル・EPを含む全リリースを年ごとに表示しています。</p>

      <ArtistTimeline
        albums={albums ?? []}
        musicEvents={musicEvents ?? []}
        eventAppearances={eventAppearances ?? []}
        tieUps={tieUps ?? []}
        mediaSelections={mediaSelections}
        awards={(awardEntries ?? []).map((row) => {
          const award = Array.isArray(row.award) ? row.award[0] : row.award
          return {
            id: row.id,
            year: row.year,
            awardName: award?.name ?? '',
            category: row.category,
            result: row.result === 'winner' ? '受賞' : 'ノミネート',
          }
        })}
        groupByYear
      />
    </div>
  )
}
