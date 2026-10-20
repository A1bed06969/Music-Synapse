import Link from 'next/link'
import BannerShell from './BannerShell'
import { artworkAt } from '@/utils/artworkSize'
import type { DiscGuideBookCard } from '@/utils/homeCardsMore'

const ACCENT = '#f5c84c'

/** 表紙画像の無い本は、黄色い帯に書名を入れた表紙を作り、掲載盤のジャケットを並べて代わりにする */
function GeneratedCover({ book }: { book: DiscGuideBookCard }) {
  if (book.jackets.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-between bg-[#14161e] p-2.5">
        <span className="text-[9px] font-bold tracking-[0.2em] text-white/40">DISC GUIDE</span>
        <p className="line-clamp-4 text-[11px] font-black leading-snug text-white">{book.title}</p>
        <span className="h-1.5 w-full rounded-full" style={{ backgroundColor: ACCENT }} />
      </div>
    )
  }
  return (
    <div className="relative flex h-full w-full flex-col bg-[#14161e]">
      <div className="grid flex-1 grid-cols-2 gap-px bg-black/40 p-1.5 pb-0">
        {book.jackets.slice(0, 4).map((j, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={artworkAt(j, 120) ?? j} alt="" className="aspect-square w-full object-cover" loading="lazy" />
        ))}
      </div>
      <div className="px-2 py-2" style={{ backgroundColor: ACCENT }}>
        <p className="line-clamp-2 text-[10px] font-black leading-tight text-[#15130a]">{book.title}</p>
      </div>
    </div>
  )
}

export default function ClipDiscGuideBanner({ books }: { books: DiscGuideBookCard[] }) {
  const total = books.reduce((n, b) => n + b.albumCount, 0)
  return (
    <BannerShell
      index="05"
      titleLines={['Clip', 'Disc-Guide']}
      subtitle="ディスクガイドから掘り起こす一枚"
      dateEyebrow="DISC GUIDE"
      dateLabel={`${books.length}冊・${total.toLocaleString()}枚`}
      eyebrow="DISC GUIDES"
      eyebrowHref="/discguides"
      accent={ACCENT}
    >
      {books.length === 0 ? (
        <p className="text-sm text-white/30">ディスクガイドはまだ登録されていません。</p>
      ) : (
        // 本棚のように表紙を横に並べ、3冊ずつ見せて横にスライドできるようにする(本の縦横比 約 1:1.4)
        <ul className="-mx-1 flex w-full snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:thin]">
          {books.map((b) => (
            <li key={b.id} className="w-[calc((100%-1.5rem)/3)] shrink-0 snap-start">
              <Link href={`/discguides/${b.id}`} className="group block">
                <div className="relative aspect-[5/7] overflow-hidden rounded-sm shadow-[6px_8px_18px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition group-hover:-translate-y-1 group-hover:ring-white/30">
                  {b.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.coverUrl} alt={b.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <GeneratedCover book={b} />
                  )}
                  {/* 背表紙側の陰影で本らしく見せる */}
                  <span className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/45 to-transparent" />
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-snug text-white group-hover:opacity-80">{b.title}</p>
                <p className="mt-0.5 truncate text-[10px] text-white/45">
                  {[b.publisher, b.year ? `${b.year}年` : null].filter(Boolean).join(' / ')}
                </p>
                <p className="text-[10px] font-bold tabular-nums" style={{ color: ACCENT }}>
                  掲載 {b.albumCount.toLocaleString()}枚
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
