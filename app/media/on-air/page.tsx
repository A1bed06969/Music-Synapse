import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'
import PrefectureMap, { type PrefectureMapData } from '@/app/components/PrefectureMap'

const MUSIC_TYPE_LABEL: Record<string, string> = {
  DOMESTIC: '邦楽',
  OVERSEAS: '洋楽',
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7)
}

function monthLabel(month: string) {
  const [y, m] = month.split('-')
  return `${y}年${Number(m)}月`
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const nextMonthDate = new Date(Date.UTC(y, m, 1))
  const end = nextMonthDate.toISOString().slice(0, 10)
  return { start, end }
}

function buildQuery(params: Record<string, string | undefined>) {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value)
  }
  const qs = usp.toString()
  return qs ? `/media/on-air?${qs}` : '/media/on-air'
}

export default async function OnAirPage({
  searchParams,
}: {
  searchParams: Promise<{ media?: string; music_type?: string; month?: string }>
}) {
  const { media: mediaId, music_type: musicType, month: monthParam } = await searchParams
  const supabase = await createClient()

  const [{ data: mediaList }, { data: allDates }] = await Promise.all([
    supabase.from('media').select('id, name, area').order('name'),
    supabase.from('radio_rotation').select('period_start_date').order('period_start_date', { ascending: true }),
  ])

  const availableMonths = Array.from(new Set((allDates ?? []).map((d) => monthKey(d.period_start_date))))
  const currentMonth = monthParam || availableMonths[availableMonths.length - 1] || new Date().toISOString().slice(0, 7)
  const monthIndex = availableMonths.indexOf(currentMonth)
  const prevMonth = monthIndex > 0 ? availableMonths[monthIndex - 1] : null
  const nextMonth = monthIndex >= 0 && monthIndex < availableMonths.length - 1 ? availableMonths[monthIndex + 1] : null
  const { start: monthStart, end: monthEnd } = monthRange(currentMonth)

  let query = supabase
    .from('radio_rotation')
    .select(
      `id, period_type, period_start_date, music_type, note,
       media_program:media_program_id!inner(program_name, media_id, media:media_id(id, name)),
       track:track_id(id, title, artist:artist_id(name)),
       album:album_id(id, title, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .gte('period_start_date', monthStart)
    .lt('period_start_date', monthEnd)
    .order('period_start_date', { ascending: false })

  if (mediaId) {
    query = query.eq('media_program.media_id', mediaId)
  }
  if (musicType) {
    query = query.eq('music_type', musicType)
  }

  const { data: rotations } = await query

  // 今月のパワープレイ&ヘビロテ ランキング(局横断・選出局数順)。フィルターに関わらず月全体を集計
  const { data: monthRows } = await supabase
    .from('radio_rotation')
    .select(
      `track_id, album_id, artist_id, music_type,
       media_program:media_program_id(media_id, media:media_id(name, prefecture)),
       track:track_id(id, title, artist:artist_id(name)),
       album:album_id(id, title, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .gte('period_start_date', monthStart)
    .lt('period_start_date', monthEnd)

  type RankingRow = {
    key: string
    label: string
    sub: string | null
    href: string
    musicType: string
    mediaIds: Set<string>
  }
  const rankingMap = new Map<string, RankingRow>()
  for (const row of monthRows ?? []) {
    const key = row.track_id ?? row.album_id ?? row.artist_id
    if (!key) continue
    const program = firstOf(row.media_program)
    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null

    if (!rankingMap.has(key)) {
      rankingMap.set(key, {
        key,
        label: track?.title ?? album?.title ?? artist?.name ?? '—',
        sub: track ? (trackArtist?.name ?? null) : album ? (albumArtist?.name ?? null) : null,
        href: track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : '',
        musicType: row.music_type,
        mediaIds: new Set(),
      })
    }
    if (program?.media_id) rankingMap.get(key)!.mediaIds.add(program.media_id)
  }
  const ranking = Array.from(rankingMap.values())
    .sort((a, b) => b.mediaIds.size - a.mediaIds.size)
    .slice(0, 20)

  type PrefectureAgg = {
    prefecture: string
    mediaIds: Set<string>
    entries: PrefectureMapData['entries']
  }
  const prefMap = new Map<string, PrefectureAgg>()
  for (const row of monthRows ?? []) {
    const program = firstOf(row.media_program)
    const media = program ? firstOf(program.media) : null
    if (!media?.prefecture) continue

    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null

    const baseLabel = track?.title ?? album?.title ?? artist?.name ?? '—'
    const sub = track ? trackArtist?.name : album ? albumArtist?.name : null
    const targetHref = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null

    if (!prefMap.has(media.prefecture)) {
      prefMap.set(media.prefecture, { prefecture: media.prefecture, mediaIds: new Set(), entries: [] })
    }
    const agg = prefMap.get(media.prefecture)!
    if (program?.media_id) agg.mediaIds.add(program.media_id)
    agg.entries.push({
      stationName: media.name,
      targetLabel: sub ? `${baseLabel} — ${sub}` : baseLabel,
      targetHref,
      musicType: row.music_type as 'DOMESTIC' | 'OVERSEAS',
    })
  }
  const prefectureData: PrefectureMapData[] = Array.from(prefMap.values()).map((agg) => ({
    prefecture: agg.prefecture,
    mediaCount: agg.mediaIds.size,
    entries: agg.entries,
  }))

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">パワープレイ&ヘビロテ</h1>
      <p className="mt-2 text-sm text-white/50">全国ラジオ局の週間・月間プッシュ楽曲データ。</p>

      <div className="mt-6 flex items-center gap-3">
        {prevMonth ? (
          <Link
            href={buildQuery({ media: mediaId, music_type: musicType, month: prevMonth })}
            className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            ← 前月
          </Link>
        ) : (
          <span className="rounded-md border border-white/5 px-3 py-1.5 text-sm text-white/20">← 前月</span>
        )}
        <span className="min-w-[110px] text-center text-sm font-semibold">{monthLabel(currentMonth)}</span>
        {nextMonth ? (
          <Link
            href={buildQuery({ media: mediaId, music_type: musicType, month: nextMonth })}
            className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            次月 →
          </Link>
        ) : (
          <span className="rounded-md border border-white/5 px-3 py-1.5 text-sm text-white/20">次月 →</span>
        )}

        {availableMonths.length > 0 && (
          <form action="/media/on-air" className="ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
            <input type="hidden" name="media" value={mediaId ?? ''} />
            <input type="hidden" name="music_type" value={musicType ?? ''} />
            <select
              name="month"
              defaultValue={currentMonth}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white focus:border-white/30 focus:outline-none"
            >
              {availableMonths
                .slice()
                .reverse()
                .map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
            </select>
            <button type="submit" className="text-xs text-white/40 hover:text-white/70">
              移動
            </button>
          </form>
        )}
      </div>

      <div className="mt-8">
        <PrefectureMap data={prefectureData} />
      </div>

      {ranking.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">🏆 {monthLabel(currentMonth)}のパワープレイ&ヘビロテ ランキング</h2>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-white/40">
                <th className="py-2 pr-2">#</th>
                <th className="py-2">曲 / アーティスト</th>
                <th className="py-2 text-right">選出局数</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.key} className="border-b border-white/5">
                  <td className="py-2 pr-2 font-bold text-white/40">{i + 1}</td>
                  <td className="py-2">
                    {r.href ? (
                      <Link href={r.href} className="font-medium hover:opacity-70">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                    {r.sub && <span className="ml-2 text-xs text-white/40">{r.sub}</span>}
                    <span className="ml-2 text-xs text-white/30">({MUSIC_TYPE_LABEL[r.musicType]})</span>
                  </td>
                  <td className="py-2 text-right text-white/60">{r.mediaIds.size}局</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <h2 className="mt-10 text-lg font-semibold">エントリ一覧</h2>
      <form className="mt-4 flex flex-wrap gap-2" action="/media/on-air">
        <input type="hidden" name="month" value={currentMonth} />
        <select
          name="media"
          defaultValue={mediaId ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">すべての局</option>
          {(mediaList ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.area ? `(${m.area})` : ''}
            </option>
          ))}
        </select>
        <select
          name="music_type"
          defaultValue={musicType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">邦楽・洋楽すべて</option>
          <option value="DOMESTIC">邦楽</option>
          <option value="OVERSEAS">洋楽</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          絞り込む
        </button>
      </form>

      {!rotations || rotations.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">この月のオンエアデータはまだ登録されていません。</p>
      ) : (
        <ul className="mt-6 divide-y divide-white/10">
          {rotations.map((row) => {
            const program = firstOf(row.media_program)
            const media = program ? firstOf(program.media) : null
            const track = firstOf(row.track)
            const album = firstOf(row.album)
            const artist = firstOf(row.artist)
            const trackArtist = track ? firstOf(track.artist) : null
            const albumArtist = album ? firstOf(album.artist) : null

            const targetLabel = track?.title ?? album?.title ?? artist?.name ?? '—'
            const targetHref = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null
            const subLabel = track ? trackArtist?.name : album ? albumArtist?.name : null

            return (
              <li key={row.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  {targetHref ? (
                    <Link href={targetHref} className="font-medium hover:opacity-70">
                      {targetLabel}
                    </Link>
                  ) : (
                    <span className="font-medium">{targetLabel}</span>
                  )}
                  {subLabel && <p className="text-xs text-white/40">{subLabel}</p>}
                </div>
                <div className="shrink-0 text-right text-xs text-white/40">
                  <p>
                    {media?.name} {program?.program_name}
                  </p>
                  <p>
                    {formatDate(row.period_start_date)}({row.period_type === 'weekly' ? '週間' : '月間'}) ·{' '}
                    {MUSIC_TYPE_LABEL[row.music_type]}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
