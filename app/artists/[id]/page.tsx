import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import {
  formatDate,
  extractYoutubeVideoId,
  ARTIST_STREAMING_STATUS_LABEL,
  ARTIST_TYPE_LABEL,
  STREAMING_STATUS_LABEL,
} from '@/utils/format'
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
import { resolveArtistPageKind, hasOwnRelease } from '@/utils/artistPageKind'
import MemberProfile from './MemberProfile'

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-3">
      <span className="h-1 w-1 rounded-full bg-white/40" />
      <span className="flex-1 border-t border-white/10" />
      <h2 className="text-xs uppercase tracking-wide text-white/40">{label}</h2>
    </div>
  )
}

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [
    [
      { data: artist, error },
      { data: albums },
      { data: musicEvents },
      { data: eventAppearances },
      { data: externalLinks },
      { data: awardEntries },
      { data: membershipRows },
    ],
    relationGraph,
    ownsRelease,
  ] = await Promise.all([
    Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type, streaming_status')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
      supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
      supabase
        .from('award_entry')
        .select('id, year, category, result, award:award_id(name)')
        .eq('artist_id', id)
        .order('year', { ascending: false }),
      supabase
        .from('artist_relation')
        .select(
          'id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)'
        )
        .eq('relation_type', 'membership')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
    ]),
    (async () => {
      const { data: nameRow } = await supabase.from('artist').select('name').eq('id', id).single()
      return buildArtistRelationGraph(supabase, id, nameRow?.name ?? '')
    })(),
    hasOwnRelease(supabase, id),
  ])

  if (error || !artist) {
    notFound()
  }

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

  // membershipRows には自分がバンド側(artist_id_a)・メンバー側(artist_id_b)
  // 両方のケースが混在するので、id基準でどちら向きかを判定して振り分ける
  const members: { id: string; name: string; imageUrl: string | null; description: string | null }[] = []
  const belongsToBands: { id: string; name: string; description: string | null }[] = []
  for (const row of membershipRows ?? []) {
    const band = Array.isArray(row.band) ? row.band[0] : row.band
    const member = Array.isArray(row.member) ? row.member[0] : row.member
    if (!band || !member) continue
    if (band.id === id) {
      members.push({ id: member.id, name: member.name, imageUrl: member.image_url, description: row.description })
    } else if (member.id === id) {
      belongsToBands.push({ id: band.id, name: band.name, description: row.description })
    }
  }

  const pageKind = resolveArtistPageKind(artist.page_override, belongsToBands.length > 0, ownsRelease)

  if (pageKind === 'member') {
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, artist_a:artist_id_a(id, name), artist_b:artist_id_b(id, name)')
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)

    const productions = (productionRows ?? [])
      .map((row) => {
        const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
        const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
        if (!a || !b) return null
        const other = a.id === id ? b : a
        return { id: row.id, artistId: other.id, artistName: other.name, description: row.description }
      })
      .filter((row): row is { id: number; artistId: string; artistName: string; description: string | null } => row !== null)

    return (
      <MemberProfile
        name={artist.name}
        nameKana={artist.name_kana}
        nameEn={artist.name_en}
        imageUrl={artist.image_url}
        bio={artist.bio}
        bands={belongsToBands}
        productions={productions}
      />
    )
  }

  const appearances = (eventAppearances ?? [])
    .map((row) => {
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? edition?.venue ?? null,
        isHeadliner: row.is_headliner,
        eventName: event?.name ?? '—',
        year: edition?.year ?? 0,
      }
    })
    .sort((a, b) => b.year - a.year)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <div className="mt-4 flex items-start gap-6">
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.image_url}
            alt={artist.name}
            className="h-28 w-28 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-white/5 text-3xl">
            🎤
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold">{artist.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
            {artist.name_kana && <span>{artist.name_kana}</span>}
            {artist.name_en && <span>{artist.name_en}</span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
            {artist.artist_type && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {ARTIST_TYPE_LABEL[artist.artist_type as keyof typeof ARTIST_TYPE_LABEL] ?? artist.artist_type}
              </span>
            )}
            {artist.formed_year && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                結成 {artist.formed_year}年
              </span>
            )}
            {(artist.origin_prefecture || artist.hometown_city) && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {artist.hometown_city ?? artist.origin_prefecture}
              </span>
            )}
            {artist.streaming_status && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                配信: {ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]}
              </span>
            )}
            {belongsToBands.map((band) => (
              <Link
                key={band.id}
                href={`/artists/${band.id}`}
                className="rounded-full border border-white/15 px-2.5 py-0.5 hover:bg-white/5"
              >
                🎤 {band.name} のメンバー
              </Link>
            ))}
          </div>

          <ArtistLinkIcons
            artistName={artist.name}
            officialSiteUrl={artist.official_site_url}
            snsXUrl={artist.sns_x_url}
            snsInstagramUrl={artist.sns_instagram_url}
            appleMusicArtistId={artist.apple_music_artist_id}
            spotifyArtistId={artist.spotify_artist_id}
            externalLinks={externalLinks ?? []}
          />
        </div>
      </div>

      {artist.bio && (
        <>
          <SectionDivider label="Biography" />
          <p className="mt-4 text-sm leading-relaxed text-white/70">{artist.bio}</p>
        </>
      )}

      <SectionDivider label="Live & Festivals" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-wide text-white/40">Live Info</p>
          {!musicEvents || musicEvents.length === 0 ? (
            <p className="mt-3 text-sm text-white/40">まだライブ情報がありません。</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {musicEvents.map((live) => (
                <li key={live.id}>
                  <p className="font-medium">{live.name}</p>
                  <p className="text-xs text-white/40">
                    {formatDate(live.event_date)}
                    {live.venue ? ` ・ ${live.venue}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs uppercase tracking-wide text-white/40">Festival Appearances</p>
          {appearances.length === 0 ? (
            <p className="mt-3 text-sm text-white/40">まだフェス出演歴がありません。</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {appearances.map((a) => (
                <li key={a.id}>
                  <p className="font-medium">
                    {a.eventName}
                    {a.year > 0 ? `(${a.year})` : ''}
                  </p>
                  <p className="text-xs text-white/40">
                    {a.stage ?? ''}
                    {a.venue ? ` @ ${a.venue}` : ''}
                    {a.isHeadliner ? ' ・ ★ヘッドライナー' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SectionDivider label="Discography" />
      {!albums || albums.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
      ) : (
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
          {albums.map((album) => {
            // Apple Music限定(apple_only)は自動判定できず手動設定でしか付かないため、
            // ここでは自動検知される「配信なし(未解禁・配信停止)」のみバッジ表示する
            const status = album.streaming_status === 'none' ? STREAMING_STATUS_LABEL.none : null
            return (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block w-28 flex-shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-md bg-white/5">
                  {album.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={album.jacket_url}
                      alt={album.title}
                      className={`h-full w-full object-cover transition group-hover:scale-105 ${
                        status ? 'opacity-60' : ''
                      }`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
                {status && (
                  <p className="mt-0.5 text-xs text-white/40">
                    {status.icon} {status.label}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      )}

      {members.length > 0 && (
        <>
          <SectionDivider label="Members" />
          <div className="mt-4 flex flex-wrap gap-4">
            {members.map((member) => (
              <Link
                key={member.id}
                href={`/artists/${member.id}`}
                className="group flex w-32 flex-col items-center text-center"
              >
                {member.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.imageUrl}
                    alt={member.name}
                    className="h-20 w-20 rounded-full object-cover transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-2xl">
                    🎤
                  </div>
                )}
                <p className="mt-2 truncate text-sm font-medium">{member.name}</p>
                {member.description && <p className="text-xs text-white/40">{member.description}</p>}
              </Link>
            ))}
          </div>
        </>
      )}

      {awardEntries && awardEntries.length > 0 && (
        <>
          <SectionDivider label="Awards" />
          <ul className="mt-4 space-y-2 text-sm">
            {awardEntries.map((row) => {
              const award = Array.isArray(row.award) ? row.award[0] : row.award
              return (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span>
                    {row.year} {award?.name}
                    {row.category && <span className="text-white/40"> ・ {row.category}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                      row.result === 'winner' ? 'border-amber-400/40 text-amber-300' : 'border-white/15 text-white/50'
                    }`}
                  >
                    {row.result === 'winner' ? '🏆 受賞' : 'ノミネート'}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {mvVideoId && (
        <>
          <SectionDivider label="Latest MV" />
          <div className="mt-4 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${mvVideoId}`}
              title={`${artist.name} Latest MV`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              className="h-full w-full"
            />
          </div>
        </>
      )}

      <SectionDivider label="Relation Graph" />
      <div className="mt-4 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={relationGraph.nodes} edges={relationGraph.edges} centerId={artist.id} />
      </div>
      {relationGraph.nodes.length > 0 && (
        <div className="max-w-md">
          <Link
            href={`/artists/${artist.id}/relations`}
            className="mt-2 block text-right text-xs text-white/40 hover:text-white/70"
          >
            相関図を全画面で見る →
          </Link>
        </div>
      )}
    </div>
  )
}
