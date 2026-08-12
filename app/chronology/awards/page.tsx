import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

export default async function AwardsPage() {
  const supabase = await createClient()

  const { data: entries } = await supabase
    .from('award_entry')
    .select(
      'id, year, category, result, award:award_id(id, name), artist:artist_id(id, name), album:album_id(id, title), track:track_id(id, title)'
    )
    .order('year', { ascending: false })

  type AwardRow = {
    id: number
    year: number
    category: string | null
    result: string
    label: string
    href: string | null
  }
  type AwardGroup = { awardName: string; rows: AwardRow[] }

  const byAward = new Map<string, AwardGroup>()

  for (const row of entries ?? []) {
    const award = Array.isArray(row.award) ? row.award[0] : row.award
    if (!award) continue
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
    const album = Array.isArray(row.album) ? row.album[0] : row.album
    const track = Array.isArray(row.track) ? row.track[0] : row.track

    const label = artist?.name ?? album?.title ?? track?.title ?? '?'
    const href = artist ? `/artists/${artist.id}` : album ? `/albums/${album.id}` : track ? `/tracks/${track.id}` : null

    const group: AwardGroup = byAward.get(award.id) ?? { awardName: award.name, rows: [] }
    group.rows.push({ id: row.id, year: row.year, category: row.category, result: row.result, label, href })
    byAward.set(award.id, group)
  }

  const groups = Array.from(byAward.values())

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">アワード・コンテスト</h1>
      <p className="mt-2 text-sm text-white/50">受賞・ノミネート履歴のアーカイブです。</p>

      {groups.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">まだ受賞・ノミネートデータが登録されていません。</p>
      ) : (
        groups.map((group) => (
          <section key={group.awardName} className="mt-10 border-t border-white/10 pt-6">
            <h2 className="text-lg font-semibold">{group.awardName}</h2>
            <ul className="mt-3 divide-y divide-white/10">
              {group.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="text-white/40">{row.year}</span>{' '}
                    {row.href ? (
                      <Link href={row.href} className="hover:text-white/70">
                        {row.label}
                      </Link>
                    ) : (
                      row.label
                    )}
                    {row.category && <span className="text-white/30"> ・ {row.category}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                      row.result === 'winner'
                        ? 'border-amber-400/40 text-amber-300'
                        : 'border-white/15 text-white/50'
                    }`}
                  >
                    {row.result === 'winner' ? '🏆 受賞' : 'ノミネート'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
