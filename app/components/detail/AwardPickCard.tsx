import Link from 'next/link'

/** 受賞・ノミネートを、メディアのキュレーション掲載(CurationPickCard)と同じ見た目で大きく見せるカード。
 * 左に賞のビジュアル、右に賞名・部門・年・受賞/ノミネートのバッジ、作品が分かっていれば添える */
export default function AwardPickCard({
  color,
  href,
  imageUrl,
  awardName,
  category,
  year,
  result,
  work,
}: {
  color: string
  href: string
  imageUrl?: string | null
  awardName: string
  category?: string | null
  year?: number | null
  result?: string | null
  work?: { title: string; href: string | null } | null
}) {
  const isWinner = result === 'winner'
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: `${color}73`, backgroundColor: `${color}12` }}>
      <div className="flex gap-4">
        <Link href={href} className="h-24 w-36 shrink-0 overflow-hidden rounded-md bg-white/5 shadow-lg hover:opacity-80">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={awardName} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl text-white/20">🏆</span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.14em]" style={{ color }}>
            AWARD ・ {isWinner ? '受賞' : result === 'nominee' ? 'ノミネート' : (result ?? '')}
          </p>
          <Link href={href} className="text-lg font-black leading-tight hover:underline">
            {awardName}
          </Link>
          {category && <p className="mt-0.5 text-xs font-bold text-white/60">{category}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {year ? <span className="font-bold tabular-nums text-white/70">{year}年</span> : null}
            {isWinner && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-black text-black" style={{ backgroundColor: color }}>
                WINNER
              </span>
            )}
          </div>
          {work && (
            <p className="mt-2 w-fit max-w-full truncate rounded-md bg-black/30 px-2.5 py-1 text-xs font-bold">
              {work.href ? (
                <Link href={work.href} className="hover:underline">
                  『{work.title}』
                </Link>
              ) : (
                <>『{work.title}』</>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
