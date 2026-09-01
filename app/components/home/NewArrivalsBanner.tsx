import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import type { NewArrivalsSummary } from '@/utils/newArrivals'

const STATS: {
  key: 'artistCount' | 'albumCount' | 'trackCount' | 'eventCount' | 'curationCount'
  label: string
  tab: string
}[] = [
  { key: 'artistCount', label: 'アーティスト', tab: 'artist' },
  { key: 'albumCount', label: 'アルバム', tab: 'album' },
  { key: 'trackCount', label: 'トラック', tab: 'track' },
  { key: 'eventCount', label: 'フェス', tab: 'festival' },
  { key: 'curationCount', label: 'キュレーション', tab: 'curation' },
]

export default function NewArrivalsBanner({ summary }: { summary: NewArrivalsSummary }) {
  const total =
    summary.artistCount + summary.albumCount + summary.trackCount + summary.eventCount + summary.curationCount
  const nonZeroStats = STATS.filter((s) => summary[s.key] > 0)

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <Link href="/new-arrivals" className="group flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Sparkles size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-white group-hover:opacity-70">新着情報</p>
          <p className="text-xs text-white/40">
            {total > 0 ? `今日の8時から${total}件追加されました` : '今日の8時からの新着はまだありません'}
          </p>
        </div>
      </Link>

      {nonZeroStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nonZeroStats.map((s) => (
            <Link
              key={s.key}
              href={`/new-arrivals?tab=${s.tab}`}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70 transition hover:border-white/25 hover:text-white"
            >
              {s.label} <span className="font-semibold text-emerald-300">{summary[s.key]}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
