// app/admin/data/sync/review/page.tsx
//
// Wikipediaなどから集めたタイアップ候補(sync_candidate)のうち、自動では確定できなかったものを人が確認する画面。
//  - 確認待ち: 自動で曲が決まりきらなかったもの(同じ盤に同名の曲が複数・歌い手の記載なし)
//  - 未登録: カタログにアーティスト/曲が無いもの(カタログから別の曲を探して紐付けるか、却下する)
//  - 低確信: 自動で反映したが確信度が1未満のもの(コラボ名義などで紐付けたもの)。OKか、外すかを選ぶ
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import ReviewRow, { type ReviewItem } from './ReviewRow'

type Tab = 'review' | 'unmatched' | 'lowconf'
const TABS: { key: Tab; label: string }[] = [
  { key: 'review', label: '確認待ち' },
  { key: 'unmatched', label: '未登録' },
  { key: 'lowconf', label: '低確信(反映済み)' },
]

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function SyncReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams
  const tab: Tab = tabParam === 'unmatched' || tabParam === 'lowconf' ? tabParam : 'review'
  const supabase = await createClient()

  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
  const [nReview, nUnmatched, nLow] = await Promise.all([
    count(supabase.from('sync_candidate').select('*', { count: 'exact', head: true }).eq('status', 'needs_review')),
    count(supabase.from('sync_candidate').select('*', { count: 'exact', head: true }).eq('status', 'unmatched')),
    count(supabase.from('sync_entry').select('*', { count: 'exact', head: true }).lt('confidence', 1)),
  ])
  const counts: Record<Tab, number> = { review: nReview, unmatched: nUnmatched, lowconf: nLow }

  let items: ReviewItem[] = []
  if (tab === 'lowconf') {
    const { data } = await supabase
      .from('sync_entry')
      .select('id, role, usage_detail, source_url, match_method, confidence, work:sync_work_id(title, work_type), track:track_id(id, title, artist:artist_id(name), album:album_id(title))')
      .lt('confidence', 1)
      .order('id', { ascending: false })
      .limit(200)
    items = (data ?? []).map((e) => {
      const work = firstOf(e.work)
      const track = firstOf(e.track)
      return {
        kind: 'entry' as const,
        id: e.id,
        workTitle: work?.title ?? '—',
        workType: work?.work_type ?? '',
        role: e.role,
        songTitle: track?.title ?? '—',
        artistName: firstOf(track?.artist)?.name ?? null,
        note: e.usage_detail,
        sourceUrl: e.source_url ?? '#',
        reason: `${e.match_method === 'artist_prefix' ? 'コラボ名義の曲として一致' : e.match_method}(確信度 ${e.confidence})`,
        suggested: track ? { id: track.id, title: track.title, artist: firstOf(track.artist)?.name ?? null, album: firstOf(track.album)?.title ?? null } : null,
      }
    })
  } else {
    const { data } = await supabase
      .from('sync_candidate')
      .select('id, work_title, work_type, role, song_title, artist_name, note, source_url, match_reason, matched_track:matched_track_id(id, title, artist:artist_id(name), album:album_id(title))')
      .eq('status', tab === 'review' ? 'needs_review' : 'unmatched')
      .order('work_title')
      .limit(300)
    items = (data ?? []).map((c) => {
      const t = firstOf(c.matched_track)
      return {
        kind: 'candidate' as const,
        id: c.id,
        workTitle: c.work_title,
        workType: c.work_type,
        role: c.role || null,
        songTitle: c.song_title,
        artistName: c.artist_name || null,
        note: c.note,
        sourceUrl: c.source_url,
        reason: c.match_reason,
        suggested: t ? { id: t.id, title: t.title, artist: firstOf(t.artist)?.name ?? null, album: firstOf(t.album)?.title ?? null } : null,
      }
    })
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <Link href="/admin/data/sync" className="text-xs text-white/40 hover:text-white/70">
        ← タイアップ
      </Link>
      <h1 className="mt-4 text-2xl font-bold">タイアップ候補の確認</h1>
      <p className="mt-2 text-sm text-white/50">
        Wikipediaなどから集めたタイアップのうち、自動では確定できなかったものを確認します。確認した紐付けは、公開ページ(曲ページ・TIE-UP TIME MACHINE)に出ます。
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/data/sync/review?tab=${t.key}`}
            aria-current={t.key === tab ? 'page' : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold transition ${t.key === tab ? 'border-fuchsia-300 bg-fuchsia-300 text-black' : 'border-white/20 text-white/70 hover:text-white'}`}
          >
            {t.label}
            <span className="ml-2 tabular-nums opacity-70">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">確認するものはありません。</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <ReviewRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}
