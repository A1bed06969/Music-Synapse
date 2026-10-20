import Link from 'next/link'
import BannerShell from './BannerShell'
import type { ConnectData } from '@/utils/homeCardsCrown'

const ACCENT = '#b6f23a'

function Face({ url, name }: { url: string | null; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="flex h-full w-full items-center justify-center bg-white/10 text-sm font-bold text-white/40">{name.slice(0, 1)}</span>
  )
}

export default function ConnectTheMusicMakersBanner({ data }: { data: ConnectData }) {
  return (
    <BannerShell
      index="09"
      titleLines={['Connect The', 'Music Makers']}
      subtitle="音楽をつくる人たちをつなぐ"
      dateEyebrow="CONNECTIONS"
      dateLabel={`${data.relationTotal.toLocaleString()}件のつながり`}
      eyebrow="CONNECT"
      eyebrowHref="/relations"
      accent={ACCENT}
    >
      {data.pairs.length === 0 ? (
        <p className="text-sm text-white/30">つながりはまだ登録されていません。</p>
      ) : (
        <ul className="w-full space-y-2.5">
          {data.pairs.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <Link href={`/artists/${p.aId}`} className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
                  <Face url={p.aImage} name={p.aName} />
                </span>
                <span className="truncate text-xs font-bold text-white">{p.aName}</span>
              </Link>
              <span className="shrink-0 text-center">
                <span className="block text-base font-black leading-none" style={{ color: ACCENT }}>×</span>
                <span className="block max-w-[64px] truncate text-[9px] text-white/40">{p.label}</span>
              </span>
              <Link href={`/artists/${p.bId}`} className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2 hover:opacity-80">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
                  <Face url={p.bImage} name={p.bName} />
                </span>
                <span className="truncate text-right text-xs font-bold text-white">{p.bName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BannerShell>
  )
}
