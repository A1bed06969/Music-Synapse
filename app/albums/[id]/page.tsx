import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, formatDuration, STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, type AlbumType } from '@/utils/albumType'
import PreviewButton from '@/app/components/PreviewButton'
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import ListenLinks from '@/app/components/detail/ListenLinks'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'

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

  const [{ data: tracks }, { data: discGuideSelections }, { data: coArtistRows }, { data: curationSelections }] =
    await Promise.all([
      supabase
        .from('track')
        .select('id, disc_number, track_no, title, duration_seconds, preview_url')
        .eq('album_id', id)
        .order('disc_number', { ascending: true, nullsFirst: true })
        .order('track_no', { ascending: true }),
      supabase
        .from('disc_guide_selection')
        .select(
          'id, note, disc_guide:disc_guide_id(id, title, publisher, published_year, cover_image_url)'
        )
        .eq('album_id', id),
      supabase
        .from('album_artist')
        .select('artist_id, role, billing_order, artist:artist_id(id, name)')
        .eq('album_id', id)
        .order('billing_order', { ascending: true, nullsFirst: false }),
      // タワレコメン等の「順位のない選出企画」だけでなく、直近取り込んだ
      // Rolling Stone 500のような「順位あり」企画も含めて選出バッジを出す
      // (3ページとも selection型・ranked型の両方を表示する方針で統一)。
      // ranked型のrankはCurationTagsの表示に含めない(スコープを広げない)。
      // ranking_entryはtrack_id経由でも紐づき得るが、選出系企画はアルバム単位が
      // ほとんどのためalbum_idでの紐付けのみを対象にする
      supabase
        .from('ranking_entry')
        .select('ranking:ranking_id!inner(id, name, list_type, source)')
        .eq('album_id', id),
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

  // 見開き左のMV用。アルバム自体は動画カラムを持たないため、代表曲(未設定なら
  // track_noが最小の曲)のyoutube_video_idを借りる(設計書「データの前提」参照)
  const mvTrackId = album.representative_track_id ?? tracks?.[0]?.id ?? null
  const { data: mvTrack } = mvTrackId
    ? await supabase.from('track').select('youtube_video_id').eq('id', mvTrackId).maybeSingle()
    : { data: null }

  // 棚:同じアーティストの他の作品(このアルバムと別バージョン群は除く)。
  // 除外対象は`id`ではなく`groupAnchorId`にする必要がある。`primary_album_id IS NULL`
  // で拾われるのはバージョン群の代表盤(id === groupAnchorId)で、このアルバム自身が
  // 別バージョン側(id !== groupAnchorId)のときは`.neq('id', id)`だけでは代表盤を
  // 除外できず、「他の作品」と「その他のバージョン」の両方に同じ盤が出てしまう
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

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <BackLink
        fallbackHref={artist ? `/artists/${artist.id}` : '/albums'}
        fallbackLabel={artist ? artist.name : 'アルバム一覧に戻る'}
      />

      <StickyMiniHeader
        watchElementId="album-header"
        imageUrl={album.jacket_url}
        title={album.title}
        subtitle={artist?.name ?? null}
      />

      <div className="mt-4">
        <DetailHeader
          id="album-header"
          imageUrl={album.jacket_url}
          imageAlt={album.title}
          title={album.title}
          subtitle={
            allArtists.length > 0 ? (
              <span className="flex flex-wrap items-center gap-x-1">
                {allArtists.map((a, i) => (
                  <span key={a.id} className="flex items-center">
                    <Link href={`/artists/${a.id}`} className="hover:text-white">
                      {a.name}
                    </Link>
                    {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                  </span>
                ))}
              </span>
            ) : null
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {album.album_type && <span>{ALBUM_TYPE_LABEL_JA[album.album_type as AlbumType] ?? album.album_type}</span>}
              {album.album_type && <span>·</span>}
              <span>{formatDate(album.release_date)}</span>
              {label && (
                <>
                  <span>·</span>
                  <Link href={`/labels/${label.id}`} className="hover:text-white">
                    {label.name}
                  </Link>
                </>
              )}
              {album.track_count > 0 && (
                <>
                  <span>·</span>
                  <span>{album.track_count}曲</span>
                </>
              )}
              {album.format && (
                <>
                  <span>·</span>
                  <span>{album.format}</span>
                </>
              )}
              {status && (
                <>
                  <span>·</span>
                  <span>
                    {status.icon} {status.label}
                  </span>
                </>
              )}
            </span>
          }
          actions={
            <ListenLinks
              kind="album"
              ids={{
                appleMusicId: album.apple_music_album_id,
                spotifyId: album.spotify_album_id,
                youtubeMusicId: album.youtube_music_album_id,
                amazonMusicId: album.amazon_music_album_id,
              }}
              extraLinks={[
                ...(album.tower_url ? [{ label: 'TOWER RECORDS', href: album.tower_url }] : []),
                ...(album.discogs_url ? [{ label: 'Discogs', href: album.discogs_url }] : []),
                ...(album.jan_code
                  ? [
                      { label: 'Amazonで探す', href: `https://www.amazon.co.jp/s?k=${album.jan_code}` },
                      {
                        label: 'Discogsで探す',
                        href: `https://www.discogs.com/search/?q=${album.jan_code}&type=release`,
                      },
                    ]
                  : []),
              ]}
            />
          }
          rankings={curationRankings}
        />
      </div>

      {(() => {
        // 判定は必ずhasVisualContentで行う。<VisualSlot/>の戻り値はJSX要素なので
        // 中身が空でも常にtruthyになり、見開き解除が効かなくなる
        const showVisual = hasVisualContent({
          review: album.album_review,
          youtubeVideoId: mvTrack?.youtube_video_id ?? null,
        })

        return (
          <div className={showVisual ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className="lg:w-[46%] lg:shrink-0">
                <VisualSlot
                  review={album.album_review}
                  youtubeVideoId={mvTrack?.youtube_video_id ?? null}
                  title={album.title}
                  layout="spread"
                />
              </div>
            )}
            <section className="min-w-0 flex-1">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
                収録曲{tracks && tracks.length > 0 ? ` ${tracks.length}` : ''}
              </h2>
              {!tracks || tracks.length === 0 ? (
                <p className="mt-4 text-sm text-white/40">まだトラックが登録されていません。</p>
              ) : (
                (() => {
                  // 複数枚組の場合はディスクごとに見出しを分けて表示する
                  // (disc_numberが無い/全て同じ値なら通常の1枚組扱いにする)
                  const discNumbers = Array.from(new Set(tracks.map((t) => t.disc_number ?? 1))).sort(
                    (a, b) => a - b
                  )
                  const isMultiDisc = discNumbers.length > 1

                  return discNumbers.map((discNumber) => {
                    const discTracks = tracks.filter((t) => (t.disc_number ?? 1) === discNumber)
                    return (
                      <div key={discNumber} className="mt-4">
                        {isMultiDisc && (
                          <h3 className="text-sm font-medium text-white/50">Disc {discNumber}</h3>
                        )}
                        <ol className="divide-y divide-white/10">
                          {discTracks.map((track) => (
                            <li key={track.id} className="flex items-center gap-3 py-3 text-sm">
                              <Link
                                href={`/tracks/${track.id}`}
                                className="flex flex-1 items-center gap-4 transition hover:opacity-70"
                              >
                                <span className="w-5 shrink-0 text-right text-white/30">
                                  {track.track_no ?? '-'}
                                </span>
                                <span className="flex-1">{track.title}</span>
                                <span className="text-white/30">{formatDuration(track.duration_seconds)}</span>
                              </Link>
                              <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />
                            </li>
                          ))}
                        </ol>
                      </div>
                    )
                  })
                })()
              )}
            </section>
          </div>
        )
      })()}

      {otherWorks && otherWorks.length > 0 && artist && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {artist.name}の他の作品
          </h2>
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {otherWorks.map((work) => (
              <Link key={work.id} href={`/albums/${work.id}`} className="group w-28 shrink-0">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
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
                <p className="mt-1.5 truncate text-xs group-hover:opacity-70">{work.title}</p>
                <p className="truncate text-[10px] text-white/30">{formatDate(work.release_date)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {discGuideSelections && discGuideSelections.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">掲載ディスクガイド</h2>
          <ul className="mt-4 space-y-3 text-sm text-white/60">
            {discGuideSelections.map((row) => {
              const guide = Array.isArray(row.disc_guide) ? row.disc_guide[0] : row.disc_guide
              if (!guide) return null
              const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null]
                .filter(Boolean)
                .join(' / ')
              return (
                <li key={row.id} className="flex items-center gap-3">
                  {guide.cover_image_url && (
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

      {otherVersions && otherVersions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">その他のバージョン</h2>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {otherVersions.map((v) => (
              <Link key={v.id} href={`/albums/${v.id}`} className="group block w-28 flex-shrink-0">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {v.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.jacket_url}
                      alt={v.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">No Art</div>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{v.title}</p>
                <p className="text-xs text-white/40">{formatDate(v.release_date)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
