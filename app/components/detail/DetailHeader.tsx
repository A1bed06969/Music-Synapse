import type { ReactNode } from 'react'
import CurationTags, { type CurationRanking } from '@/app/components/CurationTags'

/** 3つの詳細ページ共通のヘッダー行。左からジャケット/写真・タイトル・属性行・
 * リンク列を並べ、右端に選出/表彰のカラムを縦線区切りで置く。
 * yoynは左に固定カラムを立てるが、こちらは横一列にして下を見開きに使う
 * (設計書「レイアウト規則」参照)。 */
export default function DetailHeader({
  imageUrl,
  imageAlt,
  imageShape = 'square',
  title,
  subtitle,
  metaLine,
  actions,
  rankings = [],
  id,
}: {
  imageUrl: string | null
  imageAlt: string
  imageShape?: 'square' | 'circle'
  title: string
  subtitle?: ReactNode
  metaLine?: ReactNode
  actions?: ReactNode
  rankings?: CurationRanking[]
  id?: string
}) {
  const rounded = imageShape === 'circle' ? 'rounded-full' : 'rounded-lg'

  return (
    <div id={id} className="flex flex-col gap-5 border-b border-white/10 pb-8 lg:flex-row lg:gap-6">
      <div className={`h-32 w-32 shrink-0 overflow-hidden bg-white/5 lg:h-40 lg:w-40 ${rounded}`}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={imageAlt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/20">No Art</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1.5 text-sm text-white/60">{subtitle}</div>}
        {metaLine && <div className="mt-2 text-xs text-white/45">{metaLine}</div>}
        {actions && <div className="mt-4">{actions}</div>}
      </div>

      {rankings.length > 0 && (
        <div className="shrink-0 lg:w-52 lg:border-l lg:border-white/10 lg:pl-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">選出・表彰</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs lg:flex-col lg:items-start">
            <CurationTags rankings={rankings} />
          </div>
        </div>
      )}
    </div>
  )
}
