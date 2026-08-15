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
  searchParams: Promise<{ appleId?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { appleId, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .eq('id', id)
    .single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} をiTunesで検索して統合</h1>
      <p className="mt-2 text-sm text-white/50">
        既存のこのアーティスト行に、iTunes(Apple Music)のディスコグラフィーと画像を紐付けます。新しいアーティスト行は作られません。
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

      {appleId ? (
        <ItunesPreview artistId={id} artistName={artist.name} appleId={appleId} />
      ) : (
        <ItunesSearchResults artistId={id} artistName={artist.name} />
      )}
    </div>
  )
}

async function ItunesSearchResults({ artistId, artistName }: { artistId: string; artistName: string }) {
  let results
  try {
    results = await searchArtist(artistName)
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
                href={`/admin/data/artists/${artistId}/itunes-merge?appleId=${r.artistId}`}
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
}: {
  artistId: string
  artistName: string
  appleId: string
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
        href={`/admin/data/artists/${artistId}/itunes-merge`}
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
