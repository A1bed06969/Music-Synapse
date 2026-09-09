// app/artists/[id]/awards/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistRankingAwardRows } from '@/utils/artistDetailCounts'

type AwardEntryRow = {
  id: string
  year: number | null
  category: string | null
  result: string | null
  award: { name: string } | { name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function AwardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const rows = await fetchArtistRankingAwardRows<AwardEntryRow>(
    supabase,
    'award_entry',
    id,
    'id, year, category, result, award:award_id(name)',
    { orderBy: { column: 'year', ascending: false } }
  )

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Awards</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">受賞・ノミネート歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const award = firstOf(row.award)
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{[award?.name, row.category].filter(Boolean).join(' ')}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.year ? `${row.year}年` : ''}
                  {row.result ? ` · ${row.result}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
