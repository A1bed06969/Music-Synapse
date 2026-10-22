import Link from 'next/link'
import BannerShell from './BannerShell'
import { artworkAt } from '@/utils/artworkSize'
import { fetchGalleryPicks } from '@/utils/museumData'
import { createClient } from '@/utils/Supabase/server'

const ACCENT = '#d9b25f'

/** 12 Art Work Museum のトップのバナー。今日の展示(ジャケット6枚)と、展示室の入口 */
export default async function ArtWorkMuseumBanner() {
  const supabase = await createClient()
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const picks = await fetchGalleryPicks(supabase, 6, day)
  return (
    <BannerShell
      index="12"
      titleLines={['Art Work', 'Museum']}
      subtitle="ジャケットを、あらゆる角度から"
      dateEyebrow="TODAY'S GALLERY"
      dateLabel="今日の展示"
      eyebrow="MUSEUM"
      eyebrowHref="/museum"
      accent={ACCENT}
    >
      {picks.length === 0 ? (
        <p className="text-sm text-white/30">展示できるジャケットが、まだありません。</p>
      ) : (
        <ul className="grid w-full grid-cols-3 gap-2">
          {picks.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`/albums/${p.id}`} className="group block" title={`${p.title} / ${p.artistName ?? ''}`}>
                <span className="block aspect-square overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10 transition group-hover:ring-[#d9b25f]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artworkAt(p.jacket, 240) ?? p.jacket} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
