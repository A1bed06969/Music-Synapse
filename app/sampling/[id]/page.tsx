import Link from 'next/link'
import { notFound } from 'next/navigation'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { fetchAnatomy, RELATION_LABEL, type AnatomyLink } from '@/utils/samplingData'
import { createClient } from '@/utils/Supabase/server'
import TrackSearch from '../TrackSearch'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('track').select('title').eq('id', id).maybeSingle()
  return { title: data ? `${data.title}を解剖する | Music Synapse` : 'Sampling & Mash-Up Anatomy | Music Synapse' }
}

function Cover({ src, size }: { src: string | null; size: number }) {
  const u = artworkAt(src, size * 2)
  return u ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={u} alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-md bg-white/5 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-md bg-white/10 font-black text-[#52e05f]" style={{ width: size, height: size }}>
      ♪
    </span>
  )
}

function TrackRow({ l, color }: { l: AnatomyLink; color: string }) {
  return (
    <li className="min-w-0">
      <Link href={`/sampling/${l.track.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-white/25 hover:bg-white/[0.06]">
        <Cover src={l.track.jacket} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{l.track.title}</span>
          <span className="block truncate text-xs text-white/50">
            {l.track.artistName}
            {l.track.year ? ` ・ ${l.track.year}` : ''}
          </span>
        </span>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: `${color}77`, color }}>
          {RELATION_LABEL[l.type] ?? l.type}
        </span>
      </Link>
    </li>
  )
}

/** 1曲を解剖する: 元の曲 → この曲 → そこから生まれた版 */
export default async function AnatomyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const data = await fetchAnatomy(supabase, id)
  if (!data) notFound()
  const c = hubContent('sampling')
  const { track } = data
  const hasAny = data.originals.length + data.versions.length + data.externalOriginals.length > 0 || data.isMashup || data.siblings.length > 0

  const left = (
    <div className="grid gap-5">
      <TrackSearch />
      <div className="rounded-2xl border border-white/10 p-4" style={{ background: `linear-gradient(160deg, ${c.color}14, transparent 55%), #121410` }}>
        <div className="flex items-center gap-4">
          <Cover src={track.jacket} size={84} />
          <div className="min-w-0">
            <h1 className="text-xl font-black leading-tight [text-wrap:balance]">{track.title}</h1>
            <p className="mt-1 truncate text-sm text-white/55">{track.artistName}</p>
            {track.year && <p className="text-xs text-white/40">{track.year}</p>}
          </div>
        </div>
        <Link href={`/tracks/${track.id}`} className="mt-4 inline-flex text-sm font-bold" style={{ color: c.color }}>
          曲のページを見る →
        </Link>
      </div>
    </div>
  )

  const body = (
    <>
      <SectionHeading number={c.number} label="ANATOMY" color={c.color} />
      {!hasAny ? (
        <p className="rounded-xl border border-dashed p-5 text-sm leading-relaxed text-white/60" style={{ borderColor: `${c.color}66` }}>
          この曲の、元の曲やリミックスは、まだ見つかっていません。いまは、カタログの曲名から関係を見つけています。
        </p>
      ) : (
        <div className="grid gap-8">
          {data.originals.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold tracking-[0.16em] text-white/50">元の曲</p>
              <ul className="grid gap-2">
                {data.originals.map((l) => (
                  <TrackRow key={l.track.id} l={l} color={c.color} />
                ))}
              </ul>
              <p className="mt-2 text-xs text-white/40">
                {data.originals[0].type === 'sample'
                  ? `この曲は、『${data.originals[0].track.title}』を使っています(サンプリング・引用)。`
                  : `この曲は、『${data.originals[0].track.title}』の${RELATION_LABEL[data.originals[0].type]}${data.originals[0].note ? `(${data.originals[0].note})` : ''}です。`}
              </p>
            </section>
          )}
          {data.externalOriginals.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold tracking-[0.16em] text-white/50">元ネタ(カタログにない曲)</p>
              <ul className="grid gap-2">
                {data.externalOriginals.map((o) => (
                  <li key={`${o.artist}-${o.title}`} className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 p-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white/5 font-black" style={{ color: c.color }}>
                      ♪
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{o.title}</span>
                      <span className="block truncate text-xs text-white/50">{o.artist ?? 'アーティスト不明'}</span>
                    </span>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: `${c.color}77`, color: c.color }}>
                      {RELATION_LABEL[o.type] ?? o.type}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.isMashup && (
            <p className="rounded-xl border p-4 text-sm leading-relaxed" style={{ borderColor: `${c.color}55` }}>
              <span className="font-bold" style={{ color: c.color }}>マッシュアップです。</span>
              複数の曲が混ざった曲です。元の曲は、まだ特定できていません。
            </p>
          )}
          {data.versions.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold tracking-[0.16em] text-white/50">この曲から生まれた曲・版({data.versions.length})</p>
              <ul className="grid gap-2">
                {data.versions.map((l) => (
                  <TrackRow key={l.track.id} l={l} color={c.color} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )

  const right = (
    <div className="grid gap-10">
      {data.siblings.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="SAME ORIGIN" color={c.color} right={`${data.siblings.length}版`} />
          <p className="mb-3 text-xs text-white/45">同じ元の曲から生まれた、ほかの版です。</p>
          <ul className="grid gap-2">
            {data.siblings.map((l) => (
              <TrackRow key={l.track.id} l={l} color={c.color} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <SectionHeading number={c.number} label="GUIDE" color={c.color} />
        <dl className="grid gap-3 text-xs leading-relaxed text-white/55">
          {[
            ['リミックス', '別のアーティストや制作者が、元の曲を作り直した版。'],
            ['エディット', '長さや構成を変えた版(Radio Edit など)。'],
            ['ブートレッグ', '非公式に作られた、元の曲を使った版。'],
            ['マッシュアップ', '複数の曲を混ぜ合わせた曲。'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-bold text-white/80">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )

  return (
    <HubShell
      hubKey="sampling"
      leftExtra={left}
      rightExtra={right}
      mobileContent={
        <>
          <HubIdentity hubKey="sampling" />
          <div className="mt-2">{left}</div>
          <div className="mt-10">{body}</div>
          <div className="mt-12">{right}</div>
        </>
      }
    >
      {body}
    </HubShell>
  )
}
