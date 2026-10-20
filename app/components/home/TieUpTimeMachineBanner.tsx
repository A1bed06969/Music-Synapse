'use client'

// ⑩Tie-Up Time Machine: 「年のダイヤル」を回すと、その年の主題歌・挿入歌のジャケットが並ぶ。
// 時間旅行のイメージを、そのまま操作にしたバナー。年のデータは新しい年から。
import Link from 'next/link'
import { useState } from 'react'
import BannerShell from './BannerShell'
import { artworkAt } from '@/utils/artworkSize'
import type { TieUpYear } from '@/utils/homeCardsMore'

const ACCENT = '#d86bff'

export default function TieUpTimeMachineBanner({ years }: { years: TieUpYear[] }) {
  const [index, setIndex] = useState(0)
  const current = years[index]
  const totalWorks = years.reduce((n, y) => n + y.workCount, 0)
  const totalEntries = years.reduce((n, y) => n + y.entryCount, 0)

  return (
    <BannerShell
      index="10"
      titleLines={['Tie-Up', 'Time Machine']}
      subtitle="あの頃の主題歌へ、時間旅行"
      dateEyebrow="TIE-UPS"
      dateLabel={`${totalWorks.toLocaleString()}作品・${totalEntries.toLocaleString()}曲`}
      eyebrow="TIE-UPS"
      eyebrowHref="/media/sync"
      accent={ACCENT}
    >
      {!current ? (
        <p className="text-sm text-white/30">タイアップはまだ登録されていません。</p>
      ) : (
        <div className="w-full">
          {/* 年のダイヤル */}
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label="前の年へ"
              onClick={() => setIndex((i) => Math.min(years.length - 1, i + 1))}
              disabled={index >= years.length - 1}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/80 transition enabled:hover:bg-white/10 disabled:opacity-25"
            >
              ‹
            </button>
            <div className="text-center">
              <p className="text-5xl font-black leading-none tabular-nums tracking-tight" style={{ color: ACCENT, textShadow: `0 0 24px ${ACCENT}66` }}>
                {current.year}
              </p>
              <p className="mt-1 text-[11px] text-white/50">
                {current.workCount}作品・{current.entryCount}曲
              </p>
            </div>
            <button
              type="button"
              aria-label="次の年へ"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index <= 0}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/80 transition enabled:hover:bg-white/10 disabled:opacity-25"
            >
              ›
            </button>
          </div>

          {/* その年の代表曲 */}
          <ul className="mt-4 grid grid-cols-4 gap-2">
            {current.items.map((it) => (
              <li key={it.trackId} className="min-w-0">
                <Link href={`/tracks/${it.trackId}`} className="group block">
                  <div className="relative aspect-square overflow-hidden rounded-md bg-white/[0.04] ring-1 ring-white/10">
                    {it.jacketUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={artworkAt(it.jacketUrl, 200) ?? it.jacketUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                    {it.role && (
                      <span className="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[8px] font-black text-black" style={{ backgroundColor: ACCENT }}>
                        {it.role}
                      </span>
                    )}
                    <p className="absolute inset-x-0 bottom-0 truncate px-1.5 pb-1 text-[9px] font-bold text-white/90">{it.workTitle}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center">
            <Link href={`/media/sync?year=${current.year}`} className="text-xs font-bold hover:opacity-70" style={{ color: ACCENT }}>
              {current.year}年のタイアップをすべて見る →
            </Link>
          </p>
        </div>
      )}
    </BannerShell>
  )
}
