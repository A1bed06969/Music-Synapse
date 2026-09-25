import { Anton } from 'next/font/google'

// ホームの大型バナー(BannerShell)と同じ見出し書体・配色を、その遷移先である
// 各3カラムページの左カラム見出しにも踏襲する(2026-09-23、新譜カレンダーで
// 導入、パワープレイ&ヘビロテページでも再利用)。バナー側はピル付きだが、
// ここは既にその遷移先のページなのでピルは持たない。
const anton = Anton({ subsets: ['latin'], weight: '400' })

function EqualizerIcon({ accent }: { accent: string }) {
  const heights = [5, 10, 7, 12, 6]
  return (
    <svg width="30" height="15" viewBox="0 0 24 12" className="ml-2 inline-block align-middle" aria-hidden>
      {heights.map((h, i) => (
        <rect key={i} x={i * 5} y={12 - h} width={3} height={h} rx={1} fill={accent} opacity={0.8} />
      ))}
    </svg>
  )
}

export default function PageTitleHeading({
  index,
  titleLines,
  accent,
  description,
}: {
  index: string
  titleLines: [string, string]
  accent: string
  description?: string
}) {
  return (
    <div>
      <span className="text-sm font-bold tracking-[0.2em]" style={{ color: accent }}>
        {index}
        <EqualizerIcon accent={accent} />
      </span>
      <h1 className={`${anton.className} mt-2 text-4xl leading-[0.95] tracking-tight sm:text-5xl`}>
        {titleLines[0]}
        <br />
        {titleLines[1]}
      </h1>
      {description && <p className="mt-4 text-sm text-white/50">{description}</p>}
    </div>
  )
}
