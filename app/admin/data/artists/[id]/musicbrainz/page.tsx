import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchArtist, fetchArtistDetails, getLinkLabel } from '@/utils/musicbrainz'
import { importMusicBrainzData } from './actions'
import SubmitButton from './SubmitButton'

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

  const { data: artist, error } = await supabase
    .from('artist')
    .select('id, name, official_site_url, sns_x_url, sns_instagram_url')
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

      <h1 className="mt-4 text-2xl font-bold">{artist.name} をMusicBrainzで検索</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {mbid ? (
        <MusicBrainzPreview
          artistId={id}
          mbid={mbid}
          currentOfficialSiteUrl={artist.official_site_url}
          currentSnsXUrl={artist.sns_x_url}
          currentSnsInstagramUrl={artist.sns_instagram_url}
        />
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
        <div key={r.mbid} className="rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5">
          <Link href={`/admin/data/artists/${artistId}/musicbrainz?mbid=${r.mbid}`} prefetch={false} className="block">
            <span className="font-medium">{r.name}</span>
            <span className="ml-2 text-xs text-white/40">
              {r.type ?? '種別不明'} / {r.country ?? '国不明'} / {r.beginYear ? `${r.beginYear}年〜` : '結成年不明'}
              {r.score !== null ? ` / 一致度: ${r.score}%` : ''}
            </span>
          </Link>
          <a
            href={`https://musicbrainz.org/artist/${r.mbid}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-white/30 underline hover:text-white/60"
          >
            MusicBrainzで確認 →
          </a>
        </div>
      ))}
    </div>
  )
}

async function MusicBrainzPreview({
  artistId,
  mbid,
  currentOfficialSiteUrl,
  currentSnsXUrl,
  currentSnsInstagramUrl,
}: {
  artistId: string
  mbid: string
  currentOfficialSiteUrl: string | null
  currentSnsXUrl: string | null
  currentSnsInstagramUrl: string | null
}) {
  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    console.error('MusicBrainz詳細取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  const sortedLinks = [...details.links].sort(
    (a, b) => a.type.localeCompare(b.type) || a.url.localeCompare(b.url)
  )

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/musicbrainz`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">公式サイト・SNS</p>
          <div className="mt-1 space-y-1 text-white/70">
            <ProfileFieldPreview label="公式サイト" mbValue={details.officialHomepage} currentValue={currentOfficialSiteUrl} />
            <ProfileFieldPreview label="X" mbValue={details.twitterUrl} currentValue={currentSnsXUrl} />
            <ProfileFieldPreview label="Instagram" mbValue={details.instagramUrl} currentValue={currentSnsInstagramUrl} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">外部リンク({sortedLinks.length}件)</p>
          {sortedLinks.length === 0 ? (
            <p className="mt-1 text-white/40">なし</p>
          ) : (
            <ul className="mt-1 space-y-1 text-white/70">
              {sortedLinks.map((link, i) => (
                <li key={i}>
                  {getLinkLabel(link.url, link.type)}: {link.url}
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

function ProfileFieldPreview({
  label,
  mbValue,
  currentValue,
}: {
  label: string
  mbValue: string | null
  currentValue: string | null
}) {
  const willBeSkipped = Boolean(mbValue) && Boolean(currentValue)
  return (
    <p>
      {label}: {mbValue ?? 'なし'}
      {willBeSkipped && (
        <span className="ml-1 text-amber-400/80">(既存の値があるため上書きされません)</span>
      )}
    </p>
  )
}
