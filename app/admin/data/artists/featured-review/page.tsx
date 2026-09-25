import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import FeaturedReviewRow from './FeaturedReviewRow'

const PAGE_SIZE = 50

export default async function FeaturedArtistReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageRaw } = await searchParams
  const page = Math.max(0, Number(pageRaw ?? 0) || 0)
  const supabase = await createClient()

  const { data: rows, count } = await supabase
    .from('featured_artist_review')
    .select('id, artist_id, track_id, extracted_name, source_title, artist:artist_id(name), track:track_id(album_id)', {
      count: 'exact',
    })
    .eq('confirmed', false)
    .eq('rejected', false)
    .order('created_at', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">確認待ちfeat.アーティスト</h1>
      <p className="mt-2 text-sm text-white/50">
        トラックタイトルの「(feat. X)」から自動作成されたアーティストの一覧です。カンマ/アンパサンド区切りの
        抽出は、まれに単一アーティスト名の一部を誤って分割してしまうことがあるため、正しく1人のアーティストを
        指しているか確認してください。「誤抽出」を選ぶと、自動作成したアーティストとこのトラックへのリンクを
        取り消します。
      </p>

      <p className="mt-4 text-xs text-white/40">
        {totalCount}件中 {page * PAGE_SIZE + 1}〜{Math.min((page + 1) * PAGE_SIZE, totalCount)}件
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {(rows ?? []).map((row) => {
          const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
          const track = Array.isArray(row.track) ? row.track[0] : row.track
          const artistName = artist?.name ?? row.extracted_name
          // 抽出したアーティスト名でのApple Music検索結果ページへのリンク。
          // このアーティストはまだapple_music_artist_idを持たない(確定前の
          // 未検証スタブな)ため、特定のアーティストページへ直接は飛べない。
          // 候補として挙がっている本人のページがどれかをここで目視確認してもらう
          // (2026-09-22、ユーザー要望で「トラックページ」から変更)
          const appleMusicSearchUrl = `https://music.apple.com/jp/search?term=${encodeURIComponent(artistName)}`
          return (
            <FeaturedReviewRow
              key={row.id}
              reviewId={row.id}
              artistId={row.artist_id}
              artistName={artistName}
              trackId={row.track_id}
              albumId={track?.album_id ?? null}
              appleMusicUrl={appleMusicSearchUrl}
              sourceTitle={row.source_title}
            />
          )
        })}
      </ul>

      {(rows ?? []).length === 0 && <p className="mt-8 text-sm text-white/40">確認待ちはありません。</p>}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center gap-3 text-sm">
          {page > 0 && (
            <Link href={`/admin/data/artists/featured-review?page=${page - 1}`} className="hover:underline">
              ← 前へ
            </Link>
          )}
          <span className="text-white/40">
            {page + 1} / {totalPages}
          </span>
          {page + 1 < totalPages && (
            <Link href={`/admin/data/artists/featured-review?page=${page + 1}`} className="hover:underline">
              次へ →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
