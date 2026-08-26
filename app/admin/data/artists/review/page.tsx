import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import ImageQueueRow from './ImageQueueRow'
import NameQueueRow from './NameQueueRow'

const PAGE_SIZE = 50

type Tab = 'image' | 'name'

function pageHref(tab: Tab, page: number) {
  return `/admin/data/artists/review?tab=${tab}${page > 0 ? `&page=${page}` : ''}`
}

export default async function ArtistReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const { tab: tabRaw, page: pageRaw } = await searchParams
  const tab: Tab = tabRaw === 'name' ? 'name' : 'image'
  const page = Math.max(0, Number(pageRaw ?? 0) || 0)
  const supabase = await createClient()

  type NameReviewRow = { id: string; name: string; name_kana: string | null; name_en: string | null; total_count: number }

  let totalCount = 0
  let imageRows: { id: string; name: string }[] = []
  let nameRows: NameReviewRow[] = []

  if (tab === 'image') {
    const { data, count } = await supabase
      .from('artist')
      .select('id, name', { count: 'exact' })
      .is('apple_music_artist_id', null)
      .is('image_match_skipped_at', null)
      .order('name')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    imageRows = data ?? []
    totalCount = count ?? 0
  } else {
    const { data } = await supabase.rpc('artists_needing_name_review', {
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    })
    nameRows = (data ?? []) as NameReviewRow[]
    totalCount = nameRows[0]?.total_count ? Number(nameRows[0].total_count) : 0
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">確認待ちアーティスト</h1>
      <p className="mt-2 text-sm text-white/50">
        フェス出演・ジャンル年表・ディスクガイド等で自動登録され、情報が薄いままのアーティストを確認していく画面です。
        「該当なし」「空欄のまま保存」を選ぶと、以後この一覧には出てきません。
      </p>

      <div className="mt-6 flex gap-2">
        <Link
          href={pageHref('image', 0)}
          className={`rounded-full border px-4 py-1.5 text-sm ${
            tab === 'image' ? 'border-white bg-white text-black font-medium' : 'border-white/15 text-white/60 hover:border-white/30'
          }`}
        >
          画像・Apple Music未確定
        </Link>
        <Link
          href={pageHref('name', 0)}
          className={`rounded-full border px-4 py-1.5 text-sm ${
            tab === 'name' ? 'border-white bg-white text-black font-medium' : 'border-white/15 text-white/60 hover:border-white/30'
          }`}
        >
          かな・英語表記未確定
        </Link>
      </div>

      <p className="mt-4 text-xs text-white/40">
        {totalCount}件中 {page * PAGE_SIZE + 1}〜{Math.min((page + 1) * PAGE_SIZE, totalCount)}件を表示
      </p>

      {tab === 'image' ? (
        imageRows.length === 0 ? (
          <p className="mt-8 text-sm text-white/40">確認待ちのアーティストはいません。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {imageRows.map((a) => (
              <ImageQueueRow key={a.id} artistId={a.id} name={a.name} />
            ))}
          </ul>
        )
      ) : nameRows.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">確認待ちのアーティストはいません。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {nameRows.map((a) => (
            <NameQueueRow key={a.id} artistId={a.id} name={a.name} initialKana={a.name_kana} initialEn={a.name_en} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center gap-3 text-xs text-white/50">
          {page > 0 && (
            <Link href={pageHref(tab, page - 1)} className="hover:text-white">
              ← 前へ
            </Link>
          )}
          <span>
            {page + 1} / {totalPages}
          </span>
          {page + 1 < totalPages && (
            <Link href={pageHref(tab, page + 1)} className="hover:text-white">
              次へ →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
