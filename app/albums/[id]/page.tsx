import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, type AlbumType } from '@/utils/albumType'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import AlbumIdentityPanel, { type AlbumIdentityData } from '@/app/components/album-detail/AlbumIdentityPanel'
import AlbumCenterTabs from '@/app/components/album-detail/AlbumCenterTabs'
import CurationTags from '@/app/components/CurationTags'
import RotationModal from '@/app/components/track/RotationModal'

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: album, error } = await supabase
    .from('album')
    .select('*, artist:artist_id(id, name), label:label_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !album) {
    notFound()
  }

  const [
    { data: tracks },
    { data: discGuideSelections },
    { data: coArtistRows },
    { data: curationSelections },
    { data: radioRotationRows },
  ] = await Promise.all([
    supabase
      .from('track')
      .select('id, disc_number, track_no, title, duration_seconds, preview_url, youtube_video_id')
      .eq('album_id', id)
      .order('disc_number', { ascending: true, nullsFirst: true })
      .order('track_no', { ascending: true }),
    supabase
      .from('disc_guide_selection')
      .select('id, note, disc_guide:disc_guide_id(id, title, publisher, published_year, cover_image_url)')
      .eq('album_id', id),
    supabase
      .from('album_artist')
      .select('artist_id, role, billing_order, artist:artist_id(id, name)')
      .eq('album_id', id)
      .order('billing_order', { ascending: true, nullsFirst: false }),
    // タワレコメン等の「順位のない選出企画」だけでなく、ranked型の企画も含めて
    // 選出バッジを出す(トラック/アーティスト詳細ページと方針を統一)
    supabase
      .from('ranking_entry')
      .select('ranking:ranking_id!inner(id, name, list_type, source)')
      .eq('album_id', id),
    // パワープレイ選出(RIGHT表示用)。トラックページのrotations取得と同じ形。
    supabase
      .from('radio_rotation')
      .select(
        'id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))'
      )
      .eq('album_id', id)
      .order('period_start_date', { ascending: false }),
  ])

  const groupAnchorId = album.primary_album_id ?? album.id
  const { data: otherVersions } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date')
    .or(`id.eq.${groupAnchorId},primary_album_id.eq.${groupAnchorId}`)
    .neq('id', id)
    .order('release_date', { ascending: true, nullsFirst: false })

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label

  const { data: otherWorks } = artist
    ? await supabase
        .from('album')
        .select('id, title, jacket_url, release_date')
        .eq('artist_id', artist.id)
        .neq('id', groupAnchorId)
        .is('primary_album_id', null)
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(20)
    : { data: null }

  type ArtistRef = { id: string; name: string }
  const additionalArtists: ArtistRef[] = (coArtistRows ?? [])
    .map((row) => (Array.isArray(row.artist) ? row.artist[0] : row.artist))
    .filter((a): a is ArtistRef => a != null)
  const seenArtistIds = new Set<string>()
  const allArtists: ArtistRef[] = (artist ? [artist, ...additionalArtists] : additionalArtists).filter((a) => {
    if (seenArtistIds.has(a.id)) return false
    seenArtistIds.add(a.id)
    return true
  })
  const status = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null

  type RankingRef = { id: string; name: string; source: string | null }
  const seenRankingIds = new Set<string>()
  const curationRankings: RankingRef[] = (curationSelections ?? [])
    .map((row) => (Array.isArray(row.ranking) ? row.ranking[0] : row.ranking))
    .filter((r): r is RankingRef & { list_type: string } => r != null)
    .filter((r) => {
      if (seenRankingIds.has(r.id)) return false
      seenRankingIds.add(r.id)
      return true
    })

  const identity: AlbumIdentityData = {
    id: album.id,
    jacketUrl: album.jacket_url,
    title: album.title,
    artists: allArtists,
    albumTypeLabel: album.album_type ? (ALBUM_TYPE_LABEL_JA[album.album_type as AlbumType] ?? album.album_type) : null,
    releaseDateLabel: formatDate(album.release_date),
    label,
    trackCount: album.track_count ?? 0,
    format: album.format,
    statusLabel: status,
    listenIds: {
      appleMusicId: album.apple_music_album_id,
      spotifyId: album.spotify_album_id,
      youtubeMusicId: album.youtube_music_album_id,
      amazonMusicId: album.amazon_music_album_id,
    },
    extraLinks: [
      ...(album.tower_url ? [{ label: 'TOWER RECORDS', href: album.tower_url }] : []),
      ...(album.discogs_url ? [{ label: 'Discogs', href: album.discogs_url }] : []),
      ...(album.jan_code
        ? [
            { label: 'Amazonで探す', href: `https://www.amazon.co.jp/s?k=${album.jan_code}` },
            { label: 'Discogsで探す', href: `https://www.discogs.com/search/?q=${album.jan_code}&type=release` },
          ]
        : []),
    ],
    review: album.album_review,
  }

  const rightColumn = (
    <div className="flex flex-col gap-8">
      {discGuideSelections && discGuideSelections.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">掲載ディスクガイド</h2>
          <ul className="mt-3 space-y-3 text-sm text-white/60">
            {discGuideSelections.map((row) => {
              const guide = Array.isArray(row.disc_guide) ? row.disc_guide[0] : row.disc_guide
              if (!guide) return null
              const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null]
                .filter(Boolean)
                .join(' / ')
              return (
                <li key={row.id} className="flex items-center gap-3">
                  {guide.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={guide.cover_image_url}
                      alt={guide.title}
                      className="h-16 w-12 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <span className="text-white/80">{guide.title}</span>に掲載
                    {meta && <span className="text-white/40"> ({meta})</span>}
                    {row.note && <span className="text-white/40"> ・ {row.note}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {curationRankings.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            キュレーション・ランキング選出
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <CurationTags rankings={curationRankings} />
          </div>
        </section>
      )}

      {radioRotationRows && radioRotationRows.length > 0 && <RotationModal rotations={radioRotationRows} />}

      {otherWorks && otherWorks.length > 0 && artist && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {artist.name}の他の作品
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {otherWorks.map((work) => (
              <Link key={work.id} href={`/albums/${work.id}`} className="group flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {work.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={work.jacket_url}
                      alt={work.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs group-hover:opacity-70">{work.title}</p>
                  <p className="truncate text-[10px] text-white/30">{formatDate(work.release_date)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {otherVersions && otherVersions.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">その他のバージョン</h2>
          <div className="mt-3 flex flex-col gap-3">
            {otherVersions.map((v) => (
              <Link key={v.id} href={`/albums/${v.id}`} className="group flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {v.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.jacket_url}
                      alt={v.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                      No Art
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs group-hover:opacity-70">{v.title}</p>
                  <p className="truncate text-[10px] text-white/30">{formatDate(v.release_date)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )

  return (
    <>
      <div className="px-6 pt-3 lg:px-8">
        <BackLink
          fallbackHref={artist ? `/artists/${artist.id}` : '/albums'}
          fallbackLabel={artist ? artist.name : 'アルバム一覧に戻る'}
        />
      </div>
      <StickyMiniHeader
        watchElementId="album-header"
        imageUrl={album.jacket_url}
        title={album.title}
        subtitle={artist?.name ?? null}
      />
      <DetailPageShell
        left={<AlbumIdentityPanel data={identity} />}
        center={
          <AlbumCenterTabs
            tracks={tracks ?? []}
            representativeTrackId={album.representative_track_id}
            albumTitle={album.title}
          />
        }
        right={rightColumn}
      />
    </>
  )
}
