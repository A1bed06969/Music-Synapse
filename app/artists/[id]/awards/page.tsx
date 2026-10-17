// app/artists/[id]/awards/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistRankingAwardRows } from '@/utils/artistDetailCounts'
import SectionHeading from '@/app/components/detail/SectionHeading'
import AwardPickCard from '@/app/components/detail/AwardPickCard'
import { headingOf } from '@/app/components/artist-detail/artistSections'

const AWARD_COLOR = headingOf('awards').color

type AwardEntryRow = {
  id: string
  year: number | null
  category: string | null
  result: string | null
  work_title: string | null
  award: AwardInfo | AwardInfo[] | null
  album: { id: string; title: string } | { id: string; title: string }[] | null
  track: { id: string; title: string } | { id: string; title: string }[] | null
}

type AwardInfo = { id: string; name: string; image_url: string | null }

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function AwardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const rows = await fetchArtistRankingAwardRows<AwardEntryRow>(
    supabase,
    'award_entry',
    id,
    'id, year, category, result, work_title, award:award_id(id, name, image_url), album:album_id(id, title), track:track_id(id, title)',
    { orderBy: { column: 'year', ascending: false } }
  )

  return (
    <div>
      <SectionHeading {...headingOf('awards')} />
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">受賞・ノミネート歴はありません。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((row) => {
            const award = firstOf(row.award)
            if (!award) return null
            const album = firstOf(row.album)
            const track = firstOf(row.track)
            // Wikidata にラベルが無い作品はQ番号のまま入ってくるので、作品名としては出さない
            const rawTitle = row.work_title && !/^Q\d+$/.test(row.work_title) ? row.work_title : null
            const title = rawTitle ?? album?.title ?? track?.title ?? null
            const workHref = album ? `/albums/${album.id}` : track ? `/tracks/${track.id}` : null
            return (
              <li key={row.id}>
                <AwardPickCard
                  color={AWARD_COLOR}
                  href={`/chronology/awards?award=${award.id}`}
                  imageUrl={award.image_url}
                  awardName={award.name}
                  category={row.category}
                  year={row.year}
                  result={row.result}
                  work={title ? { title, href: workHref } : null}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
