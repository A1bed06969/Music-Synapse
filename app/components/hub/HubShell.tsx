import type { ReactNode } from 'react'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import { anton } from '@/app/components/detail/displayFont'
import { hubContent, type HubKey } from './hubContents'

export type HubStat = { label: string; value: string | number }

export function HubIdentity({ hubKey, stats = [] }: { hubKey: HubKey; stats?: HubStat[] }) {
  const c = hubContent(hubKey)
  return (
    <div className="pb-3 lg:pb-4">
      <div className="flex items-end gap-3">
        <span className={`${anton.className} text-6xl leading-none lg:text-7xl`} style={{ color: c.color }}>
          {c.number}
        </span>
        <span className="mb-2 h-0.5 flex-1" style={{ background: `linear-gradient(90deg, ${c.color}, transparent)` }} />
      </div>
      <h1 className={`${anton.className} mt-4 text-[44px] leading-[1.02] text-white lg:text-[52px]`}>
        {c.heading[0]}
        <br />
        {c.heading[1]}
      </h1>
      <p className="mt-4 text-sm font-bold tracking-wide" style={{ color: c.color }}>
        {c.tagline}
      </p>
      {stats.length === 1 && (
        // 件数が1つだけのときは枠を作らず、数字とラベルを1行に並べて場所を取らないようにする
        <p className="mt-4 flex items-baseline gap-2.5 border-l-2 pl-3" style={{ borderColor: c.color }}>
          <span className={`${anton.className} text-3xl leading-none`} style={{ color: c.color }}>
            {stats[0].value}
          </span>
          <span className="text-xs tracking-wide text-white/60">{stats[0].label}</span>
        </p>
      )}
      {stats.length > 1 && (
        <dl className="mt-5 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border px-3 py-2.5" style={{ borderColor: `${c.color}55`, backgroundColor: `${c.color}12` }}>
              <dd className={`${anton.className} text-2xl leading-none`} style={{ color: c.color }}>
                {s.value}
              </dd>
              <dt className="mt-1.5 text-[11px] tracking-wide text-white/60">{s.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** トップの6連載それぞれのページ共通の3カラム。アーティスト・アルバム・トラック詳細と同じ DetailPageShell の上に、
 * LEFT=番号・Anton見出し・コピー・件数(連載の色)、CENTER=ページ本体、RIGHT=6連載の目次(色つき)を置く。 */
export default function HubShell({
  hubKey,
  stats = [],
  leftExtra,
  rightExtra,
  navVariant = 'list',
  mobileContent,
  children,
}: {
  hubKey: HubKey
  stats?: HubStat[]
  /** LEFTの件数の下に足すもの(ビジュアル・補足文など) */
  leftExtra?: ReactNode
  /** RIGHTの目次の下に足すもの(そのページ固有の切り替え・凡例など) */
  rightExtra?: ReactNode
  navVariant?: 'list' | 'grid'
  /** モバイルを縦積みではなく独自構成にしたいページ向け(DetailPageShellへそのまま渡す) */
  mobileContent?: ReactNode
  children: ReactNode
}) {
  const left = (
    <>
      <HubIdentity hubKey={hubKey} stats={stats} />
      {leftExtra && <div className="pb-6 lg:pb-10">{leftExtra}</div>}
    </>
  )

  const right = rightExtra ? <div className="pb-8">{rightExtra}</div> : undefined

  return <DetailPageShell left={left} center={children} right={right} mobileContent={mobileContent} />
}
