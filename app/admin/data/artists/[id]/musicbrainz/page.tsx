import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchArtist, fetchArtistDetails } from '@/utils/musicbrainz'
import { importMusicBrainzData } from './actions'
import SubmitButton from './SubmitButton'

const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}

export default async function MusicBrainzPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ mbid?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { mbid, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('id, name').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} をMusicBrainzで検索</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {mbid ? (
        <MusicBrainzPreview artistId={id} mbid={mbid} />
      ) : (
        <MusicBrainzSearchResults artistId={id} artistName={artist.name} />
      )}
    </div>
  )
}

async function MusicBrainzSearchResults({ artistId, artistName }: { artistId: string; artistName: string }) {
  let results
  try {
    results = await searchArtist(artistName)
  } catch (err) {
    console.error('MusicBrainz検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.mbid}
          href={`/admin/data/artists/${artistId}/musicbrainz?mbid=${r.mbid}`}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.name}</span>
          <span className="ml-2 text-xs text-white/40">
            {r.type ?? '種別不明'} / {r.country ?? '国不明'} / {r.beginYear ? `${r.beginYear}年〜` : '結成年不明'}
          </span>
        </Link>
      ))}
    </div>
  )
}

async function MusicBrainzPreview({ artistId, mbid }: { artistId: string; mbid: string }) {
  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    console.error('MusicBrainz詳細取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/musicbrainz`}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">公式サイト・SNS</p>
          <p className="mt-1 text-white/70">
            公式サイト: {details.officialHomepage ?? 'なし'} / X: {details.twitterUrl ?? 'なし'} / Instagram:{' '}
            {details.instagramUrl ?? 'なし'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">外部リンク({details.links.length}件)</p>
          {details.links.length === 0 ? (
            <p className="mt-1 text-white/40">なし</p>
          ) : (
            <ul className="mt-1 space-y-1 text-white/70">
              {details.links.map((link, i) => (
                <li key={i}>
                  {LINK_TYPE_LABEL[link.type] ?? link.type}: {link.url}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">ジャンル</p>
          <p className="mt-1 text-white/70">{details.genres.length > 0 ? details.genres.join('、') : 'なし'}</p>
        </div>
      </div>

      <form action={importMusicBrainzData} className="mt-6">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="mbid" value={mbid} />
        <SubmitButton />
      </form>
    </div>
  )
}
