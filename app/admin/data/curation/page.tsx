import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks, searchAlbums, searchArtists } from '../actions'
import { createRanking, createRankingEntry } from './actions'

type StubCheckRow = {
  ranking_id: string
  album: { streaming_status: string | null; tower_url: string | null; discogs_url: string | null } | { streaming_status: string | null; tower_url: string | null; discogs_url: string | null }[] | null
}

export default async function CurationPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  // ranking_entryは2432件超あり、PostgRESTの1リクエストあたり行数上限(既定1000件)を
  // 超えている。単純な.select()だと後半のエントリが「要マッチング」件数の集計から
  // 欠落する(実際に「要マッチング204件」のような表示が過小になっていた)。
  // fetchAllRowsでページネーションして全件取得する。
  // (以前はこのページ自体に企画ごとの全エントリ一覧も表示していたが、2432件を
  // 毎回丸ごとレンダリングするのが重く、正確な件数を取るためにページネーションで
  // 全件取得するとさらに悪化したため、一覧表示は削除し各企画から既存の詳細
  // ページ(公開一覧/media/features、マッチング画面)へのリンクに置き換えた)
  const [{ data: mediaList }, { data: rankings }, stubRows] = await Promise.all([
    supabase.from('media').select('id, name').order('name'),
    supabase.from('ranking').select('id, name, source, list_type, media:media_id(name)').order('name'),
    fetchAllRows<StubCheckRow>(
      supabase,
      'ranking_entry',
      'ranking_id, album:album_id(streaming_status, tower_url, discogs_url)',
      'id'
    ),
  ])

  const mediaOptions = mediaList ?? []
  const rankingOptions = rankings ?? []

  const stubCountByRanking = new Map<string, number>()
  for (const row of stubRows) {
    const album = Array.isArray(row.album) ? row.album[0] : row.album
    if (album?.streaming_status !== 'unreleased') continue
    if (album.tower_url || album.discogs_url) continue
    stubCountByRanking.set(row.ranking_id, (stubCountByRanking.get(row.ranking_id) ?? 0) + 1)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">キュレーションコンテンツ</h1>
        <Link href="/media/features" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createRanking} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input name="name" placeholder="企画名(例: 最注目新人100)" required className={`${inputClass} max-w-xs`} />
          <select name="media_id" className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="">出典メディア(任意)</option>
            {mediaOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input name="source" placeholder="出典(メディア未登録の場合の自由記述)" className={`${inputClass} max-w-xs`} />
          <select name="list_type" className={`${inputClass} max-w-[160px]`} defaultValue="ranked">
            <option value="ranked">順位あり(ランキング)</option>
            <option value="selection">選出のみ(順不同)</option>
          </select>
        </div>
        <input name="description" placeholder="概要(任意)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          企画を追加
        </button>
      </form>

      {rankingOptions.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {rankingOptions.map((r) => {
            const stubCount = stubCountByRanking.get(r.id) ?? 0
            return (
              <li key={r.id} className="flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/60">
                <span>{r.name}</span>
                {stubCount > 0 && (
                  <Link
                    href={`/admin/data/curation/${r.id}/match`}
                    className="rounded-full border border-orange-400/40 px-1.5 py-0.5 text-[10px] text-orange-300 hover:bg-orange-400/10"
                  >
                    要マッチング{stubCount}件
                  </Link>
                )}
                <Link href={`/media/features/${r.id}`} className="text-white/30 hover:text-white/60">
                  一覧を見る →
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-6 text-xs text-white/40">
        対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。順位は「順位あり」企画のみ入力してください(「選出のみ」企画では空欄のままでOK)。
      </p>
      <form action={createRankingEntry} className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select name="ranking_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              企画を選択
            </option>
            {rankingOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.list_type === 'selection' ? '(選出のみ)' : ''}
              </option>
            ))}
          </select>
          <input name="rank" type="number" min="1" placeholder="順位(選出のみ企画は空欄)" className={`${inputClass} max-w-[220px]`} />
          <input name="period_date" type="date" required className={`${inputClass} max-w-[160px]`} />
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="トラックを検索(任意)" />
          <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを検索(任意)" />
          <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティストを検索(任意)" />
        </div>
        <div className="flex flex-wrap gap-2">
          <input name="metric_value" type="number" step="any" placeholder="数値(任意。例: 再生回数)" className={`${inputClass} max-w-[200px]`} />
          <input name="metric_label" placeholder="単位・指標名(任意)" className={`${inputClass} max-w-[200px]`} />
        </div>
        <button type="submit" className={buttonClass}>
          ランクインを追加
        </button>
      </form>
    </div>
  )
}
