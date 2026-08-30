import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import RankingEntryRow from './RankingEntryRow'

const PAGE_SIZE = 15

export default async function RankingMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { id: rankingId } = await params
  const { page: pageParam } = await searchParams
  const currentPage = Math.max(1, Number(pageParam) || 1)
  const supabase = await createClient()

  const { data: ranking, error: rankingError } = await supabase
    .from('ranking')
    .select('id, name')
    .eq('id', rankingId)
    .single()

  if (rankingError || !ranking) {
    notFound()
  }

  // ディスクガイド確認画面と同じく「最小限スタブ登録(streaming_status:
  // unreleased)」を未マッチ扱いの目印として使う。ただしTower Records/Discogsから
  // 取込済み(tower_url/discogs_urlが付いている)ものは、Apple Musicには無いが
  // 既に人力で確認済みの正当なデータのため、未マッチ扱いから除外する
  const { data: allStubEntries, count } = await supabase
    .from('ranking_entry')
    .select('id, album:album_id!inner(streaming_status, tower_url, discogs_url)', { count: 'exact' })
    .eq('ranking_id', rankingId)
    .eq('album.streaming_status', 'unreleased')
    .is('album.tower_url', null)
    .is('album.discogs_url', null)
    .order('id', { ascending: true })
    .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1)

  const pageEntryIds = (allStubEntries ?? []).map((e) => e.id)

  const { data: entries } = pageEntryIds.length
    ? await supabase
        .from('ranking_entry')
        .select('id, album:album_id(id, title, artist_id, artist:artist_id(id, name))')
        .in('id', pageEntryIds)
        .order('id', { ascending: true })
    : { data: [] }

  const rows = (entries ?? []).map((e) => {
    const album = Array.isArray(e.album) ? e.album[0] : e.album
    const artist = album ? (Array.isArray(album.artist) ? album.artist[0] : album.artist) : null
    return {
      entryId: e.id,
      oldAlbumId: album?.id ?? null,
      oldArtistId: artist?.id ?? null,
      artistName: artist?.name ?? '',
      title: album?.title ?? '',
    }
  })

  const matched = await matchAlbumsWithCandidates(
    supabase,
    rows.map((r) => ({ title: r.title, artist_name: r.artistName, exclude_album_id: r.oldAlbumId ?? undefined }))
  )

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/curation" className="text-xs text-white/40 hover:text-white/70">
        ← キュレーションコンテンツに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{ranking.name} — 候補マッチング</h1>
      <p className="mt-2 text-sm text-white/50">
        自動登録時にApple Musicと確実に一致しなかった{count ?? 0}件です。ジャケット付きの候補から選んで、実データに差し替えられます。
      </p>

      <ul className="mt-8 space-y-3">
        {rows.map((row, i) => {
          // matchAlbumsWithCandidatesはrowsと同じ順序でextracted_index=0..n-1を
          // 割り振って返すため、そのままindexで対応付けてよい
          const match = matched[i]
          const candidates = match?.candidates ?? []
          const defaultMatch = match?.album_id && candidates.some((c) => c.id === match.album_id) ? match.album_id : 'new'
          return (
            <RankingEntryRow
              key={row.entryId}
              rankingId={rankingId}
              entryId={row.entryId}
              artistName={row.artistName}
              title={row.title}
              oldAlbumId={row.oldAlbumId}
              oldArtistId={row.oldArtistId}
              candidates={candidates}
              defaultCandidateId={defaultMatch}
            />
          )
        })}
        {rows.length === 0 && <p className="text-sm text-white/30">未マッチの候補はもうありません。</p>}
      </ul>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          {currentPage > 1 ? (
            <Link
              href={`/admin/data/curation/${rankingId}/match?page=${currentPage - 1}`}
              className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
            >
              ← 前へ
            </Link>
          ) : (
            <span className="rounded-md border border-white/5 px-3 py-1.5 text-white/20">← 前へ</span>
          )}
          <span className="text-white/50">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={`/admin/data/curation/${rankingId}/match?page=${currentPage + 1}`}
              className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
            >
              次へ →
            </Link>
          ) : (
            <span className="rounded-md border border-white/5 px-3 py-1.5 text-white/20">次へ →</span>
          )}
        </div>
      )}
    </div>
  )
}
