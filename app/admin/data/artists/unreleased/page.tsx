import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { searchArtist } from '@/utils/itunes'
import { markArtistUnreleased } from './actions'
import SubmitButton from './SubmitButton'

export const maxDuration = 60

const MAX_PER_RUN = 15

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default async function UnreleasedArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; success?: string; error?: string }>
}) {
  const { run, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: discogsLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, artist:artist_id(id, name, streaming_status)')
    .eq('link_type', 'discogs')

  const eligibleById = new Map<string, { id: string; name: string }>()
  for (const link of discogsLinks ?? []) {
    const artist = Array.isArray(link.artist) ? link.artist[0] : link.artist
    if (!artist || artist.streaming_status != null) continue
    eligibleById.set(artist.id as string, { id: artist.id as string, name: artist.name as string })
  }
  const eligible = Array.from(eligibleById.values())

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
          ← 管理画面に戻る
        </Link>
        <Link href="/artists/unreleased" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-bold">サブスク未解禁アーティストの検出</h1>
      <p className="mt-2 text-sm text-white/50">
        Discogsにリンクがあり、配信状況が未設定のアーティスト{eligible.length}件が対象です。
        iTunes検索で見つからないアーティストを候補として表示します(誤検出があり得るため、必ず確認してから確定してください)。
      </p>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {eligible.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">対象のアーティストはいません。</p>
      ) : run ? (
        <Candidates eligible={eligible} />
      ) : (
        <Link
          href="/admin/data/artists/unreleased?run=1"
          prefetch={false}
          className="mt-8 inline-block rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          検出を実行
        </Link>
      )}
    </div>
  )
}

async function Candidates({ eligible }: { eligible: { id: string; name: string }[] }) {
  const toCheck = eligible.slice(0, MAX_PER_RUN)
  const remaining = Math.max(0, eligible.length - MAX_PER_RUN)

  // iTunes検索は「スピッツ」→「Spitz」のようにローマ字表記でも正しくヒットを
  // 返す(Apple側の検索エンジンが名寄せ済み)。そのため文字列の完全一致は求めず、
  // 検索結果が0件のときだけを「iTunes未ヒット」候補とする(完全一致を要求すると
  // 表記違いのアーティストを大量に誤検出することを実機確認で確認済み)。
  const candidates: { id: string; name: string }[] = []
  for (const artist of toCheck) {
    await sleep(400)
    let results
    try {
      results = await searchArtist(artist.name)
    } catch (err) {
      console.error(`iTunes検索に失敗しました(${artist.name}):`, err)
      continue
    }
    if (results.length === 0) {
      candidates.push({ id: artist.id, name: artist.name })
    }
  }

  return (
    <div className="mt-8">
      <p className="text-xs text-white/40">
        {toCheck.length}件をiTunes検索と突き合わせました。
        {remaining > 0 && ` 残り${remaining}件は次回の実行で確認します。`}
      </p>

      {candidates.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">未解禁の候補は見つかりませんでした。</p>
      ) : (
        <div className="mt-4 space-y-2">
          {candidates.map((c) => (
            <form
              key={c.id}
              action={markArtistUnreleased}
              className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
            >
              <input type="hidden" name="artist_id" value={c.id} />
              <Link href={`/artists/${c.id}`} className="hover:text-white/70">
                {c.name}
              </Link>
              <SubmitButton />
            </form>
          ))}
        </div>
      )}
    </div>
  )
}
