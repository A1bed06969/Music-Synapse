import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchRelease as searchMusicBrainzRelease, fetchReleaseCreditsAndInstruments } from '@/utils/musicbrainz'
import { searchRelease as searchDiscogsRelease, fetchReleaseCredits as fetchDiscogsReleaseCredits } from '@/utils/discogs'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
import { importAlbumCredits } from './actions'
import SubmitButton from './SubmitButton'

// Work単位の追加取得(曲数分)とクレジット取込(行数分の逐次書き込み)は
// 収録曲・クレジットが多いアルバムだと1分近くかかることがある
export const maxDuration = 60

type Source = 'musicbrainz' | 'discogs'

const SOURCE_LABEL: Record<Source, string> = {
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
}

type UnifiedCredit = {
  personName: string
  personSourceId: string
  role: 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork' | 'musician'
  sourceUrl: string
  trackTitle: string | null
  instrumentName?: string
}

export default async function AlbumCreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ source?: string; releaseId?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { source: sourceParam, releaseId, success, error: errorMessage } = await searchParams
  const source: Source = sourceParam === 'discogs' ? 'discogs' : 'musicbrainz'
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

      {!releaseId && (
        <div className="mt-4 flex gap-1 rounded-md border border-white/15 p-0.5 text-xs w-fit">
          {(['musicbrainz', 'discogs'] as const).map((s) => (
            <Link
              key={s}
              href={`/admin/data/albums/${album.id}/credits?source=${s}`}
              prefetch={false}
              className={`rounded px-3 py-1.5 ${source === s ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
            >
              {SOURCE_LABEL[s]}
            </Link>
          ))}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {releaseId ? (
        <CreditsPreview artistId={artist.id} albumId={album.id} source={source} releaseId={releaseId} />
      ) : (
        <ReleaseSearchResults albumId={album.id} albumTitle={album.title} artistName={artist.name} source={source} />
      )}
    </div>
  )
}

async function ReleaseSearchResults({
  albumId,
  albumTitle,
  artistName,
  source,
}: {
  albumId: string
  albumTitle: string
  artistName: string
  source: Source
}) {
  type Result = { id: string; title: string; meta: string }
  let results: Result[]
  try {
    if (source === 'musicbrainz') {
      const raw = await searchMusicBrainzRelease(albumTitle, artistName)
      results = raw.map((r) => ({
        id: r.mbid,
        title: r.title,
        meta: `${r.date ?? '発売日不明'} / ${r.country ?? '国不明'} / 一致度: ${r.score ?? '?'}%`,
      }))
    } else {
      const raw = await searchDiscogsRelease(albumTitle, artistName)
      results = raw.map((r) => ({
        id: String(r.discogsId),
        title: r.title,
        meta: `${r.year ?? '発売年不明'} / ${r.country ?? '国不明'} / ${r.format ?? '形式不明'}`,
      }))
    }
  } catch (err) {
    console.error(`${SOURCE_LABEL[source]}リリース検索に失敗しました:`, err)
    return <p className="mt-8 text-sm text-white/40">{SOURCE_LABEL[source]}での検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するリリースが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.id}
          href={`/admin/data/albums/${albumId}/credits?source=${source}&releaseId=${r.id}`}
          prefetch={false}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.title}</span>
          <span className="ml-2 text-xs text-white/40">{r.meta}</span>
        </Link>
      ))}
    </div>
  )
}

async function CreditsPreview({
  artistId,
  albumId,
  source,
  releaseId,
}: {
  artistId: string
  albumId: string
  source: Source
  releaseId: string
}) {
  let credits: UnifiedCredit[]
  try {
    if (source === 'musicbrainz') {
      const result = await fetchReleaseCreditsAndInstruments(releaseId)
      credits = result.credits.map((c) => ({ ...c, personSourceId: c.personMbid }))
    } else {
      const result = await fetchDiscogsReleaseCredits(Number(releaseId))
      credits = result.credits.map((c) => ({ ...c, personSourceId: c.personDiscogsId }))
    }
  } catch (err) {
    console.error(`${SOURCE_LABEL[source]}クレジット取得に失敗しました:`, err)
    return <p className="mt-8 text-sm text-white/40">{SOURCE_LABEL[source]}からの取得に失敗しました。</p>
  }

  if (credits.length === 0) {
    return <p className="mt-8 text-sm text-white/40">対応するクレジット情報が見つかりませんでした。</p>
  }

  const supabase = await createClient()
  const personSourceIds = Array.from(new Set(credits.map((c) => c.personSourceId)))
  const [{ data: matchedArtists }, { data: albumTracks }] = await Promise.all([
    source === 'musicbrainz'
      ? supabase.from('artist').select('id, name, musicbrainz_id').in('musicbrainz_id', personSourceIds)
      : supabase.from('artist').select('id, name, discogs_artist_id').in('discogs_artist_id', personSourceIds),
    supabase.from('track').select('id, title').eq('album_id', albumId),
  ])

  const artistBySourceId = new Map(
    (matchedArtists ?? []).map((a) => [
      (source === 'musicbrainz'
        ? (a as { musicbrainz_id: string | null }).musicbrainz_id
        : (a as { discogs_artist_id: string | null }).discogs_artist_id) as string,
      a,
    ])
  )

  const normalizeTitle = (title: string) => title.trim().toLowerCase()
  const trackIdByTitle = new Map((albumTracks ?? []).map((t) => [normalizeTitle(t.title), t.id]))
  const picks = credits.map((credit) => ({
    ...credit,
    trackId: credit.trackTitle ? (trackIdByTitle.get(normalizeTitle(credit.trackTitle)) ?? null) : null,
  }))

  // アルバム全体のクレジット(トラック非依存)を先に、そのあとトラックごとにまとめて表示する
  const albumWide = picks.filter((p) => !p.trackTitle)
  const byTrack = new Map<string, typeof picks>()
  for (const p of picks) {
    if (!p.trackTitle) continue
    const list = byTrack.get(p.trackTitle) ?? []
    list.push(p)
    byTrack.set(p.trackTitle, list)
  }

  let index = 0

  function renderRow(pick: (typeof picks)[number]) {
    const i = index++
    const matched = artistBySourceId.get(pick.personSourceId)
    const needsTrack = Boolean(pick.trackTitle)
    const canInclude = !needsTrack || Boolean(pick.trackId)
    return (
      <div key={i} className="flex items-center gap-3 text-sm">
        <input type="hidden" name={`credit_${i}_person_name`} value={pick.personName} />
        <input type="hidden" name={`credit_${i}_person_source_id`} value={pick.personSourceId} />
        <input type="hidden" name={`credit_${i}_source`} value={source} />
        <input type="hidden" name={`credit_${i}_role`} value={pick.role} />
        <input type="hidden" name={`credit_${i}_source_url`} value={pick.sourceUrl} />
        <input type="hidden" name={`credit_${i}_track_id`} value={pick.trackId ?? ''} />
        <input type="hidden" name={`credit_${i}_instrument_name`} value={pick.instrumentName ?? ''} />
        <label className={`flex items-center gap-2 ${canInclude ? '' : 'opacity-40'}`}>
          <input type="checkbox" name={`credit_${i}_include`} value="1" defaultChecked={canInclude} disabled={!canInclude} />
          <span className="font-medium">{pick.personName}</span>
          <span className="text-xs text-white/40">
            ({CREDIT_ROLE_LABEL[pick.role] ?? pick.role}
            {pick.instrumentName ? `: ${pick.instrumentName}` : ''})
          </span>
          {matched && <span className="text-xs text-emerald-400">→ 既存アーティスト「{matched.name}」として登録</span>}
          {needsTrack && !pick.trackId && <span className="text-xs text-white/30">(該当トラック無し)</span>}
        </label>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/albums/${albumId}/credits?source=${source}`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← リリース候補一覧に戻る
      </Link>

      <form action={importAlbumCredits} className="mt-4 space-y-4">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="album_id" value={albumId} />
        <input type="hidden" name="credit_count" value={picks.length} />

        {albumWide.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">アルバム全体</h2>
            {albumWide.map(renderRow)}
          </div>
        )}

        {Array.from(byTrack.entries()).map(([trackTitle, trackPicks]) => (
          <div key={trackTitle} className="space-y-2 border-t border-white/10 pt-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">{trackTitle}</h2>
            {trackPicks.map(renderRow)}
          </div>
        ))}

        <SubmitButton />
      </form>
    </div>
  )
}
