import Link from 'next/link'
import BannerShell from './BannerShell'
import type { CrownData } from '@/utils/homeCardsCrown'

const ACCENT = '#ff4d5e'

export default function CrownTheWinnersBanner({ data }: { data: CrownData }) {
  return (
    <BannerShell
      index="07"
      titleLines={['Crown The', 'Winners']}
      subtitle="栄冠を手にしたのは誰だ"
      dateEyebrow="AWARDS"
      dateLabel={`${data.awardTotal}アワード・受賞${data.winnerTotal.toLocaleString()}件`}
      eyebrow="WINNERS"
      eyebrowHref="/chronology/awards"
      accent={ACCENT}
    >
      {data.winners.length === 0 ? (
        <p className="text-sm text-white/30">受賞データはまだ登録されていません。</p>
      ) : (
        <ul className="grid w-full grid-cols-2 gap-3 @md:grid-cols-3">
          {data.winners.map((w) => (
            <li key={w.id} className="min-w-0">
              <Link href={`/artists/${w.artistId}`} className="group block">
                <div className="relative aspect-square overflow-hidden rounded-lg ring-1 ring-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                  <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums text-black" style={{ backgroundColor: ACCENT }}>
                    {w.year}
                  </span>
                  <p className="absolute inset-x-0 bottom-0 truncate p-2 text-[11px] font-bold leading-tight text-white">{w.artistName}</p>
                </div>
                <p className="mt-1 truncate text-[10px] font-bold tracking-wide" style={{ color: ACCENT }}>
                  {w.awardName}
                </p>
                <p className="truncate text-[10px] text-white/45">{w.category}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
