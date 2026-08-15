import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { ARTIST_TYPE_LABEL, ARTIST_STREAMING_STATUS_LABEL, STREAMING_STATUS_LABEL } from '@/utils/format'
import { updateArtist, updateAlbumStreamingStatus } from '@/app/admin/data/actions'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass =
  'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function ArtistEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist, error }, { data: albums }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, streaming_status')
      .eq('artist_id', id)
      .order('release_date', { ascending: false }),
  ])

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
          ← 管理画面に戻る
        </Link>
        <div className="flex gap-3">
          <Link
            href={`/admin/data/artists/${artist.id}/musicbrainz`}
            prefetch={false}
            className="text-xs text-white/40 hover:text-white/70"
          >
            MusicBrainzで検索
          </Link>
          <Link
            href={`/admin/data/artists/${artist.id}/collaborators`}
            className="text-xs text-white/40 hover:text-white/70"
          >
            コラボアーティストを探す
          </Link>
          <Link
            href={`/admin/data/artists/${artist.id}/geo-search`}
            prefetch={false}
            className="text-xs text-white/40 hover:text-white/70"
          >
            座標を検索(Wikidata/住所)
          </Link>
        </div>
      </div>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} を編集</h1>

      <form action={updateArtist} className="mt-8 space-y-4">
        <input type="hidden" name="artist_id" value={artist.id} />

        <div>
          <label className="mb-1 block text-xs text-white/40">bio</label>
          <textarea name="bio" rows={4} defaultValue={artist.bio ?? ''} className={inputClass} />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">ふりがな</label>
            <input name="name_kana" defaultValue={artist.name_kana ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">英語表記</label>
            <input name="name_en" defaultValue={artist.name_en ?? ''} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">種別</label>
            <select name="artist_type" defaultValue={artist.artist_type ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-white/40">結成年</label>
            <input name="formed_year" type="number" defaultValue={artist.formed_year ?? ''} className={inputClass} />
          </div>
          <div className="max-w-[160px] flex-1">
            <label className="mb-1 block text-xs text-white/40">配信状況</label>
            <select name="streaming_status" defaultValue={artist.streaming_status ?? ''} className={inputClass}>
              <option value="">未設定</option>
              {Object.entries(ARTIST_STREAMING_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-white/40">ページ種別(バンドメンバー用)</label>
            <select name="page_override" defaultValue={artist.page_override ?? ''} className={inputClass}>
              <option value="">自動判定(本人名義のリリース有無で判定)</option>
              <option value="artist">アーティストとして表示(強制)</option>
              <option value="member">メンバーとして表示(強制)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">出身地(都道府県・国など)</label>
            <input name="origin_prefecture" defaultValue={artist.origin_prefecture ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">出身都市</label>
            <input name="hometown_city" defaultValue={artist.hometown_city ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">公式サイトURL</label>
          <input name="official_site_url" type="url" defaultValue={artist.official_site_url ?? ''} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">X URL</label>
            <input name="sns_x_url" type="url" defaultValue={artist.sns_x_url ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Instagram URL</label>
            <input name="sns_instagram_url" type="url" defaultValue={artist.sns_instagram_url ?? ''} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/40">画像URL</label>
          <input name="image_url" type="url" defaultValue={artist.image_url ?? ''} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Spotify Artist ID</label>
            <input name="spotify_artist_id" defaultValue={artist.spotify_artist_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Latest MV URL(YouTube)</label>
            <input name="url_latest_mv" type="url" defaultValue={artist.url_latest_mv ?? ''} className={inputClass} />
          </div>
        </div>

        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>

      <div className="mt-10">
        <h2 className="text-xs uppercase tracking-wide text-white/40">アルバム</h2>
        {!albums || albums.length === 0 ? (
          <p className="mt-3 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {albums.map((album) => (
              <li key={album.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{album.title}</span>
                <div className="flex items-center gap-3">
                  <form action={updateAlbumStreamingStatus} className="flex items-center gap-1.5">
                    <input type="hidden" name="album_id" value={album.id} />
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <select
                      name="streaming_status"
                      defaultValue={album.streaming_status ?? ''}
                      className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white focus:border-white/30 focus:outline-none"
                    >
                      <option value="">配信状況(未設定)</option>
                      {Object.entries(STREAMING_STATUS_LABEL).map(([value, { label, icon }]) => (
                        <option key={value} value={value}>
                          {icon} {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/5"
                    >
                      保存
                    </button>
                  </form>
                  <Link
                    href={`/admin/data/albums/${album.id}/credits`}
                    prefetch={false}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    クレジットを取り込む →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
