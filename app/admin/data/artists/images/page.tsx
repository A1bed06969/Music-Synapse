import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { runBulkImageUpdate, runBulkAppleMusicImageUpdate } from './actions'
import SubmitButton from './SubmitButton'

export const maxDuration = 60

export default async function ArtistImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const [{ data: wikidataLinks }, { count: appleMusicEligibleCount }] = await Promise.all([
    supabase.from('artist_external_link').select('artist_id, artist:artist_id(id, image_url)').eq('link_type', 'wikidata'),
    supabase
      .from('artist')
      .select('id', { count: 'exact', head: true })
      .not('apple_music_artist_id', 'is', null)
      .is('image_url', null),
  ])

  const eligibleArtistIds = new Set<string>()
  for (const l of wikidataLinks ?? []) {
    const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
    if (artist && artist.image_url == null) {
      eligibleArtistIds.add(artist.id as string)
    }
  }
  const eligibleCount = eligibleArtistIds.size

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アーティスト画像の一括更新</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-white/80">Apple Musicから取得</h2>
        <p className="mt-1 text-sm text-white/50">
          Apple Musicと紐付け済み(apple_music_artist_id)で、まだ画像が未設定のアーティスト
          {appleMusicEligibleCount ?? 0}件が対象です。アーティストページのアートワークが
          取得できた場合のみ反映します。
        </p>
        {(appleMusicEligibleCount ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-white/40">対象のアーティストはいません。</p>
        ) : (
          <form action={runBulkAppleMusicImageUpdate} className="mt-4">
            <SubmitButton label="Apple Musicから一括更新" />
          </form>
        )}
      </section>

      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-sm font-semibold text-white/80">Wikidataから取得</h2>
        <p className="mt-1 text-sm text-white/50">
          Wikidata IDが登録済みで、まだ画像が未設定のアーティスト{eligibleCount}件が対象です。
          Wikimedia Commonsに画像が登録されている場合のみ取得できます。
        </p>
        {eligibleCount === 0 ? (
          <p className="mt-4 text-sm text-white/40">対象のアーティストはいません。</p>
        ) : (
          <form action={runBulkImageUpdate} className="mt-4">
            <SubmitButton label="Wikidataから一括更新" />
          </form>
        )}
      </section>
    </div>
  )
}
