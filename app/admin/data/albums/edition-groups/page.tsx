import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { buttonClass } from '../../adminUi'
import SearchableSelect from '../../SearchableSelect'
import { searchAlbums } from '../../actions'
import { unlinkEdition, linkEdition, changeGroupRepresentative } from './actions'

export default async function AlbumEditionGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: editions } = await supabase
    .from('album')
    .select('id, title, release_date, primary_album_id, artist:artist_id(name)')
    .not('primary_album_id', 'is', null)
    .order('primary_album_id')

  const primaryIds = Array.from(new Set((editions ?? []).map((e) => e.primary_album_id as string)))
  const { data: primaries } =
    primaryIds.length > 0
      ? await supabase
          .from('album')
          .select('id, title, release_date, artist:artist_id(name)')
          .in('id', primaryIds)
      : { data: [] }

  const primariesById = new Map((primaries ?? []).map((p) => [p.id, p]))

  const editionsByPrimary = new Map<string, typeof editions>()
  for (const edition of editions ?? []) {
    const key = edition.primary_album_id as string
    const list = editionsByPrimary.get(key) ?? []
    list.push(edition)
    editionsByPrimary.set(key, list)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アルバムの版グループ</h1>
      <p className="mt-2 text-xs text-white/40">
        デラックス版・地域別版・ボーナス版などをまとめた版グループの確認・修正。まとめ間違いはグループから外し、まとめ漏れは手動で紐付けられる。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="mt-10 rounded-md border border-white/10 p-4">
        <h2 className="text-sm font-semibold">まとめ漏れを手動で紐付け</h2>
        <form action={linkEdition} className="mt-3 flex flex-wrap items-center gap-2">
          <SearchableSelect searchAction={searchAlbums} name="edition_album_id" placeholder="版として紐付けるアルバム" />
          <span className="text-xs text-white/40">を</span>
          <SearchableSelect searchAction={searchAlbums} name="primary_album_id" placeholder="代表版のアルバム" />
          <button type="submit" className={buttonClass}>
            紐付け
          </button>
        </form>
      </div>

      <div className="mt-10 space-y-6">
        {primariesById.size === 0 ? (
          <p className="text-sm text-white/40">現在グループ化されているアルバムはありません。</p>
        ) : (
          Array.from(primariesById.entries()).map(([primaryId, primary]) => {
            const artist = Array.isArray(primary.artist) ? primary.artist[0] : primary.artist
            const groupEditions = editionsByPrimary.get(primaryId) ?? []
            return (
              <div key={primaryId} className="rounded-md border border-white/10 p-4">
                <p className="text-sm font-semibold">
                  {primary.title}{' '}
                  <span className="text-xs font-normal text-white/40">
                    (代表版・{artist?.name} ・ {primary.release_date ?? '発売日未設定'})
                  </span>
                </p>
                <ul className="mt-3 space-y-2 text-sm text-white/60">
                  {groupEditions.map((edition) => (
                    <li key={edition.id} className="flex flex-wrap items-center gap-2">
                      <span>
                        {edition.title} ({edition.release_date ?? '発売日未設定'})
                      </span>
                      <form action={unlinkEdition}>
                        <input type="hidden" name="album_id" value={edition.id} />
                        <button type="submit" className="text-xs text-red-300 hover:text-red-200">
                          グループから外す
                        </button>
                      </form>
                      <form action={changeGroupRepresentative}>
                        <input type="hidden" name="current_primary_id" value={primaryId} />
                        <input type="hidden" name="new_primary_id" value={edition.id} />
                        <button type="submit" className="text-xs text-white/40 hover:text-white">
                          これを代表版にする
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
