import Link from 'next/link'
import BannerShell from './BannerShell'
import type { GenreRootsData } from '@/utils/homeCardsCrown'

const ACCENT = '#3fd0e0'

export default function GenreRootsTapestryBanner({ data }: { data: GenreRootsData }) {
  return (
    <BannerShell
      index="08"
      titleLines={['Genre Roots', 'Tapestry']}
      subtitle="ジャンルの系譜を、一枚の織物に"
      dateEyebrow="GENRES"
      dateLabel={`${data.roots.length}系統・${data.genreTotal.toLocaleString()}ジャンル`}
      eyebrow="GENRE ROOTS"
      eyebrowHref="/genres"
      accent={ACCENT}
    >
      {data.roots.length === 0 ? (
        <p className="text-sm text-white/30">ジャンルの系譜はまだ登録されていません。</p>
      ) : (
        <ul className="grid w-full grid-cols-2 gap-3">
          {data.roots.map((g) => (
            <li key={g.id} className="min-w-0">
              <Link href={`/genres/${g.id}`} className="group block">
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/10">
                  {g.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="truncate text-base font-black uppercase tracking-wide text-white">{g.name}</p>
                    <p className="text-[10px] font-bold tracking-wide" style={{ color: ACCENT }}>
                      サブジャンル {g.subCount}{g.label ? ` ・ ${g.label}` : ''}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
