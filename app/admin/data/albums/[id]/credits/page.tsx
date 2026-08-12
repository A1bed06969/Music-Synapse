import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import {
  searchRelease,
  fetchReleaseCreditsAndInstruments,
  type MusicBrainzReleaseCredit,
  type MusicBrainzInstrumentPick,
} from '@/utils/musicbrainz'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
import { importAlbumCredits } from './actions'
import SubmitButton from './SubmitButton'

export default async function AlbumCreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ mbid?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { mbid, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: album, error } = await supabase
    .from('album')
    .select('id, title, artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !album) {
    notFound()
  }

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  if (!artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${artist.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{album.title} のクレジットを取り込む</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {mbid ? (
        <CreditsPreview artistId={artist.id} albumId={album.id} releaseMbid={mbid} />
      ) : (
        <ReleaseSearchResults albumId={album.id} albumTitle={album.title} artistName={artist.name} />
      )}
    </div>
  )
}

async function ReleaseSearchResults({
  albumId,
  albumTitle,
  artistName,
}: {
  albumId: string
  albumTitle: string
  artistName: string
}) {
  let results
  try {
    results = await searchRelease(albumTitle, artistName)
  } catch (err) {
    console.error('MusicBrainzリリース検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するリリースが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.mbid}
          href={`/admin/data/albums/${albumId}/credits?mbid=${r.mbid}`}
          prefetch={false}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.title}</span>
          <span className="ml-2 text-xs text-white/40">
            {r.date ?? '発売日不明'} / {r.country ?? '国不明'} / 一致度: {r.score ?? '?'}%
          </span>
        </Link>
      ))}
    </div>
  )
}

async function CreditsPreview({
  artistId,
  albumId,
  releaseMbid,
}: {
  artistId: string
  albumId: string
  releaseMbid: string
}) {
  let credits: MusicBrainzReleaseCredit[]
  let instruments: MusicBrainzInstrumentPick[]
  try {
    const result = await fetchReleaseCreditsAndInstruments(releaseMbid)
    credits = result.credits
    instruments = result.instruments
  } catch (err) {
    console.error('MusicBrainzクレジット取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  if (credits.length === 0 && instruments.length === 0) {
    return <p className="mt-8 text-sm text-white/40">対応するクレジット・楽器情報が見つかりませんでした。</p>
  }

  const supabase = await createClient()
  const personMbids = Array.from(new Set(credits.map((c) => c.personMbid)))
  const [{ data: matchedArtists }, { data: albumTracks }] = await Promise.all([
    supabase.from('artist').select('id, name, musicbrainz_id').in('musicbrainz_id', personMbids),
    supabase.from('track').select('id, title').eq('album_id', albumId),
  ])

  const artistByMbid = new Map((matchedArtists ?? []).map((a) => [a.musicbrainz_id as string, a]))

  const normalizeTitle = (title: string) => title.trim().toLowerCase()
  const trackIdByTitle = new Map((albumTracks ?? []).map((t) => [normalizeTitle(t.title), t.id]))
  const instrumentPicks = instruments.map((pick) => ({
    ...pick,
    trackId: trackIdByTitle.get(normalizeTitle(pick.recordingTitle)) ?? null,
  }))

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/albums/${albumId}/credits`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← リリース候補一覧に戻る
      </Link>

      <form action={importAlbumCredits} className="mt-4 space-y-3">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="album_id" value={albumId} />
        <input type="hidden" name="credit_count" value={credits.length} />
        {credits.map((credit, i) => {
          const matched = artistByMbid.get(credit.personMbid)
          return (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input type="hidden" name={`credit_${i}_person_name`} value={credit.personName} />
              <input type="hidden" name={`credit_${i}_person_mbid`} value={credit.personMbid} />
              <input type="hidden" name={`credit_${i}_role`} value={credit.role} />
              <input type="hidden" name={`credit_${i}_source_url`} value={credit.sourceUrl} />
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`credit_${i}_include`} value="1" defaultChecked />
                <span className="font-medium">{credit.personName}</span>
                <span className="text-xs text-white/40">({CREDIT_ROLE_LABEL[credit.role] ?? credit.role})</span>
                {matched && (
                  <span className="text-xs text-emerald-400">→ 既存アーティスト「{matched.name}」として登録</span>
                )}
              </label>
            </div>
          )
        })}

        {instrumentPicks.length > 0 && (
          <div className="border-t border-white/10 pt-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">使用楽器(トラック別)</h2>
            <input type="hidden" name="instrument_count" value={instrumentPicks.length} />
            <div className="mt-2 space-y-2">
              {instrumentPicks.map((pick, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <input type="hidden" name={`instrument_${i}_track_id`} value={pick.trackId ?? ''} />
                  <input type="hidden" name={`instrument_${i}_instrument_name`} value={pick.instrumentName} />
                  <label className={`flex items-center gap-2 ${pick.trackId ? '' : 'opacity-40'}`}>
                    <input
                      type="checkbox"
                      name={`instrument_${i}_include`}
                      value="1"
                      defaultChecked={Boolean(pick.trackId)}
                      disabled={!pick.trackId}
                    />
                    <span className="font-medium">🎸 {pick.instrumentName}</span>
                    <span className="text-xs text-white/40">— {pick.recordingTitle}</span>
                    {!pick.trackId && <span className="text-xs text-white/30">(該当トラック無し)</span>}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  )
}
