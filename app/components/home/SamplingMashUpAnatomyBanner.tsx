import Link from 'next/link'
import BannerShell from './BannerShell'
import { artworkAt } from '@/utils/artworkSize'
import { fetchSamplingPairs } from '@/utils/samplingData'
import { createClient } from '@/utils/Supabase/server'

const ACCENT = '#52e05f'

/** 11 Sampling & Mash-Up Anatomy のトップのバナー。サンプリングで結ばれた曲(新しい曲 ← 元ネタ)を、毎日違う顔ぶれで3組見せる */
export default async function SamplingMashUpAnatomyBanner() {
  const supabase = await createClient()
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const [pairs, total] = await Promise.all([
    fetchSamplingPairs(supabase, 4, day),
    supabase.from('track_relation').select('id', { count: 'exact', head: true }),
  ])
  const count = total.count ?? 0
  return (
    <BannerShell
      index="11"
      titleLines={['Sampling &', 'Mash-Up Anatomy']}
      subtitle="混ぜ合わさった曲を、解剖する"
      dateEyebrow="RELATIONS"
      dateLabel={`${count.toLocaleString()}件のつながり`}
      eyebrow="ANATOMY"
      eyebrowHref="/sampling"
      accent={ACCENT}
    >
      {pairs.length === 0 ? (
        <p className="text-sm text-white/30">サンプリングの関係はまだ登録されていません。</p>
      ) : (
        <ul className="w-full space-y-2.5">
          {pairs.map((p) => (
            <li key={p.derived.id + p.original.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <Link href={`/sampling/${p.derived.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artworkAt(p.derived.jacket, 96) ?? ''} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md bg-white/5 object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-white">{p.derived.title}</span>
                  <span className="block truncate text-[10px] text-white/45">{p.derived.artistName}</span>
                </span>
              </Link>
              <span className="shrink-0 text-center">
                <span className="block text-base font-black leading-none" style={{ color: ACCENT }}>
                  ←
                </span>
                <span className="block text-[9px] text-white/40">元ネタ</span>
              </span>
              <Link href={`/sampling/${p.original.id}`} className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2 text-right hover:opacity-80">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artworkAt(p.original.jacket, 96) ?? ''} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md bg-white/5 object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-white">{p.original.title}</span>
                  <span className="block truncate text-[10px] text-white/45">{p.original.artistName}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
