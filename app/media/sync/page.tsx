import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  tv_program: 'テレビ番組',
}

export default async function SyncArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; work_type?: string }>
}) {
  const { q, work_type: workType } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('sync_work')
    .select('id, title, work_type, company_or_studio, year, sync_entry(track:track_id(id, title, artist:artist_id(name)))')
    .order('year', { ascending: false })

  if (q) query = query.ilike('title', `%${q}%`)
  if (workType) query = query.eq('work_type', workType)

  const { data: works } = await query

  const groups = new Map<string, typeof works>()
  for (const w of works ?? []) {
    const key = w.work_type ?? 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(w)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">タイアップ・シンクロアーカイブ</h1>
      <p className="mt-2 text-sm text-white/50">TV / CM / アニメ / ゲーム / 映画で使われた楽曲のアーカイブ。</p>

      <form className="mt-6 flex flex-wrap gap-2" action="/media/sync">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="CM・アニメ・番組名・曲名で検索..."
          className="flex-1 min-w-[200px] rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <select
          name="work_type"
          defaultValue={workType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">起用種別: すべて</option>
          {Object.entries(WORK_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          検索
        </button>
      </form>

      {!works || works.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するタイアップ実績が登録されていません。</p>
      ) : (
        Array.from(groups.entries()).map(([type, items]) => (
          <section key={type} className="mt-10">
            <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">
              {WORK_TYPE_LABEL[type] ?? type}
            </h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <tbody>
                {(items ?? []).map((w) => {
                  const entries = Array.isArray(w.sync_entry) ? w.sync_entry : []
                  return (
                    <tr key={w.id} className="border-b border-white/5">
                      <td className="py-2 pr-3">
                        <Link href={`/media/sync/${w.id}`} className="font-medium hover:opacity-70">
                          {w.title}
                        </Link>
                        {w.company_or_studio && <p className="text-xs text-white/40">{w.company_or_studio}</p>}
                      </td>
                      <td className="py-2 pr-3 text-white/60">
                        {entries.map((e, i) => {
                          const track = Array.isArray(e.track) ? e.track[0] : e.track
                          if (!track) return null
                          const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist
                          return (
                            <Link key={i} href={`/tracks/${track.id}`} className="block hover:opacity-70">
                              {track.title}
                              {artist?.name && <span className="text-white/40"> — {artist.name}</span>}
                            </Link>
                          )
                        })}
                      </td>
                      <td className="py-2 text-right text-white/40">{w.year}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  )
}
