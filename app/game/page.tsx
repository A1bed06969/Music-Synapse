import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { artworkAt } from '@/utils/artworkSize'
import { fetchThemeAlbums, fetchThemes } from '@/utils/gameData'

const ACCENT = '#3fd0e0'
const JST_OFFSET_MS = 9 * 3600 * 1000

function jstDay(date: Date | string): number {
  return Math.floor((new Date(date).getTime() + JST_OFFSET_MS) / 86_400_000)
}

/** 遊んだ日(日本時間)が今日(または昨日)から途切れず続いている日数 */
function playStreak(playedAt: string[]): number {
  const days = new Set(playedAt.map(jstDay))
  const today = jstDay(new Date())
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null
  if (cursor === null) return 0
  let streak = 0
  while (days.has(cursor)) {
    streak++
    cursor--
  }
  return streak
}

export default async function GameHomePage() {
  const supabase = await createClient()
  const themes = await fetchThemes(supabase)

  const [{ data: collectionRows }, { data: playRows }, themeAlbums] = await Promise.all([
    supabase.from('game_collection').select('album_id'),
    supabase.from('game_play_log').select('played_at').order('played_at', { ascending: false }).limit(400),
    Promise.all(themes.map((t) => fetchThemeAlbums(supabase, t.id))),
  ])
  const collected = new Set((collectionRows ?? []).map((r) => r.album_id as string))
  const streak = playStreak((playRows ?? []).map((r) => r.played_at as string))

  const cards = themes
    .map((t, i) => {
      const albums = themeAlbums[i]
      const have = albums.filter((a) => collected.has(a.albumId)).length
      // ジャケットは、持っているものを優先して数枚並べる(無ければ先頭から)
      const sample = [...albums.filter((a) => collected.has(a.albumId)), ...albums].slice(0, 4)
      return { theme: t, total: albums.length, have, sample, playable: new Set(albums.map((a) => a.artistName)).size >= 6 }
    })
    .filter((c) => c.total > 0)

  // 今日のお題: 日付で決まるテーマを先頭に出す(毎日変わる)
  const todayIndex = cards.length > 0 ? jstDay(new Date()) % cards.length : -1
  const ordered = cards.length > 0 ? [cards[todayIndex], ...cards.filter((_, i) => i !== todayIndex)] : []

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <p className="text-[11px] font-bold tracking-[0.2em]" style={{ color: ACCENT }}>
        JACKET MEMORY
      </p>
      <h1 className="mt-1 text-2xl font-black leading-tight">ジャケット神経衰弱</h1>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        ジャケットと、そのアーティスト名のペアを揃えよう。揃えたジャケットは図鑑に集まります。1枚目をめくると、そのアルバムの曲が流れます。
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <span className="rounded-full border border-white/15 px-3 py-1">
          連続プレイ <span className="font-black tabular-nums" style={{ color: ACCENT }}>{streak}</span> 日
        </span>
        <span className="rounded-full border border-white/15 px-3 py-1">
          図鑑 <span className="font-black tabular-nums" style={{ color: ACCENT }}>{collected.size}</span> 枚
        </span>
      </div>

      <h2 className="mt-8 text-[11px] font-bold tracking-[0.2em] text-white/40">THEME</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered.map((c, i) => {
          const pct = c.total > 0 ? Math.round((c.have / c.total) * 100) : 0
          return (
            <li key={c.theme.id} className="rounded-xl border p-3" style={{ borderColor: i === 0 ? `${ACCENT}99` : 'rgba(255,255,255,0.1)', backgroundColor: i === 0 ? `${ACCENT}10` : 'rgba(255,255,255,0.03)' }}>
              {i === 0 && (
                <p className="mb-2 text-[11px] font-black tracking-[0.14em]" style={{ color: ACCENT }}>
                  TODAY&apos;S THEME ・ 今日のお題
                </p>
              )}
              <div className="flex gap-3">
                <div className="grid h-20 w-20 shrink-0 grid-cols-2 gap-px overflow-hidden rounded-md bg-white/5">
                  {c.sample.map((a) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={a.albumId} src={artworkAt(a.jacketUrl, 120) ?? a.jacketUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-white/40">DISC GUIDE{c.theme.publisher ? ` ・ ${c.theme.publisher}` : ''}{c.theme.year ? ` ・ ${c.theme.year}年` : ''}</p>
                  <p className="mt-0.5 text-sm font-black leading-snug">{c.theme.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: ACCENT }} />
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-white/60">
                      {c.have}/{c.total}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {c.playable ? (
                  <Link href={`/game/play/${c.theme.id}`} className="rounded-md px-4 py-2.5 text-sm font-black text-black" style={{ backgroundColor: ACCENT }}>
                    あそぶ
                  </Link>
                ) : (
                  <span className="rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/30">準備中</span>
                )}
                <Link href={`/game/collection/${c.theme.id}`} className="rounded-md border border-white/20 px-4 py-2.5 text-sm font-bold hover:bg-white/5">
                  図鑑
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
