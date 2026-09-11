import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration } from '@/utils/format'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import PreviewButton from '@/app/components/PreviewButton'
import RotationModal from '@/app/components/track/RotationModal'
import CurationTags from '@/app/components/CurationTags'
import TrackIdentityPanel, { type TrackIdentityData } from '@/app/components/track-detail/TrackIdentityPanel'
import TrackCenterContent from '@/app/components/track-detail/TrackCenterContent'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  tv_program: 'テレビ番組',
}

export default async function TrackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, album:album_id(id, title, jacket_url), artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  // クレジットはalbum_id経由。track.album_idがnullだと`album_id=eq.null`で
  // uuidキャストエラーになり(エラーは握りつぶされ)クレジットが黙って消えるため、
  // 兄弟トラック取得(下のsiblingTracks)と同じくnullガードする
  const [{ data: credits }, { data: trackInstruments }, { data: syncEntries }, { data: rotations }, { data: coArtistRows }, { data: curationSelections }] =
    await Promise.all([
      track.album_id
        ? supabase
            .from('artist_credit')
            .select('role, credit_person:credit_person_id(id, name), instrument:instrument_id(id, name)')
            .eq('album_id', track.album_id)
            .or(`track_id.eq.${id},track_id.is.null`)
        : Promise.resolve({ data: [] as { role: string; credit_person: { id: string; name: string } | { id: string; name: string }[] | null; instrument: { id: string; name: string } | { id: string; name: string }[] | null }[], error: null }),
      supabase.from('track_instrument').select('instrument:instrument_id(id, name)').eq('track_id', id),
      supabase
        .from('sync_entry')
        .select('id, usage_detail, sync_work:sync_work_id(id, title, work_type, year)')
        .eq('track_id', id),
      supabase
        .from('radio_rotation')
        .select(
          'id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))'
        )
        .eq('track_id', id)
        .order('period_start_date', { ascending: false }),
      supabase
        .from('track_artist')
        .select('artist_id, role, billing_order, artist:artist_id(id, name)')
        .eq('track_id', id)
        .order('billing_order', { ascending: true, nullsFirst: false }),
      // トラック単位で選出されるキュレーションコンテンツ(将来のTSUTAYA名盤の
      // トラック起点選出等)向け。album/artist詳細ページと同じ🏆選出タグを表示する。
      // selection型・ranked型の両方を表示する(3ページで方針を統一。ranked型の
      // rankはCurationTagsの表示に含めない)
      supabase
        .from('ranking_entry')
        .select('ranking:ranking_id!inner(id, name, list_type, source)')
        .eq('track_id', id),
    ])

  // 棚:このアルバムの他の曲(前後の曲へ移動できる導線)
  const { data: siblingTracks } = track.album_id
    ? await supabase
        .from('track')
        .select('id, track_no, title, duration_seconds')
        .eq('album_id', track.album_id)
        .neq('id', id)
        .order('track_no', { ascending: true })
        .limit(50)
    : { data: null }

  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  type ArtistRef = { id: string; name: string }
  const additionalArtists: ArtistRef[] = (coArtistRows ?? [])
    .map((row) => (Array.isArray(row.artist) ? row.artist[0] : row.artist))
    .filter((a): a is ArtistRef => a != null)
  const seenArtistIds = new Set<string>()
  const allArtists: ArtistRef[] = (artist ? [artist, ...additionalArtists] : additionalArtists).filter((a) => {
    if (seenArtistIds.has(a.id)) return false
    seenArtistIds.add(a.id)
    return true
  })

  type RankingRef = { id: string; name: string; source: string | null }
  const seenRankingIds = new Set<string>()
  const curationRankings: RankingRef[] = (curationSelections ?? [])
    .map((row) => (Array.isArray(row.ranking) ? row.ranking[0] : row.ranking))
    .filter((r): r is RankingRef & { list_type: string } => r != null)
    .filter((r) => {
      if (seenRankingIds.has(r.id)) return false
      seenRankingIds.add(r.id)
      return true
    })

  // 「ミュージシャン」ロールは楽器名ごとに演奏者をまとめて「使用楽器」欄で表示するため、
  // ここでは楽器を伴わないロール(プロデューサー等)だけを対象にする
  const ROLE_ORDER = ['producer', 'mix', 'mastering', 'composer', 'lyricist', 'arranger', 'artwork'] as const
  const creditsByRole = new Map<string, { id: string; name: string }[]>()
  for (const c of credits ?? []) {
    if (c.role === 'musician') continue
    const person = Array.isArray(c.credit_person) ? c.credit_person[0] : c.credit_person
    if (!person) continue
    const list = creditsByRole.get(c.role) ?? []
    if (!list.some((p) => p.id === person.id)) list.push({ id: person.id, name: person.name })
    creditsByRole.set(c.role, list)
  }
  const creditGroups = ROLE_ORDER.map((role) => ({ role, people: creditsByRole.get(role) ?? [] })).filter(
    (g) => g.people.length > 0
  )

  // 使用楽器: track_instrument(このトラックで使われた楽器の全量)を軸に、
  // artist_credit(musicianロール)から分かる演奏者名があれば付け加える
  const performersByInstrumentId = new Map<string, { id: string; name: string }[]>()
  for (const c of credits ?? []) {
    if (c.role !== 'musician') continue
    const person = Array.isArray(c.credit_person) ? c.credit_person[0] : c.credit_person
    const instrument = Array.isArray(c.instrument) ? c.instrument[0] : c.instrument
    if (!person || !instrument) continue
    const list = performersByInstrumentId.get(instrument.id) ?? []
    if (!list.some((p) => p.id === person.id)) list.push({ id: person.id, name: person.name })
    performersByInstrumentId.set(instrument.id, list)
  }
  const instrumentGroups = (trackInstruments ?? [])
    .map((ti) => (Array.isArray(ti.instrument) ? ti.instrument[0] : ti.instrument))
    .filter((instrument): instrument is { id: string; name: string } => Boolean(instrument))
    .map((instrument) => ({
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      people: performersByInstrumentId.get(instrument.id) ?? [],
    }))

  const identity: TrackIdentityData = {
    id: track.id,
    jacketUrl: album?.jacket_url ?? null,
    title: track.title,
    artists: allArtists,
    album: album ? { id: album.id, title: album.title } : null,
    durationLabel: formatDuration(track.duration_seconds),
    previewUrl: track.preview_url,
    listenIds: {
      appleMusicId: track.apple_music_track_id,
      spotifyId: track.spotify_track_id,
      youtubeMusicId: track.youtube_music_track_id,
      amazonMusicId: track.amazon_music_track_id,
    },
    extraLinks: track.lyric_url ? [{ label: '歌詞を見る', href: track.lyric_url }] : [],
    review: track.track_review,
  }

  const rightColumn = (
    <div className="flex flex-col gap-8">
      {rotations && rotations.length > 0 && <RotationModal rotations={rotations} />}

      {syncEntries && syncEntries.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">タイアップ実績</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-white/70">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              if (!work) return null
              return (
                <li key={row.id}>
                  {work.title}
                  {work.work_type && (
                    <span className="text-white/40"> ({WORK_TYPE_LABEL[work.work_type] ?? work.work_type})</span>
                  )}
                  {row.usage_detail && <span className="text-white/40"> ・ {row.usage_detail}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {curationRankings.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            キュレーション・ランキング選出
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <CurationTags rankings={curationRankings} />
          </div>
        </section>
      )}
    </div>
  )

  return (
    <>
      <div className="px-6 pt-3 lg:px-8">
        {success && (
          <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
        )}
        {errorMessage && (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
        )}
        <div className="flex items-center justify-between">
          <BackLink
            fallbackHref={album ? `/albums/${album.id}` : '/tracks'}
            fallbackLabel={album ? album.title : 'トラック一覧に戻る'}
          />
          <Link href={`/admin/data/tracks/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
            編集
          </Link>
        </div>
      </div>
      <StickyMiniHeader
        watchElementId="track-header"
        imageUrl={album?.jacket_url ?? null}
        title={track.title}
        subtitle={allArtists[0]?.name ?? null}
        action={<PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />}
      />
      <DetailPageShell
        left={<TrackIdentityPanel data={identity} />}
        center={
          <TrackCenterContent
            youtubeVideoId={track.youtube_video_id}
            title={track.title}
            album={album ? { id: album.id, title: album.title } : null}
            siblingTracks={siblingTracks ?? []}
            instrumentGroups={instrumentGroups}
            creditGroups={creditGroups}
          />
        }
        right={rightColumn}
      />
    </>
  )
}
