import Link from 'next/link'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
import { fetchTopCreators } from '@/utils/museumData'
import { createClient } from '@/utils/Supabase/server'

export const metadata = { title: '描いた人で探す | Art Work Museum | Music Synapse' }

export default async function CreatorsPage() {
  const c = hubContent('museum')
  const supabase = await createClient()
  const creators = await fetchTopCreators(supabase, 120)
  const left = (
    <div className="grid gap-3">
      <p className="text-xs leading-relaxed text-white/50">ジャケットを手がけた、イラストレーター・アートディレクター・デザイナー・写真家から、作品をたどります。クレジットが集まるほど、増えていきます。</p>
      <Link href="/museum" className="text-sm font-bold" style={{ color: c.color }}>
        ← 今日の展示へ
      </Link>
    </div>
  )
  const body = (
    <>
      <SectionHeading number={c.number} label="CREATORS" color={c.color} right={`${creators.length}人`} />
      {creators.length === 0 ? (
        <p className="text-sm text-white/40">制作者のクレジットは、まだ登録されていません。</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {creators.map((p) => (
            <li key={p.personId} className="min-w-0">
              <Link href={`/museum/creators/${p.personId}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/25 hover:bg-white/[0.06]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{p.name}</span>
                  <span className="block truncate text-[11px] text-white/45">{p.roles.map((r) => CREDIT_ROLE_LABEL[r] ?? r).join(' ・ ')}</span>
                </span>
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black tabular-nums" style={{ borderColor: `${c.color}88`, color: c.color }}>
                  {p.albums}枚
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
