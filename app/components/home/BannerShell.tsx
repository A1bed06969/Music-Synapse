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
      <div className="grid grid-cols-[34%_66%] sm:grid-cols-[30%_70%]">
        <Link
          href={eyebrowHref}
          className="group flex flex-col justify-between gap-4 p-3 transition hover:bg-white/[0.03] sm:gap-6 sm:p-6 md:gap-10 md:p-8"
        >
          <div>
            <span className="text-xs font-bold tracking-[0.15em] sm:text-sm sm:tracking-[0.2em]" style={{ color: accent }}>
              {index}
              <EqualizerIcon accent={accent} />
            </span>
            <h2
              className={`${anton.className} mt-2 text-xl leading-[0.95] tracking-tight transition group-hover:opacity-80 sm:mt-3 sm:text-4xl md:text-5xl`}
            >
              {titleLines[0]}
              <br />
              {titleLines[1]}
            </h2>
            <p className="mt-2 text-xs text-white/50 sm:mt-3 sm:text-sm">{subtitle}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-[0.1em] sm:text-xs sm:tracking-[0.15em]" style={{ color: accent }}>
              {dateEyebrow}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[10px] tracking-wide text-white/40 sm:mt-1.5 sm:gap-1.5 sm:text-xs">
              <CalendarIcon accent={accent} />
              {dateLabel}
            </p>
          </div>
        </Link>

        <div className="relative border-l border-white/5 p-3 pt-10 sm:p-6 sm:pt-14 md:p-8 md:pt-16">
          <Link
            href={eyebrowHref}
            className="absolute right-3 top-3 z-10 rounded-full border px-2 py-1 text-[9px] font-medium tracking-wide backdrop-blur transition hover:bg-white/10 sm:right-6 sm:top-6 sm:px-3 sm:text-[11px] md:right-8 md:top-8"
            style={{ borderColor: `${accent}55`, color: accent, backgroundColor: `${accent}14` }}
          >
            {eyebrow} →
          </Link>
          {children}
        </div>
      </div>
    </div>
  )
}
