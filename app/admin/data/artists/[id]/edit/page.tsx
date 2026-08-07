import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { ARTIST_TYPE_LABEL, ARTIST_STREAMING_STATUS_LABEL } from '@/utils/format'
import { updateArtist } from '@/app/admin/data/actions'

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

  const { data: artist, error } = await supabase.from('artist').select('*').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
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
    </div>
  )
}
