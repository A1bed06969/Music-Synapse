import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import { applyDiscogsArtistLookup } from './actions'

export default async function ArtistDiscogsLookupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: artist, error: fetchError } = await supabase
    .from('artist')
    .select('id, name, image_url, bio')
    .eq('id', id)
    .single()

  if (fetchError || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${artist.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">Discogsから情報を取り込む</h1>
      <p className="mt-2 text-sm text-white/50">
        サブスクに無いアーティスト(ディスクガイド・Discogs・タワーレコード経由で登録した場合等)は
        画像・プロフィールが空のままになります。Discogsのアーティストページから取り込みます。
      </p>

      <div className="mt-4 flex items-center gap-4 text-sm text-white/60">
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist.image_url} alt={artist.name} className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/5 text-xs text-white/30">
            No Image
          </div>
        )}
        <div>
          <p className="font-medium">{artist.name}</p>
          <p className="mt-1 max-w-md text-xs text-white/40">
            {artist.bio ? `${artist.bio.slice(0, 80)}${artist.bio.length > 80 ? '…' : ''}` : 'プロフィール未設定'}
          </p>
        </div>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={applyDiscogsArtistLookup} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="artist_id" value={artist.id} />
        <input
          name="discogs_url"
          placeholder="DiscogsのアーティストページURL(https://www.discogs.com/artist/...)"
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
