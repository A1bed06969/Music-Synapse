// app/artists/[id]/ranking/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'
import { buildArtistRankingAwardFilter } from '@/utils/artistDetailCounts'

type RankingEntryRow = {
  id: string
  period_date: string | null
  rank: number | null
  ranking: { id: string; name: string } | { id: string; name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function RankingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, id)
  const { data } = await supabase
    .from('ranking_entry')
    .select('id, period_date, rank, ranking:ranking_id!inner(id, name)')
    .or(rankingAwardFilter)
    .order('period_date', { ascending: false })
    .overrideTypes<RankingEntryRow[], { merge: false }>()

  const rows = data ?? []

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Ranking</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">ランキング掲載履歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const ranking = firstOf(row.ranking)
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{ranking?.name ?? '—'}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.period_date ? formatDate(row.period_date) : ''}
                  {row.rank ? ` · #${row.rank}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
