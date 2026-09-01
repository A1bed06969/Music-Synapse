import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import type { NewArrivalsSummary } from '@/utils/newArrivals'

const STATS: { key: 'artistCount' | 'albumCount' | 'trackCount' | 'eventCount' | 'curationCount'; label: string }[] = [
  { key: 'artistCount', label: 'アーティスト' },
  { key: 'albumCount', label: 'アルバム' },
  { key: 'trackCount', label: 'トラック' },
  { key: 'eventCount', label: 'イベント' },
  { key: 'curationCount', label: 'キュレーション' },
]

export default function NewArrivalsBanner({ summary }: { summary: NewArrivalsSummary }) {
  const total =
    summary.artistCount + summary.albumCount + summary.trackCount + summary.eventCount + summary.curationCount
  const nonZeroStats = STATS.filter((s) => summary[s.key] > 0)

  return (
    <Link
      href="/new-arrivals"
      className="group flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Sparkles size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">新着情報</p>
          <p className="text-xs text-white/40">
            {total > 0 ? `今日の8時から${total}件追加されました` : '今日の8時からの新着はまだありません'}
          </p>
        </div>
      </div>

      {nonZeroStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nonZeroStats.map((s) => (
            <span
              key={s.key}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70"
            >
              {s.label} <span className="font-semibold text-emerald-300">{summary[s.key]}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
