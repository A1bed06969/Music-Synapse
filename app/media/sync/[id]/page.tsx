import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  tv_program: 'テレビ番組',
}

export default async function SyncWorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: work, error } = await supabase
    .from('sync_work')
    .select('id, title, work_type, company_or_studio, year')
    .eq('id', id)
    .single()

  if (error || !work) {
    notFound()
  }

  const { data: entries } = await supabase
    .from('sync_entry')
    .select('id, usage_detail, track:track_id(id, title, artist:artist_id(id, name))')
    .eq('sync_work_id', id)

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/media/sync" className="text-xs text-white/40 hover:text-white/70">
        ← タイアップ・シンクロアーカイブ
      </Link>

      <p className="mt-4 text-xs text-white/40">
        {work.work_type ? WORK_TYPE_LABEL[work.work_type] ?? work.work_type : ''}
        {work.year ? ` · ${work.year}` : ''}
      </p>
      <h1 className="mt-1 text-2xl font-bold">{work.title}</h1>
      {work.company_or_studio && <p className="mt-1 text-sm text-white/50">{work.company_or_studio}</p>}

      {!entries || entries.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">まだ起用楽曲が登録されていません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {entries.map((entry) => {
            const track = Array.isArray(entry.track) ? entry.track[0] : entry.track
            const artist = track ? (Array.isArray(track.artist) ? track.artist[0] : track.artist) : null
            return (
              <li key={entry.id} className="py-3">
                {track ? (
                  <Link href={`/tracks/${track.id}`} className="font-medium hover:opacity-70">
                    {track.title}
                  </Link>
                ) : (
                  <span className="font-medium">—</span>
                )}
                {artist && <span className="ml-2 text-xs text-white/40">{artist.name}</span>}
                {entry.usage_detail && <p className="mt-0.5 text-xs text-white/40">{entry.usage_detail}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
