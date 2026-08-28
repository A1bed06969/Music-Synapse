import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import SearchableSelect from '../../../SearchableSelect'
import { searchArtists } from '../../../actions'
import { linkTrackArtist, unlinkTrackArtist } from '../../actions'

export default async function TrackCoArtistsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: track, error: fetchError } = await supabase
    .from('track')
    .select('id, title, artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (fetchError || !track) {
    notFound()
  }

  const representativeArtist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  const { data: coArtists } = await supabase
    .from('track_artist')
    .select('id, role, billing_order, artist:artist_id(id, name)')
    .eq('track_id', id)
    .order('billing_order', { ascending: true, nullsFirst: false })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/tracks/${track.id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {track.title}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">追加アーティストを紐付け</h1>
      <p className="mt-2 text-sm text-white/50">{track.title}</p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="mt-6">
        <p className="text-xs text-white/40">代表アーティスト</p>
        {representativeArtist && (
          <Link href={`/artists/${representativeArtist.id}`} className="text-sm text-white/80 hover:text-white">
            {representativeArtist.name}
          </Link>
        )}
      </div>

      <div className="mt-6">
        <p className="text-xs text-white/40">追加アーティスト</p>
        {coArtists && coArtists.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-white/60">
            {coArtists.map((row) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              if (!artist) return null
              return (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <span>
                    {artist.name}
                    <span className="ml-2 text-xs text-white/30">
                      {row.role === 'featured' ? 'フィーチャリング' : '対等なコラボ'}
                    </span>
                  </span>
                  <form action={unlinkTrackArtist}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="track_id" value={track.id} />
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <button type="submit" className="shrink-0 text-xs text-white/40 hover:text-red-400">
                      解除
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-white/30">まだ追加アーティストは登録されていません。</p>
        )}
      </div>

      <form action={linkTrackArtist} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="track_id" value={track.id} />
        <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティストを選択" />
        <select name="role" required className={`${inputClass} max-w-[160px]`} defaultValue="">
          <option value="" disabled>
            関係性を選択
          </option>
          <option value="featured">フィーチャリング</option>
          <option value="main">対等なコラボ</option>
        </select>
        <button type="submit" className={buttonClass}>
          紐付ける
        </button>
      </form>
    </div>
  )
}
