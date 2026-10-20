import BannerShell from './BannerShell'
import VisualCarousel from './VisualCarousel'
import { artworkAt } from '@/utils/artworkSize'
import type { UpcomingAlbumCard } from '@/utils/homeCards'

const ACCENT = '#5b8def'

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
        <VisualCarousel
          accent={ACCENT}
          slides={albums.map((a) => ({
            id: a.id,
            href: `/albums/${a.id}`,
            imageUrl: artworkAt(a.jacketUrl, 600),
            eyebrow: `${formatShortDate(a.releaseDate)} RELEASE`,
            title: a.title,
            sub: a.artistName,
          }))}
        />
      )}
    </BannerShell>
  )
}
