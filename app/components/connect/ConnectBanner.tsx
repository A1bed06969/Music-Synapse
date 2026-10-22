import Link from 'next/link'
import { anton } from '@/app/components/detail/displayFont'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'

/** アーティストページから、Connect The Music Makers(09)のその人の相関図(/relations/[id])へ誘うバナー。
 * 共演した人の画像を数枚並べて、図の中身を想像できるようにする。 */
export default function ConnectBanner({
  artistId,
  artistName,
  partners,
}: {
  artistId: string
  artistName: string
  partners: { id: string; name: string; image: string | null }[]
}) {
  const c = hubContent('connect')
  const shown = partners.slice(0, 5)
  return (
    <Link
      href={`/relations/${artistId}`}
      className="group relative block overflow-hidden rounded-2xl border p-4 transition hover:brightness-110 lg:p-5"
      style={{ borderColor: `${c.color}66`, background: `linear-gradient(135deg, ${c.color}1f, transparent 60%), #121410` }}
    >
      <div className="flex items-center gap-4">
        <span className={`${anton.className} text-5xl leading-none lg:text-6xl`} style={{ color: c.color }}>
          {c.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.18em]" style={{ color: c.color }}>
            {c.label}
          </span>
          <span className="mt-0.5 block truncate text-lg font-black leading-tight lg:text-xl">{artistName}のコネクト</span>
          <span className="mt-0.5 block text-xs text-white/55">共演した人やレーベルとのつながりを、図で見る</span>
        </span>
        <span className="shrink-0 text-xl transition group-hover:translate-x-1" style={{ color: c.color }} aria-hidden="true">
          →
        </span>
      </div>
      {shown.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          {shown.map((p) => {
            const src = artworkAt(p.image, 72)
            return src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={src} alt="" title={p.name} loading="lazy" decoding="async" className="h-8 w-8 rounded-full border border-white/15 bg-white/5 object-cover" />
            ) : (
              <span key={p.id} title={p.name} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/10 text-xs font-black" style={{ color: c.color }}>
                {p.name.slice(0, 1)}
              </span>
            )
          })}
          {partners.length > shown.length && <span className="ml-1 text-xs text-white/45">ほか{partners.length - shown.length}組</span>}
        </div>
      )}
    </Link>
  )
}
