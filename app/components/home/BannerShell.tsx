import Link from 'next/link'
import { Anton } from 'next/font/google'
import type { ReactNode } from 'react'

// 参考デザインの太く縦長な見出し書体に寄せるための表示専用フォント。
// サイト全体のGeist Sansには影響させず、このバナーの見出しだけに使う。
const anton = Anton({ subsets: ['latin'], weight: '400' })

// 「01/02/03」の横に添える小さなイコライザー(波形)アイコン。バーの高さを
// ランダムっぽく散らして音楽メディアらしいアクセントにする。
function EqualizerIcon({ accent }: { accent: string }) {
  const heights = [5, 10, 7, 12, 6]
  return (
    <svg width="24" height="12" viewBox="0 0 24 12" className="ml-1.5 inline-block align-middle" aria-hidden>
      {heights.map((h, i) => (
        <rect key={i} x={i * 5} y={12 - h} width={3} height={h} rx={1} fill={accent} opacity={0.8} />
      ))}
    </svg>
  )
}

function CalendarIcon({ accent }: { accent: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke={accent} strokeWidth="1.8" />
      <path d="M3 9H21" stroke={accent} strokeWidth="1.8" />
      <path d="M8 3V6" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 3V6" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** 3つのTOPページ大型バナー共通の「左固定/右可変」グリッド。
 * 左側(index/title/subtitle/date)はデータに関わらずレイアウトが変わらない。
 * 右側だけをDB由来の内容(children)に差し替える。 */
export default function BannerShell({
  index,
  titleLines,
  subtitle,
  dateEyebrow,
  dateLabel,
  eyebrow,
  eyebrowHref,
  accent,
  children,
}: {
  index: string
  titleLines: [string, string]
  subtitle: string
  dateEyebrow: string
  dateLabel: string
  eyebrow: string
  eyebrowHref: string
  accent: string
  children: ReactNode
}) {
  return (
    <div
      className="animate-banner-in overflow-hidden rounded-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.35)]"
      style={{ background: 'linear-gradient(160deg, #101010 0%, #050505 65%)' }}
    >
      {/* タイトルは折り返さず横一列(矢印の向き)に展開し、余った縦幅を下の
       * 画像エリアに回す。件名行と副題/日付行を分け、eyebrowピルもここに集約する */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-white/5 px-4 pt-4 sm:px-6 sm:pt-6 md:px-8">
        <Link href={eyebrowHref} className="group flex min-w-0 items-center gap-2 sm:gap-3">
          <span
            className="shrink-0 text-[11px] font-bold tracking-[0.15em] sm:text-sm sm:tracking-[0.2em]"
            style={{ color: accent }}
          >
            {index}
            <EqualizerIcon accent={accent} />
          </span>
          <h2
            className={`${anton.className} whitespace-nowrap text-lg leading-none tracking-tight transition group-hover:opacity-80 sm:text-3xl md:text-4xl`}
          >
            {titleLines[0]} {titleLines[1]}
          </h2>
        </Link>
        <Link
          href={eyebrowHref}
          className="shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-medium tracking-wide backdrop-blur transition hover:bg-white/10 sm:px-3 sm:text-[11px]"
          style={{ borderColor: `${accent}55`, color: accent, backgroundColor: `${accent}14` }}
        >
          {eyebrow} →
        </Link>
      </div>
      <Link
        href={eyebrowHref}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pb-3 pt-2 transition hover:opacity-80 sm:px-6 md:px-8"
      >
        <p className="truncate text-xs text-white/50 sm:text-sm">{subtitle}</p>
        <p className="flex shrink-0 items-center gap-1.5 text-[10px] tracking-wide text-white/40 sm:text-xs">
          <CalendarIcon accent={accent} />
          <span className="font-bold tracking-[0.1em]" style={{ color: accent }}>
            {dateEyebrow}
          </span>
          <span className="text-white/25">·</span>
          {dateLabel}
        </p>
      </Link>

      <div className="relative flex items-center justify-center px-2 pb-4 pt-2 sm:px-4 sm:pb-6 md:pb-8">{children}</div>
    </div>
  )
}
