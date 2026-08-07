import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, extractYoutubeVideoId, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'

const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}

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
    { data: artist, error },
    { data: albums },
    { data: relations },
    { data: musicEvents },
    { data: eventAppearances },
    { data: externalLinks },
  ] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, album_type')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('artist_relation')
      .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
    supabase
      .from('music_event')
      .select('id, name, event_date, venue')
      .eq('artist_id', id)
      .order('event_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
      .eq('artist_id', id),
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id),
  ])

  if (error || !artist) {
    notFound()
  }

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

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

  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === id ? r.artist_id_b : r.artist_id_a)))
  )

  const [{ data: others }, { data: artistGenres }] = otherIds.length
    ? await Promise.all([
        supabase.from('artist').select('id, name').in('id', otherIds),
        supabase
          .from('artist_genre')
          .select('artist_id, genre:genre_id(name)')
          .in('artist_id', [id, ...otherIds]),
      ])
    : [{ data: [] }, { data: [] }]

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const relationNodes: RelationNode[] = otherIds.length
    ? [{ id: artist.id, name: artist.name }, ...(others ?? [])].map((a) => ({
        id: a.id,
        name: a.name,
        category: categoryByArtist.get(a.id) ?? null,
      }))
    : []
  const relationNodeIds = new Set(relationNodes.map((n) => n.id))
  const relationEdges: RelationEdge[] = (relations ?? [])
    .filter((r) => relationNodeIds.has(r.artist_id_a) && relationNodeIds.has(r.artist_id_b))
    .map((r) => ({
      source: r.artist_id_a,
      target: r.artist_id_b,
      style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
      label: r.description ?? r.relation_type,
    }))

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
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
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {artist.apple_music_artist_id && (
              <a
                href={`https://music.apple.com/jp/artist/${encodeURIComponent(artist.name)}/${artist.apple_music_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Apple Music
              </a>
            )}
            {artist.spotify_artist_id && (
              <a
                href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Spotify
              </a>
            )}
          </div>

          <div className="mt-3 flex gap-3 text-xs text-white/40">
            {artist.official_site_url && (
              <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                公式サイト
              </a>
            )}
            {artist.sns_x_url && (
              <a href={artist.sns_x_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                X
              </a>
            )}
            {artist.sns_instagram_url && (
              <a href={artist.sns_instagram_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                Instagram
              </a>
            )}
          </div>
        </div>
      </div>

      {externalLinks && externalLinks.length > 0 && (
        <>
          <SectionDivider label="External Links" />
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {externalLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
              >
                {LINK_TYPE_LABEL[link.link_type] ?? link.link_type}
              </a>
            ))}
          </div>
        </>
      )}

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
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className="group block w-28 flex-shrink-0">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {album.jacket_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={album.jacket_url}
                    alt={album.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">
                    No Art
                  </div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
              <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
            </Link>
          ))}
        </div>
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
        <RelationGraph nodes={relationNodes} edges={relationEdges} centerId={artist.id} />
      </div>
      {relationNodes.length > 0 && (
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
