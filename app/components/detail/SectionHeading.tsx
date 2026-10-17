import { anton } from './displayFont'

/** 詳細ページの各セクションの見出し。6連載のカードと同じ「番号(Anton)+小見出し+横線」の形で、色はセクションごと */
export default function SectionHeading({
  number,
  label,
  color,
  right,
}: {
  number: string
  label: string
  color: string
  /** 横線の右端に添える小さなリンクなど */
  right?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex items-center gap-3 @container" style={{ color }}>
      <span className={`${anton.className} text-3xl leading-none lg:text-[40px]`}>{number}</span>
      <h2 className="shrink-0 text-xs font-bold tracking-[0.16em] lg:text-sm">{label}</h2>
      <span className="h-0.5 min-w-6 flex-1" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      {right && <span className="shrink-0 text-[11px] tracking-wide text-white/50">{right}</span>}
    </div>
  )
}
