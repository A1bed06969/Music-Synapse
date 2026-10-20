import Link from 'next/link'

/** フェス・ライブの出演を、キュレーション掲載(CurationPickCard)・受賞(AwardPickCard)と同じ見た目で大きく見せるカード。
 * 左にフェスのメインビジュアル、右にフェス名・日付/年・会場・ステージ */
export default function FestivalPickCard({
  color,
  href,
  imageUrl,
  eventName,
  dateLabel,
  venue,
  stage,
  upcoming,
}: {
  color: string
  href: string | null
  imageUrl?: string | null
  eventName: string
  /** 「2026年12月19日」「2026年」など */
  dateLabel?: string
  venue?: string | null
  stage?: string | null
  upcoming?: boolean
}) {
  const visual = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={eventName} className="h-full w-full object-cover" loading="lazy" decoding="async" />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-2xl text-white/20">🎪</span>
  )
  const frame = 'h-24 w-36 shrink-0 overflow-hidden rounded-md bg-white/5 shadow-lg'
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: `${color}73`, backgroundColor: `${color}12` }}>
      <div className="flex gap-4">
        {href ? (
          <Link href={href} className={`${frame} hover:opacity-80`}>
            {visual}
          </Link>
        ) : (
          <div className={frame}>{visual}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.14em]" style={{ color }}>
            FESTIVAL ・ {upcoming ? '出演予定' : '出演'}
          </p>
          {href ? (
            <Link href={href} className="text-lg font-black leading-tight hover:underline">
              {eventName}
            </Link>
          ) : (
            <p className="text-lg font-black leading-tight">{eventName}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {dateLabel && <span className="font-bold tabular-nums text-white/70">{dateLabel}</span>}
            {stage && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-black text-black" style={{ backgroundColor: color }}>
                {stage}
              </span>
            )}
          </div>
          {venue && <p className="mt-1 truncate text-xs text-white/50">{venue}</p>}
        </div>
      </div>
    </div>
  )
}
