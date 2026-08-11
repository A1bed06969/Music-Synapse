import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

export default async function UnreleasedArtistsListPage() {
  const supabase = await createClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, image_url')
    .eq('streaming_status', 'none')
    .order('name')

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">サブスク未解禁アーティスト</h1>
      <p className="mt-2 text-sm text-white/50">
        現時点で主要なサブスクリプションサービスでの配信が確認できていないアーティストです。
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
    </div>
  )
}
