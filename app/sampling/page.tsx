import Link from 'next/link'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { createClient } from '@/utils/Supabase/server'
import TrackSearch from './TrackSearch'

export const metadata = { title: 'Sampling & Mash-Up Anatomy | Music Synapse' }

type Top = { track_id: string; title: string; artist_id: string | null; artist_name: string | null; jacket_url: string | null; versions: number }
type Mash = { track_id: string; track: { id: string; title: string; artist: { name: string } | { name: string }[] | null; album: { jacket_url: string | null } | { jacket_url: string | null }[] | null } | null }

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** 11 Sampling & Mash-Up Anatomy: 曲を探して、元の曲・リミックス・マッシュアップを解剖する */
export default async function SamplingPage() {
  const c = hubContent('sampling')
  const supabase = await createClient()
  const [top, counts, mash] = await Promise.all([
    supabase.rpc('top_remixed_tracks', { p_limit: 12 }),
    Promise.all(['remix', 'edit', 'bootleg', 'mashup'].map((t) => supabase.from('track_relation').select('id', { count: 'exact', head: true }).eq('relation_type', t))),
    supabase.from('track_relation').select('track_id, track:track_id(id, title, artist:artist_id(name), album:album_id(jacket_url))').eq('relation_type', 'mashup').limit(24),
  ])
  const [remix, edit, bootleg, mashup] = counts.map((x) => x.count ?? 0)
  const tops = (top.data ?? []) as Top[]
  const mashes = ((mash.data ?? []) as unknown as Mash[]).filter((m) => m.track)
  const stats = [
    { label: 'リミックス', value: remix.toLocaleString() },
    { label: 'エディット', value: edit.toLocaleString() },
    { label: 'マッシュアップ', value: (mashup + bootleg).toLocaleString() },
  ]

  const left = (
    <div className="grid gap-5">
      <TrackSearch />
      <p className="text-xs leading-relaxed text-white/50">
        曲を探すと、元の曲と、そこから生まれたリミックス・エディット・マッシュアップを、1枚で見られます。いまは、カタログの曲名から見つけた関係です。
      </p>
    </div>
  )

  const body = (
    <>
      <SectionHeading number={c.number} label="MOST REMIXED" color={c.color} right="版の多い曲" />
      <ul className="grid gap-2">
        {tops.map((t) => {
          const src = artworkAt(t.jacket_url, 120)
          return (
            <li key={t.track_id} className="min-w-0">
              <Link href={`/sampling/${t.track_id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-white/25 hover:bg-white/[0.06]">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-md bg-white/5 object-cover" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-white/10 text-sm font-black" style={{ color: c.color }}>
                    ♪
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{t.title}</span>
                  <span className="block truncate text-xs text-white/50">{t.artist_name}</span>
                </span>
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black tabular-nums" style={{ borderColor: `${c.color}88`, color: c.color }}>
                  {t.versions}版
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

    </>
  )

  const right = (
    <div className="grid gap-10">
      {mashes.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="MASH-UP" color={c.color} right={`${mashup + bootleg}曲`} />
          <ul className="grid gap-2">
            {mashes.map((m) => {
              const t = m.track!
              const a = one(t.artist)
              const src = artworkAt(one(t.album)?.jacket_url ?? null, 96)
              return (
                <li key={t.id} className="min-w-0">
                  <Link href={`/sampling/${t.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-white/25 hover:bg-white/[0.06]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" decoding="async" className="h-10 w-10 shrink-0 rounded-md bg-white/5 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/10 text-sm font-black" style={{ color: c.color }}>
                        ♪
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{t.title}</span>
                      <span className="block truncate text-xs text-white/50">{a?.name}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )

  return (
    <HubShell
      hubKey="sampling"
      stats={stats}
      leftExtra={left}
      rightExtra={right}
      mobileContent={
        <>
          <HubIdentity hubKey="sampling" stats={stats} />
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
