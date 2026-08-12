import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks, searchAlbums } from '../actions'
import { createRanking, createRankingEntry } from './actions'

export default async function CurationPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: mediaList }, { data: rankings }, { data: rankingEntries }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('media').select('id, name').order('name'),
    supabase.from('ranking').select('id, name, source, media:media_id(name)').order('name'),
    supabase
      .from('ranking_entry')
      .select('id, rank, ranking:ranking_id(name), track:track_id(title), album:album_id(title), artist:artist_id(name)')
      .order('id', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const mediaOptions = mediaList ?? []
  const rankingOptions = rankings ?? []

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
        </div>
        <input name="description" placeholder="概要(任意)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          企画を追加
        </button>
      </form>

      <p className="mt-6 text-xs text-white/40">
        対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。
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
              </option>
            ))}
          </select>
          <input name="rank" type="number" min="1" placeholder="順位" required className={`${inputClass} max-w-[100px]`} />
          <input name="period_date" type="date" required className={`${inputClass} max-w-[160px]`} />
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="トラックを検索(任意)" />
          <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを検索(任意)" />
          <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="">(アーティスト指定なし)</option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <input name="metric_value" type="number" step="any" placeholder="数値(任意。例: 再生回数)" className={`${inputClass} max-w-[200px]`} />
          <input name="metric_label" placeholder="単位・指標名(任意)" className={`${inputClass} max-w-[200px]`} />
        </div>
        <button type="submit" className={buttonClass}>
          ランクインを追加
        </button>
      </form>

      {rankingEntries && rankingEntries.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {rankingEntries.map((row) => {
            const ranking = Array.isArray(row.ranking) ? row.ranking[0] : row.ranking
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const target = track?.title ?? album?.title ?? artist?.name
            return (
              <li key={row.id}>
                {ranking?.name} #{row.rank} — {target}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
