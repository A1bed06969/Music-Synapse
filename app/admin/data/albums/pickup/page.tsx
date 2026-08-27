import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../adminUi'
import SearchableSelect from '../../SearchableSelect'
import { searchAlbums } from '../../actions'
import { createAlbumPickup, deleteAlbumPickup } from './actions'

export default async function AlbumPickupAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: pickups } = await supabase
    .from('album_pickup')
    .select('id, blurb, sort_order, album:album_id(id, title, jacket_url, artist:artist_id(name))')
    .order('sort_order', { ascending: true })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">新譜ピックアップ</h1>
        <Link href="/albums/calendar" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>
      <p className="mt-2 text-sm text-white/50">
        ①Discover New Musicの新譜カレンダーに表示する「今週の注目新譜」を紹介文付きで管理します。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createAlbumPickup} className="mt-6 flex flex-wrap items-start gap-2">
        <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを検索..." />
        <textarea
          name="blurb"
          placeholder="紹介文(任意)"
          rows={2}
          className={`${inputClass} max-w-md`}
        />
        <button type="submit" className={buttonClass}>
          ピックアップに追加
        </button>
      </form>

      <ul className="mt-8 space-y-2">
        {(pickups ?? []).map((p) => {
          const album = Array.isArray(p.album) ? p.album[0] : p.album
          const artist = album ? (Array.isArray(album.artist) ? album.artist[0] : album.artist) : null
          return (
            <li key={p.id} className="flex items-start gap-3 rounded-md border border-white/10 p-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-white/5">
                {album?.jacket_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={album.jacket_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[9px] text-white/20">No Art</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{album?.title ?? '(削除済み)'}</p>
                <p className="truncate text-xs text-white/50">{artist?.name}</p>
                {p.blurb && <p className="mt-1 text-xs text-white/60">{p.blurb}</p>}
              </div>
              <form action={deleteAlbumPickup}>
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className="shrink-0 text-xs text-red-400/70 hover:text-red-400">
                  削除
                </button>
              </form>
            </li>
          )
        })}
        {(pickups ?? []).length === 0 && <p className="text-xs text-white/30">まだピックアップが登録されていません。</p>}
      </ul>
    </div>
  )
}
