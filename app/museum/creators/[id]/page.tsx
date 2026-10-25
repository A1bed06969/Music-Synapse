import Link from 'next/link'
import { notFound } from 'next/navigation'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
import { fetchCreatorWorks } from '@/utils/museumData'
import { createClient } from '@/utils/Supabase/server'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('credit_person').select('name').eq('id', id).maybeSingle()
  return { title: data ? `${data.name}が手がけたジャケット | Art Work Museum | Music Synapse` : 'Art Work Museum | Music Synapse' }
}

/** 制作者(アートディレクター・イラストレーター・写真家など)が手がけたジャケットの一覧(発売年順) */
export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = hubContent('museum')
  const supabase = await createClient()
  const data = await fetchCreatorWorks(supabase, id)
  if (!data) notFound()
  const roles = Array.from(new Set(data.works.flatMap((w) => w.roles)))
  const left = (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-white/10 p-4" style={{ background: `linear-gradient(160deg, ${c.color}14, transparent 55%), #121410` }}>
        <p className="text-[11px] font-bold tracking-[0.16em]" style={{ color: c.color }}>
          {roles.map((r) => CREDIT_ROLE_LABEL[r] ?? r).join(' ・ ')}
        </p>
        <h1 className="mt-1 text-2xl font-black leading-tight [text-wrap:balance]">{data.name}</h1>
        <p className="mt-2 text-sm text-white/55">手がけたジャケット {data.works.length}枚</p>
      </div>
      <Link href="/museum/creators" className="text-sm font-bold" style={{ color: c.color }}>
        ← 描いた人の一覧へ
      </Link>
    </div>
  )
  const body = (
    <>
      <SectionHeading number={c.number} label="WORKS" color={c.color} right={`${data.works.length}枚`} />
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {data.works.map((w) => (
          <li key={w.id} className="min-w-0">
            <Link href={`/albums/${w.id}`} className="group block" title={`${w.title} / ${w.artistName ?? ''}`}>
              <span className="block aspect-square overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10 transition group-hover:ring-[#d9b25f]">
                {w.jacket && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artworkAt(w.jacket, 300) ?? w.jacket} alt={w.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="mt-1 block truncate text-[11px] font-bold">{w.title}</span>
              <span className="block truncate text-[10px] text-white/45">
                {w.artistName}
                {w.year ? ` ・ ${w.year}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
  return (
    <HubShell
      hubKey="museum"
      leftExtra={left}
      mobileContent={
        <>
          <HubIdentity hubKey="museum" />
          <div className="mt-2">{left}</div>
          <div className="mt-8">{body}</div>
        </>
      }
    >
      {body}
    </HubShell>
  )
}
