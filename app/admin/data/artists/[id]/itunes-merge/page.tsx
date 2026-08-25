import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchArtist, fetchArtistWithAlbums } from '@/utils/itunes'
import { mergeItunesArtist } from './actions'
import SubmitButton from './SubmitButton'

export default async function ItunesMergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ appleId?: string; q?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { appleId, q, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .eq('id', id)
    .single()

  if (error || !artist) {
    notFound()
  }

  // フェス出演登録等で、そもそも登録名自体が間違っている(=正しい人物の名前では
  // 検索できない)ケースがあるため、検索語は現在の登録名を初期値にしつつ自由に
  // 変更できるようにする
  const query = q ?? artist.name

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} をiTunesで検索して統合</h1>
      <p className="mt-2 text-sm text-white/50">
        既存のこのアーティスト行に、iTunes(Apple Music)のディスコグラフィーと画像を紐付けます。新しいアーティスト行は作られません。
        登録名自体が間違っている場合は、下の検索語を正しい名前に書き換えて検索してください。
      </p>
      {artist.apple_music_artist_id && (
        <p className="mt-2 text-xs text-amber-400/80">
          既にApple Music ID「{artist.apple_music_artist_id}」が紐付けられています。再検索すると上書きされます。
        </p>
      )}

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      <form action={`/admin/data/artists/${id}/itunes-merge`} method="get" className="mt-6 flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="検索語(通常は正しいアーティスト名)"
          className="w-full max-w-sm rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
          検索
        </button>
      </form>

      {appleId ? (
        <ItunesPreview artistId={id} artistName={artist.name} appleId={appleId} query={query} />
      ) : (
        <ItunesSearchResults artistId={id} query={query} />
      )}
    </div>
  )
}

async function ItunesSearchResults({ artistId, query }: { artistId: string; query: string }) {
  let results
  try {
    results = await searchArtist(query)
  } catch (err) {
    console.error('iTunes検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">iTunesでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
  }

  const supabase = await createClient()
  const { data: existingArtists } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .in(
      'apple_music_artist_id',
      results.map((r) => String(r.artistId))
    )

  const ownerByAppleId = new Map((existingArtists ?? []).map((a) => [a.apple_music_artist_id as string, a]))

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => {
        const owner = ownerByAppleId.get(String(r.artistId))
        const takenByOther = owner && owner.id !== artistId
        return (
          <div key={r.artistId} className="rounded-md border border-white/15 px-4 py-3 text-sm">
            {takenByOther ? (
              <div className="opacity-50">
                <span className="font-medium">{r.artistName}</span>
                <span className="ml-2 text-xs text-white/40">{r.primaryGenreName ?? 'ジャンル不明'}</span>
                <span className="ml-2 text-xs text-amber-400/80">
                  既に「{owner.name}」に紐付け済み
                </span>
              </div>
            ) : (
              <Link
                href={`/admin/data/artists/${artistId}/itunes-merge?appleId=${r.artistId}&q=${encodeURIComponent(query)}`}
                prefetch={false}
                className="block hover:bg-white/5"
              >
                <span className="font-medium">{r.artistName}</span>
                <span className="ml-2 text-xs text-white/40">{r.primaryGenreName ?? 'ジャンル不明'}</span>
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

async function ItunesPreview({
  artistId,
  artistName,
  appleId,
  query,
}: {
  artistId: string
  artistName: string
  appleId: string
  query: string
}) {
  let itunesArtist
  let itunesAlbums
  try {
    const result = await fetchArtistWithAlbums(appleId)
    itunesArtist = result.artist
    itunesAlbums = result.albums
  } catch (err) {
    console.error('iTunes詳細取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">iTunesからの取得に失敗しました。</p>
  }

  if (!itunesArtist) {
    return <p className="mt-8 text-sm text-white/40">指定のIDに該当するアーティストが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/itunes-merge?q=${encodeURIComponent(query)}`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <div className="mt-4 space-y-2 text-sm">
        <p>
          <span className="text-xs uppercase tracking-wide text-white/40">iTunes名義: </span>
          {itunesArtist.artistName}
        </p>
        <p>
          <span className="text-xs uppercase tracking-wide text-white/40">アルバム件数: </span>
          {itunesAlbums.length}件
        </p>
        <p className="text-xs text-white/40">
          統合先はこのアプリ上の「{artistName}」のままです(名前は上書きされません)。
        </p>
      </div>

      <form action={mergeItunesArtist} className="mt-6">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="apple_artist_id" value={appleId} />
        <SubmitButton />
      </form>
    </div>
  )
}
