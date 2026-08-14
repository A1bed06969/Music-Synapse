import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

export default async function MusicBrainzQueuePage() {
  const supabase = await createClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name')
    .is('musicbrainz_id', null)
    .order('name')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">MusicBrainzプロフィール未解決アーティスト</h1>
      <p className="mt-2 text-sm text-white/50">
        アルバムタイトルでの自動照合(タイトル完全一致が複数件で一致した場合のみ自動採用)で
        MBIDを特定できなかった、またはまだ照合していないアーティストです。名前をクリックすると
        MusicBrainzでの検索結果から候補を選んで手動で紐付けられます。
      </p>

      {!artists || artists.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">未解決のアーティストはいません。</p>
      ) : (
        <ul className="mt-8 space-y-1.5 text-sm">
          {artists.map((artist) => (
            <li key={artist.id} className="flex items-center justify-between gap-2">
              <span>{artist.name}</span>
              <Link
                href={`/admin/data/artists/${artist.id}/musicbrainz`}
                prefetch={false}
                className="text-xs text-white/40 hover:text-white/70"
              >
                候補を検索 →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
