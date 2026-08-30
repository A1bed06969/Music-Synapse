import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import { applyTowerLookup } from './actions'

export default async function TowerLookupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string; from?: string }>
}) {
  const { id } = await params
  const { success, error, from } = await searchParams
  // 呼び出し元(タワレコメンのマッチング画面、アーティスト編集画面等)に戻れる
  // ようにする。外部URLへのオープンリダイレクトを避けるため管理画面配下のみ許可
  const backHref = from && from.startsWith('/admin/') ? from : null
  const supabase = await createClient()

  const { data: album, error: fetchError } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, label:label_id(name), artist:artist_id(name)')
    .eq('id', id)
    .single()

  if (fetchError || !album) {
    notFound()
  }

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex flex-wrap items-center gap-4">
        {backHref && (
          <Link href={backHref} className="text-xs text-white/40 hover:text-white/70">
            ← 登録画面に戻る
          </Link>
        )}
        <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
          {album.title} を見る →
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-bold">Tower Recordsから情報を取り込む</h1>
      <p className="mt-2 text-sm text-white/50">
        {artist?.name} — {album.title}
      </p>

      <div className="mt-4 flex items-center gap-4 text-sm text-white/60">
        {album.jacket_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={album.jacket_url} alt={album.title} className="h-24 w-24 rounded object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded bg-white/5 text-xs text-white/30">
            No Art
          </div>
        )}
        <div>
          <p>発売日: {album.release_date ?? '未定'}</p>
          <p>レーベル: {label?.name ?? '未設定'}</p>
        </div>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={applyTowerLookup} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="album_id" value={album.id} />
        {backHref && <input type="hidden" name="from" value={backHref} />}
        <input
          name="tower_url"
          placeholder="Tower Recordsの商品ページURL(https://tower.jp/item/...)"
          required
          className={`${inputClass} min-w-[360px] flex-1`}
        />
        <button type="submit" className={buttonClass}>
          取り込む
        </button>
      </form>
    </div>
  )
}
