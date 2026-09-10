// app/artists/[id]/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import { findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'
import { fetchArtistRankingAwardRows } from '@/utils/artistDetailCounts'

type OverviewAlbumRow = {
  id: string
  title: string
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
}

type ScoredTrackRow = {
  track_id: string
  track:
    | { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null }
    | { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null }[]
    | null
}

type ArtistAppearanceRow = {
  id: number
  venue: string | null
  start_time: string | null
  event_edition: { year: number | null; event: { name: string } | { name: string }[] | null } | { year: number | null; event: { name: string } | { name: string }[] | null }[] | null
}

type RankingEmbed = {
  id: string
  name: string
  list_type: string | null
  image_url: string | null
  source_url: string | null
}

type OverviewRankingEntryRow = {
  id: string
  period_date: string | null
  ranking: RankingEmbed | RankingEmbed[] | null
}

type OverviewAwardEntryRow = {
  id: string
  year: number | null
  result: string | null
  award: { name: string } | { name: string }[] | null
}

type OverviewRadioRotationRow = {
  id: string
  title: string | null
  jacketUrl: string | null
  href: string | null
  date: string | null
  mediaName: string | null
  programName: string | null
}

type RadioRotationMediaProgramEmbed =
  | { program_name: string | null; media: { name: string } | { name: string }[] | null }
  | { program_name: string | null; media: { name: string } | { name: string }[] | null }[]
  | null

function radioRotationMediaLabel(program: RadioRotationMediaProgramEmbed): { mediaName: string | null; programName: string | null } {
  const p = firstOf(program)
  const media = p ? firstOf(p.media) : null
  return { mediaName: media?.name ?? null, programName: p?.program_name ?? null }
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type RankingCurationEntry = {
  id: string
  label: string
  periodLabel: string
  imageUrl: string | null
  sourceUrl: string | null
}

/** Ranking/Curationセクション共通の1件表示。ranking.image_url(企画自体の
 * メインビジュアル)をジャケット代わりに使い、ranking.source_url(元記事)が
 * あれば外部リンクにする(この2つはRADAR等一部の企画でnullになりうる)。 */
function RankingListItem({ entry }: { entry: RankingCurationEntry }) {
  const content = (
    <div className="flex gap-4">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white/5">
        {entry.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm">{entry.label}</p>
        {entry.periodLabel && <p className="mt-0.5 text-xs text-white/40">{entry.periodLabel}</p>}
      </div>
    </div>
  )
  return entry.sourceUrl ? (
    <a
      href={entry.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group -m-1 block rounded-md p-1 hover:bg-white/5"
    >
      {content}
    </a>
  ) : (
    content
  )
}

export default async function ArtistOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // ranking_entry/award_entryはartist_id/album_id/track_idのいずれかで紐づく
  // (直接artist_idだけでは本番データの過半数を取り逃す。utils/artistDetailCounts.ts
  //  のfetchArtistRankingAwardRows参照)ため、専用ヘルパーで3方向の行を集めて使う。
  const [
    { data: albums },
    [{ data: rotationRows }, { data: rankingRows }],
    { data: appearanceRows },
    { items: newsItems },
    rankingEntries,
    awardEntries,
    [{ data: radioByTrack }, { data: radioByAlbum }],
  ] = await Promise.all([
    buildArtistAlbumQuery<OverviewAlbumRow>(supabase, id, 'id, title, jacket_url, release_date, streaming_status'),
    Promise.all([
      supabase
        .from('radio_rotation')
        .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
        .eq('track.artist_id', id)
        .overrideTypes<ScoredTrackRow[], { merge: false }>(),
      supabase
        .from('ranking_entry')
        .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
        .eq('track.artist_id', id)
        .overrideTypes<ScoredTrackRow[], { merge: false }>(),
    ]),
    buildArtistAppearanceQuery<ArtistAppearanceRow>(
      supabase,
      id,
      'id, venue, start_time, event_edition:event_edition_id(year, event:event_id(name))'
    ),
    fetchCachedNews(),
    // list_type('ranked'/'selection')で後段でRanking/Curationに振り分けるため、
    // 表示件数(各2件)より多めに取得しておく(過半数がselectionに偏っていても
    // rankedの実例を取りこぼさないように)。
    fetchArtistRankingAwardRows<OverviewRankingEntryRow>(
      supabase,
      'ranking_entry',
      id,
      'id, period_date, ranking:ranking_id!inner(id, name, list_type, image_url, source_url)',
      { orderBy: { column: 'period_date', ascending: false }, limit: 10 }
    ),
    fetchArtistRankingAwardRows<OverviewAwardEntryRow>(
      supabase,
      'award_entry',
      id,
      'id, year, result, award:award_id(name)',
      { orderBy: { column: 'year', ascending: false }, limit: 2 }
    ),
    // fetchArtistMediaSelections(既存共有ユーティリティ)は他画面(Timeline/Radio
    // Rotationセクション)向けにトラック名/アルバム名だけを返す設計で、ジャケットや
    // リンク先を持たない。Overviewはジャケット+リンクが要件のため、同じ3方向
    // (track/album/artist直接指定)のクエリをこのページ専用に書く。
    Promise.all([
      supabase
        .from('radio_rotation')
        .select(
          'id, period_start_date, media_program:media_program_id(program_name, media:media_id(name)), track:track_id!inner(id, title, artist_id, album:album_id(jacket_url))'
        )
        .eq('track.artist_id', id)
        .order('period_start_date', { ascending: false })
        .limit(5),
      supabase
        .from('radio_rotation')
        .select(
          'id, period_start_date, media_program:media_program_id(program_name, media:media_id(name)), album:album_id!inner(id, title, jacket_url, artist_id)'
        )
        .eq('album.artist_id', id)
        .order('period_start_date', { ascending: false })
        .limit(5),
    ]),
  ])

  const { data: artistForNews } = await supabase.from('artist').select('name, name_kana, name_en').eq('id', id).single()
  const relatedNews = artistForNews
    ? findRelatedNews(
        newsItems,
        [artistForNews.name, artistForNews.name_kana, artistForNews.name_en].filter((k): k is string => Boolean(k)),
        3
      )
    : []

  // 代表曲(Popular Tracks): パワープレイ実績+ランキング選出の件数が多い順に最大5曲
  const scoreByTrackId = new Map<string, number>()
  const trackById = new Map<string, { id: string; title: string; album: { id: string; jacket_url: string | null } | null }>()
  for (const row of [...(rotationRows ?? []), ...(rankingRows ?? [])]) {
    if (!row.track_id) continue
    scoreByTrackId.set(row.track_id, (scoreByTrackId.get(row.track_id) ?? 0) + 1)
    if (!trackById.has(row.track_id)) {
      const t = Array.isArray(row.track) ? row.track[0] : row.track
      if (t) {
        const album = Array.isArray(t.album) ? t.album[0] : t.album
        trackById.set(row.track_id, { id: t.id, title: t.title, album: album ?? null })
      }
    }
  }
  const popularTracks = Array.from(trackById.values())
    .map((t) => ({ ...t, score: scoreByTrackId.get(t.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const latestRelease = (albums ?? [])[0] ?? null

  const now = new Date().toISOString()
  const upcomingLive = (appearanceRows ?? [])
    .filter((row) => row.start_time && row.start_time > now)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
    .slice(0, 3)

  // ranking.list_type: 'ranked'(順位付きランキング)と'selection'(タワレコメン・
  // RADAR等のキュレーション企画)は別物として扱う(ユーザー指摘の通り、両者を
  // 「Ranking」に混在させない)。ranking.image_url(企画自体のメインビジュアル)を
  // ジャケット代わりに、source_url(元記事)をリンク先に使う。
  const rankingWithMeta = rankingEntries
    .map((row) => {
      const ranking = firstOf(row.ranking)
      if (!ranking) return null
      return {
        id: row.id,
        label: ranking.name,
        periodLabel: row.period_date ? formatDate(row.period_date) : '',
        imageUrl: ranking.image_url,
        sourceUrl: ranking.source_url,
        listType: ranking.list_type,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
  const latestRankings = rankingWithMeta.filter((row) => row.listType === 'ranked').slice(0, 2)
  const latestCuration = rankingWithMeta.filter((row) => row.listType === 'selection').slice(0, 2)

  const latestAwards = awardEntries.map((row) => {
    const award = firstOf(row.award)
    return {
      id: row.id,
      label: award?.name ?? '—',
      periodLabel: [row.year ? `${row.year}年` : null, row.result].filter(Boolean).join(' · '),
    }
  })

  const radioRotationEntries: OverviewRadioRotationRow[] = [
    ...(radioByTrack ?? []).map((row) => {
      const track = firstOf(row.track)
      const album = track ? firstOf(track.album) : null
      return {
        id: row.id,
        title: track?.title ?? null,
        jacketUrl: album?.jacket_url ?? null,
        href: track ? `/tracks/${track.id}` : null,
        date: row.period_start_date,
        ...radioRotationMediaLabel(row.media_program),
      }
    }),
    ...(radioByAlbum ?? []).map((row) => {
      const album = firstOf(row.album)
      return {
        id: row.id,
        title: album?.title ?? null,
        jacketUrl: album?.jacket_url ?? null,
        href: album ? `/albums/${album.id}` : null,
        date: row.period_start_date,
        ...radioRotationMediaLabel(row.media_program),
      }
    }),
  ]
  const latestRadioRotation = radioRotationEntries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 3)

  if (!artistForNews) notFound()

  return (
    <div className="flex flex-col gap-10">
      {latestRelease && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Latest Release</h2>
          <Link href={`/albums/${latestRelease.id}`} className="mt-3 flex gap-4 group">
            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md bg-white/5">
              {latestRelease.jacket_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latestRelease.jacket_url} alt={latestRelease.title} className="h-full w-full object-cover transition group-hover:opacity-80" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium group-hover:underline">{latestRelease.title}</p>
              <p className="mt-1 text-xs text-white/40">{formatDate(latestRelease.release_date)}</p>
              {latestRelease.streaming_status && (
                <p className="mt-1 text-xs text-white/50">
                  {STREAMING_STATUS_LABEL[latestRelease.streaming_status]?.icon}{' '}
                  {STREAMING_STATUS_LABEL[latestRelease.streaming_status]?.label}
                </p>
              )}
            </div>
          </Link>
        </section>
      )}

      {popularTracks.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Popular Tracks</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {popularTracks.map((t, i) => (
              <li key={t.id}>
                <Link href={`/tracks/${t.id}`} className="flex items-center gap-3 py-2 text-sm hover:opacity-70">
                  <span className="w-4 shrink-0 text-xs text-white/30">{i + 1}</span>
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-white/5">
                    {t.album?.jacket_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.album.jacket_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="truncate">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcomingLive.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Upcoming Live</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {upcomingLive.map((row) => {
              const edition = firstOf(row.event_edition)
              const event = edition ? firstOf(edition.event) : null
              return (
                <li key={row.id} className="py-2 text-sm">
                  <p className="font-medium">{event?.name ?? '—'}</p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {row.start_time ? formatDate(row.start_time.slice(0, 10)) : ''}
                    {row.venue ? ` · ${row.venue}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {relatedNews.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Latest Media</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {relatedNews.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {item.title}
                </a>
                <p className="mt-0.5 text-xs text-white/40">
                  {item.source} · {formatRelativeTime(item.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {latestRankings.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Ranking</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {latestRankings.map((entry) => (
              <li key={entry.id} className="py-2">
                <RankingListItem entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {latestCuration.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Curation</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {latestCuration.map((entry) => (
              <li key={entry.id} className="py-2">
                <RankingListItem entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {latestAwards.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Awards</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {latestAwards.map((entry) => (
              <li key={entry.id} className="py-2 text-sm">
                <p>{entry.label}</p>
                {entry.periodLabel && <p className="mt-0.5 text-xs text-white/40">{entry.periodLabel}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {latestRadioRotation.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-white/40">Radio Rotation</h2>
          <ul className="mt-3 divide-y divide-white/5">
            {latestRadioRotation.map((entry) => {
              const content = (
                <div className="flex gap-4">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white/5">
                    {entry.jacketUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.jacketUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">{entry.title ?? '—'}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {entry.date ? formatDate(entry.date) : ''}
                      {entry.mediaName ? ` · ${entry.mediaName}` : ''}
                      {entry.programName ? ` ${entry.programName}` : ''}
                    </p>
                  </div>
                </div>
              )
              return (
                <li key={entry.id} className="py-2 text-sm">
                  {entry.href ? (
                    <Link href={entry.href} className="group -m-1 block rounded-md p-1 hover:bg-white/5">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
