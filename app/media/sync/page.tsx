import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  drama: 'ドラマ',
  tv_program: 'テレビ番組',
}

const SEASON_ORDER = ['冬', '春', '夏', '秋', '継続', '劇場版']
const SEASON_HEADING: Record<string, { label: string; sub: string }> = {
  冬: { label: '冬', sub: '1〜3月スタート' },
  春: { label: '春', sub: '4〜6月スタート' },
  夏: { label: '夏', sub: '7〜9月スタート' },
  秋: { label: '秋', sub: '10〜12月スタート' },
  継続: { label: '継続', sub: '前の年から続く作品' },
  劇場版: { label: '劇場版', sub: '映画・総集編・OVAなど' },
}
const SEASON_BY_MONTH = ['冬', '春', '夏', '秋']
const MOVIE_PART = /劇場|映画|総集編|OVA|スペシャル/
const seasonRank = (s: string | null) => {
  const i = s ? SEASON_ORDER.indexOf(s) : -1
  return i === -1 ? SEASON_ORDER.length : i
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

type EntryRow = {
  id: string
  role: string | null
  part_label: string | null
  air_year: number | null
  air_month: number | null
  track: { id: string; title: string; artist: { name: string } | { name: string }[] | null; album: { jacket_url: string | null } | { jacket_url: string | null }[] | null } | { id: string; title: string; artist: { name: string } | { name: string }[] | null; album: { jacket_url: string | null } | { jacket_url: string | null }[] | null }[] | null
}
type WorkRow = {
  id: string
  title: string
  work_type: string | null
  company_or_studio: string | null
  year: number | null
  season_label: string | null
  is_original: boolean
  sync_entry: EntryRow[] | null
}

export default async function SyncArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; work_type?: string; year?: string }>
}) {
  const { q, work_type: workType, year: yearParam } = await searchParams
  const supabase = await createClient()
  const c = hubContent('tieup')

  // 全作品(年ごとの件数と、年の選択肢を出すため)。件数が増えたら年ごとの集計に切り替える
  const all: WorkRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase
      .from('sync_work')
      .select('id, title, work_type, company_or_studio, year, season_label, is_original, sync_entry(id, role, part_label, air_year, air_month, track:track_id(id, title, artist:artist_id(name), album:album_id(jacket_url)))')
      .order('year', { ascending: false })
      .order('title')
      .range(offset, offset + 999)
    all.push(...((data ?? []) as WorkRow[]))
    if ((data ?? []).length < 1000) break
  }

  // 曲ごとに「いつの・どのシーズンか」を決める。期ごとの放送年月(air_year/air_month)があればそれで、無ければ作品の年とシーズン。
  // 劇場版・映画・総集編・OVAは「劇場版」にまとめる。同じ作品の曲でも、期が違えば別の年・シーズンに並ぶ
  type Slot = { year: number | null; season: string | null }
  const slotOf = (w: WorkRow, e: EntryRow): Slot => {
    const year = e.air_year ?? w.year
    if (e.part_label && MOVIE_PART.test(e.part_label)) return { year, season: '劇場版' }
    if (e.air_year && e.air_month) return { year: e.air_year, season: SEASON_BY_MONTH[Math.floor((e.air_month - 1) / 3)] }
    return { year: w.year, season: w.season_label && SEASON_HEADING[w.season_label] ? w.season_label : null }
  }

  const needle = (q ?? '').trim().toLowerCase()
  type Slice = { work: WorkRow; entries: EntryRow[] }
  const yearStats = new Map<number, { works: Set<string>; entries: number }>()
  const groupMap = new Map<string, { key: string; year: number | null; season: string | null; slices: Map<string, Slice> }>()
  for (const w of all) {
    if (workType && w.work_type !== workType) continue
    const titleHit = needle ? w.title.toLowerCase().includes(needle) : true
    for (const e of w.sync_entry ?? []) {
      if (!firstOf(e.track)) continue
      const slot = slotOf(w, e)
      if (slot.year) {
        const ys = yearStats.get(slot.year) ?? { works: new Set<string>(), entries: 0 }
        ys.works.add(w.id)
        ys.entries++
        yearStats.set(slot.year, ys)
      }
      if (needle && !titleHit && !firstOf(e.track)!.title.toLowerCase().includes(needle)) continue
      const yearSel = Number(yearParam) || null
      if (yearSel && slot.year !== yearSel) continue
      const key = `${slot.year ?? 0}-${slot.season ?? 'x'}`
      let g = groupMap.get(key)
      if (!g) {
        g = { key, year: slot.year, season: slot.season, slices: new Map() }
        groupMap.set(key, g)
      }
      // 同じ作品でも、期(part)が違うものは別のカードにする
      const sliceKey = `${w.id}|${e.part_label ?? ''}`
      const slice = g.slices.get(sliceKey) ?? { work: w, entries: [] }
      slice.entries.push(e)
      g.slices.set(sliceKey, slice)
    }
  }
  const years = Array.from(yearStats.entries()).map(([y, v]): [number, { works: number; entries: number }] => [y, { works: v.works.size, entries: v.entries }]).sort((a, b) => b[0] - a[0])
  const year = Number(yearParam) || null
  const groups = Array.from(groupMap.values())
    .map((g) => {
      const h = g.season ? SEASON_HEADING[g.season] : { label: 'その他', sub: '放送時期が不明の作品' }
      return { ...g, label: h.label, sub: h.sub, rank: seasonRank(g.season), slices: Array.from(g.slices.values()) }
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.rank - b.rank)
  const worksCount = groups.reduce((n, g) => n + g.slices.length, 0)

  const buildHref = (patch: { year?: number | null; work_type?: string | null }) => {
    const p = new URLSearchParams()
    const y = patch.year === undefined ? year : patch.year
    const t = patch.work_type === undefined ? workType : patch.work_type
    if (y) p.set('year', String(y))
    if (t) p.set('work_type', t)
    if (q) p.set('q', q)
    const s = p.toString()
    return `/media/sync${s ? `?${s}` : ''}`
  }

  const totalEntries = all.reduce((n, w) => n + (w.sync_entry ?? []).length, 0)
  const totalWorks = all.filter((w) => (w.sync_entry ?? []).length > 0).length
  const stats = [
    { label: '作品', value: totalWorks },
    { label: 'タイアップ曲', value: totalEntries },
  ]
  const description = (
    <p className="text-xs leading-relaxed text-white/50">
      アニメ・ドラマなどの主題歌・挿入歌を、年ごとにたどれます。年を選ぶと、その年に放送された作品と、流れた曲が並びます。
    </p>
  )

  // 年のダイヤル(右カラム。スマホでは上部に横並び)
  const yearSelector = (
    <div>
      <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">YEARS</p>
      <nav aria-label="年を選ぶ" className="flex flex-col gap-3 max-lg:flex-row max-lg:flex-wrap max-lg:gap-2">
        {[{ y: null as number | null, label: 'すべて', sub: `${totalWorks}作品・${totalEntries}曲` }, ...years.map(([y, s]) => ({ y, label: `${y}`, sub: `${s.works}作品・${s.entries}曲` }))].map((it) => {
          const active = (it.y ?? null) === year
          return (
            <Link
              key={it.label}
              href={buildHref({ year: it.y })}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              style={active ? { borderColor: c.color, backgroundColor: `${c.color}1f` } : undefined}
              className={`rounded-lg border px-4 py-3 transition hover:bg-white/[0.06] max-lg:px-3 max-lg:py-2 ${active ? 'bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <span className="block text-2xl font-black tabular-nums leading-none max-lg:text-lg" style={{ color: active ? c.color : undefined }}>
                {it.label}
              </span>
              <span className="mt-1 block text-xs text-white/50 max-lg:hidden">{it.sub}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )

  const typeKeys = Array.from(new Set(all.map((w) => w.work_type).filter((t): t is string => !!t)))
  const centerContent = (
    <>
      <SectionHeading number={c.number} label={year ? `${year} TIE-UPS` : 'TIE-UPS'} color={c.color} />
      <form className="mt-4 flex flex-wrap gap-2" action="/media/sync">
        {year && <input type="hidden" name="year" value={year} />}
        {workType && <input type="hidden" name="work_type" value={workType} />}
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="作品名・曲名で検索..."
          className="min-w-[200px] flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button type="submit" className="min-h-11 rounded-md px-5 text-sm font-bold text-black transition hover:opacity-85" style={{ backgroundColor: c.color }}>
          検索
        </button>
      </form>
      {typeKeys.length > 1 && (
        <nav aria-label="種別" className="mt-3 flex flex-wrap gap-2">
          {[{ k: null as string | null, label: 'すべて' }, ...typeKeys.map((k) => ({ k, label: WORK_TYPE_LABEL[k] ?? k }))].map((t) => {
            const active = (t.k ?? null) === (workType ?? null)
            return (
              <Link
                key={t.label}
                href={buildHref({ work_type: t.k })}
                scroll={false}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${active ? 'text-black' : 'border-white/15 text-white/70 hover:text-white'}`}
                style={active ? { backgroundColor: c.color, borderColor: c.color } : undefined}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      )}

      {worksCount === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するタイアップ実績が登録されていません。</p>
      ) : (
        <div className="mt-6 flex min-w-0 flex-col gap-8">
          {groups.map((g) => (
            <section key={g.key} className="min-w-0">
              <div className="sticky top-[57px] z-10 -mx-1 mb-3 flex items-baseline gap-3 border-b border-white/10 bg-[#0a0a0a]/95 px-1 py-2 backdrop-blur lg:top-0">
                {g.year && !year && <span className="text-xl font-black tabular-nums text-white/70">{g.year}</span>}
                <span className="text-lg font-black" style={{ color: c.color }}>{g.label}</span>
                {g.sub && <span className="text-xs text-white/40">{g.sub}</span>}
                <span className="ml-auto text-xs tabular-nums text-white/40">{g.slices.length}作品</span>
              </div>
        <ul className="flex flex-col gap-3">
          {g.slices.map(({ work: w, entries }) => {
            const part = entries[0]?.part_label ?? null
            return (
              <li key={`${w.id}|${part ?? ''}`} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  {w.work_type && (
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: `${c.color}99`, color: c.color }}>
                      {WORK_TYPE_LABEL[w.work_type] ?? w.work_type}
                    </span>
                  )}
                  <Link href={`/media/sync/${w.id}`} className="min-w-0 flex-1 truncate font-bold hover:underline">
                    {w.title}
                  </Link>
                  {w.is_original && <span className="shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-bold text-white/60">オリジナル</span>}
                  {part ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/80">{part}</span>
                  ) : (
                    w.year && <span className="shrink-0 text-xs tabular-nums text-white/40">{w.year}</span>
                  )}
                </div>
                {w.company_or_studio && <p className="mt-0.5 text-xs text-white/40">{w.company_or_studio}</p>}
                <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
                  {entries.map((e) => {
                    const track = firstOf(e.track)
                    if (!track) return null
                    const artist = firstOf(track.artist)
                    const jacket = firstOf(track.album)?.jacket_url ?? null
                    return (
                      <li key={e.id} className="min-w-0">
                        <Link href={`/tracks/${track.id}`} className="flex min-w-0 items-center gap-2 rounded-md bg-black/20 p-1.5 hover:bg-black/40">
                          <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                            {jacket && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={artworkAt(jacket, 100) ?? jacket} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">
                              {e.role && <span className="mr-1.5 text-[10px] font-black" style={{ color: c.color }}>{e.role}</span>}
                              {track.title}
                            </span>
                            {artist?.name && <span className="block truncate text-xs text-white/45">{artist.name}</span>}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )

  return (
    <HubShell
      hubKey="tieup"
      stats={stats}
      leftExtra={description}
      rightExtra={years.length > 0 ? yearSelector : undefined}
      mobileContent={
        <>
          <HubIdentity hubKey="tieup" stats={stats} />
          <div className="mt-2">{description}</div>
          {years.length > 0 && <div className="mt-6">{yearSelector}</div>}
          <div className="mt-8">{centerContent}</div>
        </>
      }
    >
      {centerContent}
    </HubShell>
  )
}
