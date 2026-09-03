import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, formatDuration, STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, type AlbumType } from '@/utils/albumType'
import PreviewButton from '@/app/components/PreviewButton'
import CurationTags from '@/app/components/CurationTags'

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
      // タワレコメン等の「順位のない選出企画」に選ばれているかどうか。
      // ranking_entryはtrack_id経由でも紐づき得るが、選出系企画はアルバム単位が
      // ほとんどのためalbum_idでの紐付けのみを対象にする
      supabase
        .from('ranking_entry')
        .select('ranking:ranking_id!inner(id, name, list_type, source)')
        .eq('album_id', id)
        .eq('ranking.list_type', 'selection'),
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
      {artist && (
        <Link href={`/artists/${artist.id}`} className="text-xs text-white/40 hover:text-white/70">
          ← {artist.name}
        </Link>
      )}

      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <div className="w-full max-w-xs shrink-0 sm:w-56">
          <div className="overflow-hidden rounded-md bg-white/5">
            {album.jacket_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={album.jacket_url} alt={album.title} className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center text-white/20">
                No Art
              </div>
            )}
          </div>
          {album.tower_url && (
            <a
              href={album.tower_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://tower.jp/favicon.ico" alt="" className="h-3.5 w-3.5" />
              TOWER RECORDS ONLINEで確認 →
            </a>
          )}
          {album.discogs_url && (
            <a
              href={album.discogs_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://www.google.com/s2/favicons?domain=discogs.com&sz=64"
                alt=""
                className="h-3.5 w-3.5"
              />
              Discogsで確認 →
            </a>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold">{album.title}</h1>
          {allArtists.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-white/60">
              {allArtists.map((a, i) => (
                <span key={a.id} className="flex items-center">
                  <Link href={`/artists/${a.id}`} className="hover:text-white">
                    {a.name}
                  </Link>
                  {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                </span>
              ))}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
            {album.album_type && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {ALBUM_TYPE_LABEL_JA[album.album_type as AlbumType] ?? album.album_type}
              </span>
            )}
            {album.format && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">{album.format}</span>
            )}
            {status && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {status.icon} {status.label}
              </span>
            )}
            <CurationTags rankings={curationRankings} />
          </div>

          <div className="mt-4 space-y-1 text-sm text-white/50">
            <p>発売日: {formatDate(album.release_date)}</p>
            {label && (
              <p>
                レーベル:{' '}
                <Link href={`/labels/${label.id}`} className="hover:text-white">
                  {label.name}
                </Link>
              </p>
            )}
            {album.track_count && <p>収録曲数: {album.track_count}曲</p>}
          </div>

          {album.jan_code && (
            <div className="mt-4 flex gap-3 text-xs">
              <a
                href={`https://www.discogs.com/search/?q=${album.jan_code}&type=release`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 px-3 py-1 text-white/60 hover:text-white"
              >
                Discogsで探す
              </a>
              <a
                href={`https://www.amazon.co.jp/s?k=${album.jan_code}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 px-3 py-1 text-white/60 hover:text-white"
              >
                Amazonで探す
              </a>
            </div>
          )}
        </div>
      </div>

      {album.album_review && (
        <p className="mt-8 text-sm leading-relaxed text-white/70">{album.album_review}</p>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">トラックリスト</h2>
        {!tracks || tracks.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだトラックが登録されていません。</p>
        ) : (
          (() => {
            // 複数枚組の場合はディスクごとに見出しを分けて表示する
            // (disc_numberが無い/全て同じ値なら通常の1枚組扱いにする)
            const discNumbers = Array.from(new Set(tracks.map((t) => t.disc_number ?? 1))).sort((a, b) => a - b)
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
                          <span className="w-5 shrink-0 text-right text-white/30">{track.track_no ?? '-'}</span>
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
