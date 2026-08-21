import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import SearchableSelect from '../../../../SearchableSelect'
import { searchAlbums } from '../../../../actions'
import { updateDiscGuideSelection, deleteDiscGuideSelection } from '../../../actions'

export default async function EditDiscGuideSelectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: selection, error } = await supabase
    .from('disc_guide_selection')
    .select('id, note, album_id, disc_guide:disc_guide_id(title), album:album_id(title, artist:artist_id(name))')
    .eq('id', id)
    .single()

  if (error || !selection) {
    notFound()
  }

  const guide = Array.isArray(selection.disc_guide) ? selection.disc_guide[0] : selection.disc_guide
  const album = Array.isArray(selection.album) ? selection.album[0] : selection.album
  const albumArtist = album ? (Array.isArray(album.artist) ? album.artist[0] : album.artist) : null
  const albumLabel = album ? `${album.title}${albumArtist?.name ? ` — ${albumArtist.name}` : ''}` : null

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/discguides" className="text-xs text-white/40 hover:text-white/70">
        ← ディスクガイド管理に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">掲載データを編集</h1>
      <p className="mt-2 text-sm text-white/50">{guide?.title}</p>

      {selection.album_id && (
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href={`/admin/data/albums/${selection.album_id}/tower-lookup`}
            className="inline-block text-xs text-white/40 hover:text-white/70"
          >
            Apple Musicに無い作品の場合: Tower Recordsから画像・発売日を取込 →
          </Link>
          <Link
            href={`/admin/data/albums/${selection.album_id}/discogs-lookup`}
            className="inline-block text-xs text-white/40 hover:text-white/70"
          >
            Discogsから取込 →
          </Link>
        </div>
      )}

      <form action={updateDiscGuideSelection} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={selection.id} />
        <input type="hidden" name="previous_album_id" value={selection.album_id ?? ''} />
        {albumLabel && (
          <SearchableSelect
            searchAction={searchAlbums}
            name="album_id"
            placeholder="アルバムを選択"
            defaultSelected={[{ id: selection.album_id, label: albumLabel }]}
          />
        )}
        <input
          name="note"
          placeholder="メモ(任意。例: #7掲載)"
          defaultValue={selection.note ?? ''}
          className={`${inputClass} max-w-xs`}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteDiscGuideSelection} className="mt-6">
        <input type="hidden" name="id" value={selection.id} />
        <input type="hidden" name="album_id" value={selection.album_id ?? ''} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この掲載データを削除
        </button>
      </form>
    </div>
  )
}
