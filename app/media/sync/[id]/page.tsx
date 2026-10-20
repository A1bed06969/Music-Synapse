import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  drama: 'ドラマ',
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
    .select('id, title, work_type, company_or_studio, year, source_url')
    .eq('id', id)
    .single()

  if (error || !work) {
    notFound()
  }

  const { data: entries } = await supabase
    .from('sync_entry')
    .select('id, usage_detail, role, source_url, track:track_id(id, title, artist:artist_id(id, name))')
    .eq('sync_work_id', id)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/media/sync" className="text-xs text-white/40 hover:text-white/70">
        ← タイアップ・シンクロアーカイブ
      </Link>

      <p className="mt-4 text-xs text-white/40">
        {work.work_type ? WORK_TYPE_LABEL[work.work_type] ?? work.work_type : ''}
        {work.year ? ` · ${work.year}` : ''}
      </p>
      <h1 className="mt-1 text-2xl font-bold">{work.title}</h1>
      {work.company_or_studio && <p className="mt-1 text-sm text-white/50">{work.company_or_studio}</p>}
      {work.source_url && (
        <a href={work.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-white/30 underline hover:text-white/60">
          出典(Wikipedia)
        </a>
      )}

      {!entries || entries.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">まだ起用楽曲が登録されていません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {entries.map((entry) => {
            const track = Array.isArray(entry.track) ? entry.track[0] : entry.track
            const artist = track ? (Array.isArray(track.artist) ? track.artist[0] : track.artist) : null
            return (
              <li key={entry.id} className="py-3">
                {entry.role && (
                  <span className="mr-2 rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-black tracking-wide text-white/70">{entry.role}</span>
                )}
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
