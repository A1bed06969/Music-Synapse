'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/** スマホでヘッダー行が画面外に出たときだけ、上部に出る縮小版のバー。
 * ジャケットとタイトルを常に見える状態に保つ(設計書「レスポンシブ」参照)。
 * SiteHeaderが sticky top-0 z-20 なので、その下に潜り込まないよう top-14 z-10 に置く。
 * PCでは見開きの高さを稼ぐため表示しない(lg:hidden)。
 * `action`は任意のReactNodeスロット(例: トラックページの再生ボタン)。
 * このコンポーネント自体は再生の実装を知らないままにする。 */
export default function StickyMiniHeader({
  watchElementId,
  imageUrl,
  title,
  subtitle,
  action,
}: {
  watchElementId: string
  imageUrl: string | null
  title: string
  subtitle?: string | null
  action?: ReactNode
}) {
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const target = document.getElementById(watchElementId)
    if (!target) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPinned(!entry.isIntersecting)
      },
      { rootMargin: '-56px 0px 0px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [watchElementId])

  if (!pinned) return null

  return (
    <div className="fixed inset-x-0 top-14 z-10 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-6 py-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-white/45">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
