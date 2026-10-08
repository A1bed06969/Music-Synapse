import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { groupProgramsByRegion } from '../programGroups'
import OnAirGrid from './OnAirGrid'
import type { GridRow } from './actions'

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: `${month}-01`, end: `${next}-01` }
}

function currentMonth(): string {
  const now = new Date(Date.now() + 9 * 3600_000) // JST
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const PAGE_SIZE = 1000

export default async function OnAirGridPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? monthParam! : currentMonth()
  const { start, end } = monthRange(month)
  const supabase = await createClient()

  const { data: programs } = await supabase
    .from('media_program')
    .select('id, program_name, period_type, media:media_id(name, prefecture, area)')
    .order('program_name')
  const programGroups = groupProgramsByRegion(programs ?? [])

  type RotationRow = {
    id: string
    media_program_id: string
    period_type: string
    period_start_date: string
    music_type: string
    note: string | null
    track: { id: string; title: string; artist: { name: string } | null; album: { title: string } | null } | null
    album: { id: string; title: string; artist: { name: string } | null } | null
    artist: { id: string; name: string } | null
  }
  const rotations: RotationRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await supabase
      .from('radio_rotation')
      .select(
        'id, media_program_id, period_type, period_start_date, music_type, note, track:track_id(id, title, artist:artist_id(name), album:album_id(title)), album:album_id(id, title, artist:artist_id(name)), artist:artist_id(id, name)'
      )
      .gte('period_start_date', start)
      .lt('period_start_date', end)
      .order('period_start_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    const page = (data ?? []) as unknown as RotationRow[]
    rotations.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // 表は番組の地方順(北→南)で並べる
  const programOrder = new Map(programGroups.flatMap((g) => g.programs).map((p, i) => [p.id, i]))
  rotations.sort(
    (a, b) =>
      (programOrder.get(a.media_program_id) ?? 9999) - (programOrder.get(b.media_program_id) ?? 9999) ||
      a.period_start_date.localeCompare(b.period_start_date)
  )

  const rows: GridRow[] = rotations.map((r) => ({
    key: r.id,
    id: r.id,
    media_program_id: r.media_program_id,
    period_type: r.period_type,
    period_start_date: r.period_start_date,
    music_type: r.music_type,
    note: r.note ?? '',
    target: r.track
      ? {
          kind: 'track',
          id: r.track.id,
          label: `${r.track.title} — ${r.track.artist?.name ?? ''}${r.track.album?.title ? `(${r.track.album.title})` : ''}`,
        }
      : r.album
        ? { kind: 'album', id: r.album.id, label: `${r.album.title} — ${r.album.artist?.name ?? ''}` }
        : r.artist
          ? { kind: 'artist', id: r.artist.id, label: r.artist.name }
          : null,
  }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>
      <h1 className="mt-4 text-2xl font-bold">オンエア一覧(表で編集)</h1>
      <p className="mt-1 text-sm text-white/50">
        セルを直接書き換えて「保存」でまとめて反映します。Excelやスプレッドシートから表と同じ列順でコピーした行は、下の欄に貼り付けると新しい行として追加されます。
      </p>
      <OnAirGrid
        key={month}
        month={month}
        initialRows={rows}
        programGroups={programGroups.map((g) => ({
          region: g.region,
          programs: g.programs.map((p) => ({ id: p.id, label: p.label })),
        }))}
      />
    </div>
  )
}
