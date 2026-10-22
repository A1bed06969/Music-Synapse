import Link from 'next/link'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import type { ConnectData, ConnectPartner } from '@/utils/connectGraph'
import {
  layoutConnect,
  layoutConnectCompact,
  layoutConnectTree,
  SIDE_MAX,
  TOPBOTTOM_MAX,
  VERTICAL_MAX,
  type ConnectItem,
  type ConnectLane,
} from '@/utils/connectLayout'
import ConnectDiagram from './ConnectDiagram'
import ConnectSearch from './ConnectSearch'
import ConnectTrail from './ConnectTrail'

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function relationOf(p: ConnectPartner): { word: string; dir: ConnectItem['edge']['dir'] } {
  if (p.invited && p.guest) return { word: '共演', dir: 'both' }
  if (p.invited) return { word: '参加', dir: 'in' } // 相手が本人の作品に参加
  return { word: '客演', dir: 'out' } // 本人が相手の作品に参加
}

/** 一緒に作った年の幅(例: 2019–2025) */
function yearSpan(p: ConnectPartner): string {
  const ys = p.works.map((w) => w.year).filter((y): y is number => !!y)
  if (!ys.length) return ''
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

/** 図のカード1枚分。withCount = 線のラベルが無い図(スマホ・横長の下段)では、件数もカードに出す */
function partnerItem(p: ConnectPartner, opts: { withCount?: boolean; titleLen?: number } = {}): ConnectItem {
  const r = relationOf(p)
  const w = p.works[0]
  const count = `${r.word} ${p.works.length}作品`
  const span = yearSpan(p)
  return {
    id: p.id,
    name: p.name,
    sub: opts.withCount ? [count, span].filter(Boolean).join(' ・ ') : span || count,
    image: p.image,
    kind: 'artist',
    href: `/relations/${p.id}`,
    edge: { kind: 'collab', dir: r.dir, lines: w ? [count, `『${truncate(w.title, opts.titleLen ?? 13)}』${w.year ?? ''}`] : [count] },
  }
}

/** 重みの大きい順の並びを、真ん中(本人の高さ)から外側へ詰める。強いつながりほど本人の近くに来る */
function middleOut<T>(items: T[]): T[] {
  const n = items.length
  const mid = (n - 1) / 2
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
  const out = new Array<T>(n)
  order.forEach((pos, rank) => (out[pos] = items[rank]))
  return out
}

function buildLayouts(data: ConnectData) {
  const relatedItems: ConnectItem[] = data.related.map((r) => ({
    id: r.id,
    name: r.name,
    sub: '制作の関わり',
    image: r.image,
    kind: 'artist',
    href: `/relations/${r.id}`,
    edge: { kind: 'related', dir: 'none', lines: r.note ? ['制作の関わり', truncate(r.note, 12)] : ['制作の関わり'] },
  }))
  const labelItems: ConnectItem[] = data.labels.map((l) => ({
    id: l.id,
    name: l.name,
    sub: l.since || l.until ? `所属 ${l.since ?? ''}〜${l.until ?? ''}` : '所属レーベル',
    image: null,
    kind: 'label',
    href: `/labels/${l.id}`,
    edge: { kind: 'label', dir: 'out', lines: [] },
  }))

  // 横長(拡大表示): 左に制作の関わり、右に共演。あふれた共演は左、さらに下へ
  const left = relatedItems.slice(0, SIDE_MAX)
  const right = data.partners.slice(0, SIDE_MAX).map((p) => partnerItem(p))
  const rest = data.partners.slice(SIDE_MAX)
  while (left.length < SIDE_MAX && rest.length) left.push(partnerItem(rest.shift()!))
  const bottom = rest.slice(0, TOPBOTTOM_MAX).map((p) => partnerItem(p, { withCount: true }))
  const lanes: Record<ConnectLane, ConnectItem[]> = { left: middleOut(left), right: middleOut(right), top: labelItems.slice(0, TOPBOTTOM_MAX), bottom: middleOut(bottom) }
  const wide = layoutConnect(lanes)

  // 縦型(3カラムの中央・スマホ): 強い順に、左右交互・上から
  const tree = layoutConnectTree(labelItems, [...relatedItems, ...data.partners.map((p) => partnerItem(p, { titleLen: 8 }))])
  const compact = layoutConnectCompact(labelItems, [...relatedItems, ...data.partners.map((p) => partnerItem(p, { withCount: true }))])
  return { wide, tree, compact }
}

/** Connect The Music Makers: 左に本人と検索、中央に相関図(縦型・拡大で横長の全体)、右につながりの一覧 */
export default function ConnectView({ data, intro, sample = false }: { data: ConnectData; intro?: React.ReactNode; sample?: boolean }) {
  const c = hubContent('connect')
  const { wide, tree, compact } = buildLayouts(data)
  const total = data.partners.length + data.related.length
  const latest = Math.max(0, ...data.partners.flatMap((p) => p.works.map((w) => w.year ?? 0)))
  const stats = sample ? [] : [
    { label: '共演', value: data.partners.length },
    { label: 'レーベル', value: data.labels.length },
    { label: 'クレジット', value: 0 },
  ]
  const centerImg = artworkAt(data.center.image, 240)

  const sampleLeft = (
    <div className="grid gap-5">
      <ConnectSearch autoFocus />
      {intro}
      <p className="text-xs leading-relaxed text-white/40">検索で選んだアーティストを中心に、共演した人やレーベルとのつながりを図にします。図のまわりの人を押すと、その人の図へ進めます。</p>
    </div>
  )

  const leftBlock = sample ? sampleLeft : (
    <div className="grid gap-5">
      <ConnectSearch />
      <ConnectTrail current={{ id: data.center.id, name: data.center.name }} />
      <div className="rounded-2xl border border-white/10 p-5" style={{ background: `linear-gradient(160deg, ${c.color}14, transparent 55%), #121410` }}>
        <div className="flex items-center gap-4">
          {centerImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={centerImg} alt="" className="h-20 w-20 shrink-0 rounded-full border-2 object-cover" style={{ borderColor: c.color }} />
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 bg-white/10 text-3xl font-black" style={{ borderColor: c.color, color: c.color }}>
              {data.center.name.slice(0, 1)}
            </span>
          )}
          <h1 className="min-w-0 text-2xl font-black leading-tight [text-wrap:balance]">
            {data.center.name}
            <span className="block text-sm font-bold text-white/50">のコネクト</span>
          </h1>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 px-3 py-2">
            <dt className="text-[11px] text-white/50">共演した人</dt>
            <dd className="font-bold tabular-nums">{data.partners.length}組</dd>
          </div>
          <div className="rounded-xl border border-white/10 px-3 py-2">
            <dt className="text-[11px] text-white/50">最新の共演</dt>
            <dd className="font-bold tabular-nums">{latest ? `${latest}年` : '—'}</dd>
          </div>
        </dl>
        <Link href={`/artists/${data.center.id}`} className="mt-4 inline-flex text-sm font-bold" style={{ color: c.color }}>
          プロフィールを見る →
        </Link>
      </div>
      {intro}
      <p className="text-xs leading-relaxed text-white/40">図のまわりの人を押すと、その人を中心にした図に切り替わります。たどった順は、検索欄の下に残ります。</p>
    </div>
  )

  const centerBlock = (
    <>
      <SectionHeading number={c.number} label={sample ? 'SAMPLE' : 'CONNECT MAP'} color={c.color} />
      {sample && (
        <p className="mb-3 text-xs leading-relaxed text-white/55">
          見え方のサンプルです(例: {data.center.name})。検索で選んだアーティストの図が、この形で表示されます。
        </p>
      )}
      {total === 0 && data.labels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm leading-relaxed text-white/60">
          <p className="font-bold text-white">{data.center.name}のコネクトは、まだ登録されていません。</p>
          <p className="mt-2">共演(feat.)の曲やレーベルの情報が入ると、ここに図が出ます。検索から、ほかのアーティストを探せます。</p>
        </div>
      ) : (
        <ConnectDiagram tree={tree} compact={compact} wide={wide} center={data.center} />
      )}
      {total > VERTICAL_MAX && <p className="mt-2 text-xs text-white/45">図に入りきらない{total - VERTICAL_MAX}組は、一覧にあります。「拡大して全体を見る」では、さらに多く表示します。</p>}
    </>
  )

  const rightBlock = (
    <div className="grid gap-10">
      <section>
        <SectionHeading number={c.number} label="CO-WORKS" color={c.color} right={`${data.partners.length}組`} />
        {data.partners.length === 0 ? (
          <p className="text-sm text-white/40">共演の記録はまだありません。</p>
        ) : (
          <ul className="grid gap-2">
            {data.partners.map((p) => {
              const r = relationOf(p)
              const src = artworkAt(p.image, 96)
              return (
                <li key={p.id} className="min-w-0">
                  <Link href={`/relations/${p.id}`} prefetch={false} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-white/25 hover:bg-white/[0.06]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" decoding="async" className="h-9 w-9 shrink-0 rounded-full bg-white/5 object-cover" />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-black" style={{ color: c.color }}>
                        {p.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-sm font-bold">{p.name}</span>
                        <span className="shrink-0 rounded-full border border-[#56d9ff66] px-1.5 text-[10px] font-bold text-[#56d9ff]">
                          {r.word} {p.works.length}
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-white/50">
                        {p.works
                          .slice(0, 2)
                          .map((w) => `『${w.title}』${w.year ?? ''}`)
                          .join(' ')}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">「参加」は{data.center.name}の作品に参加した人、「客演」は{data.center.name}が参加した作品の人、「共演」は両方です。</p>
      </section>

      {data.labels.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="LABELS" color={c.color} />
          <ul className="flex flex-wrap gap-2">
            {data.labels.map((l) => (
              <li key={l.id}>
                <Link href={`/labels/${l.id}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-sm hover:border-white/40">
                  {l.name}
                  {(l.since || l.until) && <span className="text-xs text-white/40">{`${l.since ?? ''}〜${l.until ?? ''}`}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading number={c.number} label="CREDITS" color={c.color} />
        <p className="rounded-xl border border-dashed p-4 text-xs leading-relaxed text-white/55" style={{ borderColor: `${c.color}55` }}>
          作詞・作曲・編曲・プロデュース・サポートのクレジットは準備中です。集まり次第、「作り手」として図に加わります。
        </p>
      </section>
    </div>
  )

  return (
    <HubShell
      hubKey="connect"
      stats={stats}
      leftExtra={leftBlock}
      rightExtra={sample ? undefined : rightBlock}
      mobileContent={
        <>
          <HubIdentity hubKey="connect" stats={stats} />
          <div className="mt-2">{leftBlock}</div>
          <div className="mt-10">{centerBlock}</div>
          {!sample && <div className="mt-12">{rightBlock}</div>}
        </>
      }
    >
      {centerBlock}
    </HubShell>
  )
}
