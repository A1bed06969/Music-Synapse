import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { STREAMING_STATUS_LABEL } from '@/utils/format'

export default async function UnreleasedArtistsListPage() {
  const supabase = await createClient()

  const [{ data: artists }, { data: albums }] = await Promise.all([
    supabase.from('artist').select('id, name, image_url').eq('streaming_status', 'none').order('name'),
    supabase
      .from('album')
      .select('id, title, streaming_status, artist:artist_id(id, name)')
      .in('streaming_status', ['apple_only', 'none'])
      .order('title'),
  ])

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">サブスク未解禁アーティスト</h1>
      <p className="mt-2 text-sm text-white/50">
        現時点で主要なサブスクリプションサービスでの配信が確認できていないアーティスト・アルバムです。
      </p>

      {!artists || artists.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するアーティストはいません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {artists.map((a) => (
            <li key={a.id}>
              <Link
                href={`/artists/${a.id}`}
                className="flex items-center gap-3 py-3 text-sm transition hover:opacity-70"
              >
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-white/5" />
                )}
                <span>{a.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">配信が一部制限されているアルバム</h2>
        <p className="mt-1 text-xs text-white/40">全配信中ではない(Apple Music限定・配信なし)アルバムです。</p>

        {!albums || albums.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">該当するアルバムはいません。</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/10">
            {albums.map((album) => {
              const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
              const status = STREAMING_STATUS_LABEL[album.streaming_status as string]
              return (
                <li key={album.id} className="flex items-center justify-between gap-2 py-3 text-sm">
                  <Link href={`/albums/${album.id}`} className="hover:opacity-70">
                    {album.title}
                    {artist && <span className="text-white/40"> — {artist.name}</span>}
                  </Link>
                  {status && (
                    <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60">
                      {status.icon} {status.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
