import Link from 'next/link'
import BannerShell from './BannerShell'
import type { UpcomingAlbumCard } from '@/utils/homeCards'

const ACCENT = '#5b8def'
const ROTATIONS = [-6, 3, -3, 5, -4, 2]

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function DiscoverNewMusicBanner({ albums }: { albums: UpcomingAlbumCard[] }) {
  const dateLabel =
    albums.length > 0
      ? `${formatShortDate(albums[0].releaseDate)} 以降のリリース`
      : '近日リリース情報を準備中'

  return (
    <BannerShell
      index="01"
      titleLines={['Discover', 'New Music']}
      subtitle="今週の新譜ピックアップ"
      dateEyebrow="UPCOMING"
      dateLabel={dateLabel}
      eyebrow="NEW RELEASES"
      eyebrowHref="/albums/calendar"
      accent={ACCENT}
    >
      {albums.length === 0 ? (
        <p className="text-sm text-white/30">近日リリース予定の新譜はまだ登録されていません。</p>
      ) : (
        // ページ送り(ドット)方式だと、続きを見ようとした横スワイプが「次のセットへ
        // ジャンプ」と衝突して操作しづらかったため、1本の長い横スクロールに統一する。
        // 画像行とキャプション行を同じスクロールコンテナに入れて連動させる
        // (別々にoverflow-x-autoを持たせるとズレて操作できてしまうため)。
        <div className="overflow-x-auto pb-1 pl-1 pt-2">
          <div style={{ width: 'max-content' }}>
            <div className="flex items-end">
              {albums.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/albums/${a.id}`}
                  className={`group relative block w-28 shrink-0 transition-transform duration-200 hover:z-20 hover:-translate-y-2 sm:w-32 ${
                    i > 0 ? '-ml-6 sm:-ml-8' : ''
                  }`}
                  style={{ transform: `rotate(${ROTATIONS[i % ROTATIONS.length]}deg)`, zIndex: i }}
                >
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5 shadow-lg shadow-black/50 ring-1 ring-white/10 transition group-hover:ring-white/40">
                    {a.jacketUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.jacketUrl} alt={a.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                        No Art
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-3 flex gap-3">
              {albums.map((a) => (
                <Link key={a.id} href={`/albums/${a.id}`} className="group block w-28 shrink-0 sm:w-32">
                  <p className="truncate text-xs font-medium text-white/80 group-hover:text-white">{a.title}</p>
                  <p className="truncate text-[11px] text-white/40">{a.artistName}</p>
                  <p className="text-[10px] text-white/25">{formatShortDate(a.releaseDate)}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </BannerShell>
  )
}
