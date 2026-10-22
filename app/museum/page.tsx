import Link from 'next/link'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { fetchGalleryPicks } from '@/utils/museumData'
import { createClient } from '@/utils/Supabase/server'

export const metadata = { title: 'Art Work Museum | Music Synapse' }

const ROOMS = [
  { head: '色で探す', body: 'ジャケットの色から、同じ色合いの作品を並べます。' },
  { head: '描いた人で探す', body: 'イラストレーター・アートディレクター・写真家から、手がけた作品をたどります。' },
  { head: '時代で探す', body: '発売年ごとに、ジャケットのデザインの移り変わりを見ます。' },
  { head: 'ジャンルで探す', body: 'ジャンルごとの、ジャケットの特徴を比べます。' },
  { head: '題材で探す', body: '人物・風景・文字だけ、など、絵の題材から探します。' },
]

/** 12 Art Work Museum: ジャケットをあらゆる角度から見つけるコンテンツ。いまは入口(今日の展示)と、これから作る展示室の案内 */
export default async function MuseumPage() {
  const c = hubContent('museum')
  const supabase = await createClient()
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const picks = await fetchGalleryPicks(supabase, 30, day)

  const left = (
    <p className="text-xs leading-relaxed text-white/50">
      音楽の、もうひとつの顔。ジャケットを、色・描いた人・時代・ジャンル・題材といった、あらゆる角度から見つけられるコンテンツです。
    </p>
  )
  const body = (
    <>
      <SectionHeading number={c.number} label="TODAY'S GALLERY" color={c.color} right="今日の展示" />
      {picks.length === 0 ? (
        <p className="text-sm text-white/40">展示できるジャケットが、まだありません。</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {picks.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`/albums/${p.id}`} className="group block" title={`${p.title} / ${p.artistName ?? ''}`}>
                <span className="block aspect-square overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10 transition group-hover:ring-[#d9b25f]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artworkAt(p.jacket, 300) ?? p.jacket} alt={p.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </span>
                <span className="mt-1 block truncate text-[11px] font-bold">{p.title}</span>
                <span className="block truncate text-[10px] text-white/45">{p.artistName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
  const right = (
    <section>
      <SectionHeading number={c.number} label="ROOMS" color={c.color} right="準備中" />
      <ul className="grid gap-2">
        {ROOMS.map((r) => (
          <li key={r.head} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <p className="text-sm font-bold" style={{ color: c.color }}>
              {r.head}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/50">{r.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )

  return (
    <HubShell
      hubKey="museum"
      leftExtra={left}
      rightExtra={right}
      mobileContent={
        <>
          <HubIdentity hubKey="museum" />
          <div className="mt-2">{left}</div>
          <div className="mt-8">{body}</div>
          <div className="mt-12">{right}</div>
        </>
      }
    >
      {body}
    </HubShell>
  )
}
