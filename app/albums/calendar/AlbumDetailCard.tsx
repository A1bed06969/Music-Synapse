import Link from 'next/link'
import { formatDate } from '@/utils/format'
import type { RecentReleaseAlbum } from './RecentReleasesCarousel'

/** アルバム1件の詳細(アーティスト・収録曲・紹介文)。RecentReleasesCarouselの
 * フォーカス連動パネルと、右カラムでクリックされたアルバムの詳細表示の両方で
 * 使う共通の見た目。カルーセル側はジャケットを別枠(カルーセルの帯)で表示済み
 * なのでshowJacketで出し分ける。 */
export default function AlbumDetailCard({
  album,
  showJacket = false,
}: {
  album: RecentReleaseAlbum
  showJacket?: boolean
}) {
  return (
    <div key={album.id} className="animate-banner-in rounded-lg border border-white/10 bg-white/[0.02] p-4">
      {showJacket && (
        <div className="mb-4 aspect-square w-full max-w-[220px] overflow-hidden rounded-lg bg-white/5 shadow-xl shadow-black/60 ring-1 ring-white/10">
          {album.jacketUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={album.jacketUrl} alt={album.title} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">No Art</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href={`/artists/${album.artistId ?? ''}`} className="shrink-0">
            <div className="h-12 w-12 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
              {album.artistImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={album.artistImageUrl} alt={album.artistName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg text-white/20">🎤</div>
              )}
            </div>
          </Link>
          <div>
            <Link href={`/artists/${album.artistId ?? ''}`} className="text-sm font-medium text-white/80 hover:text-white">
              {album.artistName}
            </Link>
            {album.artistId && (
              <Link href={`/artists/${album.artistId}`} className="block text-xs text-white/40 hover:text-white/70">
                プロフィールを見る →
              </Link>
            )}
          </div>
        </div>
        <p className="text-xs text-white/40">{formatDate(album.releaseDate)}</p>
      </div>

      <Link href={`/albums/${album.id}`} className="mt-1 block text-lg font-bold hover:opacity-80">
        {album.title}
      </Link>

      {album.tracks.length > 0 && (
        <ol className="mt-3 max-h-64 columns-2 gap-x-4 overflow-y-auto text-sm text-white/60">
          {album.tracks.map((t) => (
            <li key={t.id} className="flex gap-2 break-inside-avoid py-0.5">
              <span className="w-5 shrink-0 text-right text-white/30">{t.trackNo ?? '-'}</span>
              <span className="min-w-0 truncate">{t.title}</span>
            </li>
          ))}
        </ol>
      )}

      {album.review ? (
        <p className="mt-3 text-sm leading-relaxed text-white/70">{album.review}</p>
      ) : (
        <p className="mt-3 text-xs text-white/25">紹介文はまだ登録されていません。</p>
      )}
    </div>
  )
}
