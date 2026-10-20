import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'

export default async function AwardsPage({ searchParams }: { searchParams: Promise<{ award?: string }> }) {
  const { award: awardParam } = await searchParams
  const supabase = await createClient()

  const { data: entries } = await supabase
    .from('award_entry')
    .select(
      'id, year, category, result, work_title, award:award_id(id, name, country, image_url), artist:artist_id(id, name, image_url), album:album_id(id, title), track:track_id(id, title)'
    )
    .order('year', { ascending: false })

  type AwardRow = {
    id: number
    year: number
    category: string | null
    result: string
    label: string
    href: string | null
    imageUrl: string | null
    /** 受賞対象の作品名(アルバム・曲)。アーティスト自身への賞なら無い */
    workTitle: string | null
    workHref: string | null
  }
  type AwardGroup = { awardId: string; awardName: string; country: string | null; imageUrl: string | null; rows: AwardRow[] }

  const byAward = new Map<string, AwardGroup>()

  for (const row of entries ?? []) {
    const award = Array.isArray(row.award) ? row.award[0] : row.award
    if (!award) continue
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
    const album = Array.isArray(row.album) ? row.album[0] : row.album
    const track = Array.isArray(row.track) ? row.track[0] : row.track

    const label = artist?.name ?? album?.title ?? track?.title ?? '?'
    const href = artist ? `/artists/${artist.id}` : album ? `/albums/${album.id}` : track ? `/tracks/${track.id}` : null

    const group: AwardGroup = byAward.get(award.id) ?? { awardId: award.id, awardName: award.name, country: award.country ?? null, imageUrl: award.image_url ?? null, rows: [] }
    // Wikidata にラベルが無い作品はQ番号のまま入ってくるので、作品名としては出さない
    const rawTitle = row.work_title && !/^Q\d+$/.test(row.work_title) ? row.work_title : null
    const workTitle = rawTitle ?? album?.title ?? track?.title ?? null
    const workHref = album ? `/albums/${album.id}` : track ? `/tracks/${track.id}` : null
    group.rows.push({ id: row.id, year: row.year, category: row.category, result: row.result, label, href, imageUrl: artist?.image_url ?? null, workTitle, workHref })
    byAward.set(award.id, group)
  }

  // 件数の多い賞から並べる。選択中のアワードだけを表示する(未選択・不正な値なら先頭)
  const groups = Array.from(byAward.values()).sort((a, b) => b.rows.length - a.rows.length)
  const selected = groups.find((g) => g.awardId === awardParam) ?? groups[0]
  const c = hubContent('crown')
  const winnerCount = (entries ?? []).filter((e) => e.result === 'winner').length

  // 賞ごとに部門でまとめ、各部門は新しい年から。ノミネートは折りたたんで受賞を先に見せる
  function byCategory(rows: AwardRow[]) {
    const map = new Map<string, AwardRow[]>()
    for (const r of rows) {
      const key = r.category ?? '—'
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return Array.from(map.entries()).map(([category, list]) => ({
      category,
      winners: list.filter((r) => r.result === 'winner').sort((x, y) => y.year - x.year),
      nominees: list.filter((r) => r.result !== 'winner').sort((x, y) => y.year - x.year),
    }))
  }

  function Row({ row }: { row: AwardRow }) {
    const content = (
      <>
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white/30">{row.label.slice(0, 1)}</span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">{row.label}</span>
          {row.workTitle && <span className="block truncate text-xs text-white/55">{row.workTitle}</span>}
        </span>
      </>
    )
    return (
      <li className="flex items-center gap-3 py-2">
        <span className="w-10 shrink-0 text-sm tabular-nums text-white/40">{row.year}</span>
        {row.href ? (
          <Link href={row.workHref ?? row.href} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
            {content}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-3">{content}</span>
        )}
      </li>
    )
  }

  // 右カラム(スマホでは上部)のアワード選択。キュレーションの企画選択と同じ見た目のカード
  const awardSelector = (
    <div>
      <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">AWARDS</p>
      <nav aria-label="アワードを選ぶ" className="flex flex-col gap-3">
        {groups.map((g) => {
          const active = g.awardId === selected?.awardId
          const winners = g.rows.filter((r) => r.result === 'winner').length
          const nominees = g.rows.length - winners
          return (
            <Link
              key={g.awardId}
              href={`/chronology/awards?award=${g.awardId}`}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              style={active ? { borderColor: c.color, backgroundColor: `${c.color}1f` } : undefined}
              className={`flex min-w-0 gap-3 rounded-lg border p-3 transition hover:bg-white/[0.06] ${active ? 'bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <span className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-white/5">
                {g.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xl text-white/20">🏆</span>
                )}
              </span>
              <span className="min-w-0">
                {g.country && <span className="block text-xs text-white/40">{g.country}</span>}
                <span className="block truncate font-semibold">{g.awardName}</span>
                <span className="mt-1 block truncate text-xs text-white/50">
                  受賞 {winners}
                  {nominees > 0 ? ` ・ ノミネート ${nominees}` : ''}
                </span>
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )

  const description = <p className="text-xs leading-relaxed text-white/50">アワード・コンテストの受賞・ノミネート履歴のアーカイブです。</p>
  const stats = [
    { label: 'アワード', value: groups.length },
    { label: '受賞', value: winnerCount },
  ]

  const centerContent =
    groups.length === 0 ? (
      <p className="text-sm text-white/40">まだ受賞・ノミネートデータが登録されていません。</p>
    ) : (
      [selected].map((group) => (
        <section key={group.awardId}>
          <SectionHeading number={c.number} label={group.awardName} color={c.color} />
          <div className="space-y-8">
            {byCategory(group.rows).map(({ category, winners, nominees }) => (
              <div key={category}>
                <h3 className="text-sm font-bold" style={{ color: c.color }}>
                  {category}
                </h3>
                <ul className="mt-2 divide-y divide-white/10">
                  {winners.map((row) => (
                    <Row key={row.id} row={row} />
                  ))}
                </ul>
                {nominees.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-white/40 hover:text-white/70">ノミネート {nominees.length}件</summary>
                    <ul className="mt-1 divide-y divide-white/5 text-white/70">
                      {nominees.map((row) => (
                        <Row key={row.id} row={row} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      ))
    )

  return (
    <HubShell
      hubKey="crown"
      stats={stats}
      leftExtra={description}
      rightExtra={groups.length > 0 ? awardSelector : undefined}
      mobileContent={
        <>
          <HubIdentity hubKey="crown" stats={stats} />
          <div className="mt-2">{description}</div>
          {groups.length > 0 && <div className="mt-6">{awardSelector}</div>}
          <div className="mt-8">{centerContent}</div>
        </>
      }
    >
      {centerContent}
    </HubShell>
  )
}
