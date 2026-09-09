// app/artists/[id]/radio/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistMediaSelections } from '@/utils/fetchArtistMediaSelections'
import { formatDate } from '@/utils/format'

export default async function RadioRotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const selections = await fetchArtistMediaSelections(supabase, id)
  const rows = [...selections].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Radio Rotation</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">ラジオでの選出履歴はありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => (
            <li key={row.id} className="py-3 text-sm">
              <p className="font-medium">{row.trackTitle ?? '—'}</p>
              <p className="mt-0.5 text-xs text-white/40">
                {row.date ? formatDate(row.date) : ''}
                {row.mediaName ? ` · ${row.mediaName}` : ''}
                {row.programName ? ` ${row.programName}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
