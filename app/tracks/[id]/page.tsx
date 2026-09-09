import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration, CREDIT_ROLE_LABEL } from '@/utils/format'
import PreviewButton from '@/app/components/PreviewButton'
import RotationModal from '@/app/components/track/RotationModal'
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import ListenLinks from '@/app/components/detail/ListenLinks'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'

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

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
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

      <StickyMiniHeader
        watchElementId="track-header"
        imageUrl={album?.jacket_url ?? null}
        title={track.title}
        subtitle={allArtists[0]?.name ?? null}
        action={<PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />}
      />

      <div className="mt-4">
        <DetailHeader
          id="track-header"
          imageUrl={album?.jacket_url ?? null}
          imageAlt={track.title}
          title={track.title}
          subtitle={
            allArtists.length > 0 ? (
              <span className="flex flex-wrap items-center gap-x-1">
                {allArtists.map((a, i) => (
                  <span key={a.id} className="flex items-center">
                    <Link href={`/artists/${a.id}`} className="hover:text-white">
                      {a.name}
                    </Link>
                    {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                  </span>
                ))}
              </span>
            ) : null
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2">
              {album && (
                <>
                  <Link href={`/albums/${album.id}`} className="hover:text-white">
                    {album.title}
                  </Link>
                  <span>·</span>
                </>
              )}
              <span>{formatDuration(track.duration_seconds)}</span>
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="lg" />
              <ListenLinks
                kind="track"
                ids={{
                  appleMusicId: track.apple_music_track_id,
                  spotifyId: track.spotify_track_id,
                  youtubeMusicId: track.youtube_music_track_id,
                  amazonMusicId: track.amazon_music_track_id,
                }}
                extraLinks={track.lyric_url ? [{ label: '歌詞を見る', href: track.lyric_url }] : []}
              />
            </div>
          }
          rankings={curationRankings}
        />
      </div>

      {(() => {
        const showVisual = hasVisualContent({
          review: track.track_review,
          youtubeVideoId: track.youtube_video_id,
        })
        const hasRightContent =
          (rotations && rotations.length > 0) || (syncEntries && syncEntries.length > 0) || instrumentGroups.length > 0

        if (!showVisual && !hasRightContent) return null

        return (
          <div className={showVisual && hasRightContent ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className={hasRightContent ? 'lg:w-[46%] lg:shrink-0' : ''}>
                <VisualSlot
                  review={track.track_review}
                  youtubeVideoId={track.youtube_video_id}
                  title={track.title}
                  layout={hasRightContent ? 'spread' : 'full'}
                />
              </div>
            )}
            {hasRightContent && (
              <div className="min-w-0 flex-1 space-y-8">
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

                {instrumentGroups.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">使用楽器</h2>
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {instrumentGroups.map((group) => (
                        <li key={group.instrumentId} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                          <Link href={`/tracks/instrument/${group.instrumentId}`} className="text-white/40 hover:text-white">
                            {group.instrumentName}
                          </Link>
                          {group.people.length > 0 && (
                            <span>
                              {group.people.map((person, i) => (
                                <span key={person.id}>
                                  {i > 0 && '、'}
                                  <Link href={`/people/${person.id}`} className="hover:text-white">
                                    {person.name}
                                  </Link>
                                </span>
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {siblingTracks && siblingTracks.length > 0 && album && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            {album.title}の他の曲
          </h2>
          <ol className="mt-3 divide-y divide-white/10">
            {siblingTracks.map((t) => (
              <li key={t.id}>
                <Link href={`/tracks/${t.id}`} className="flex items-center gap-4 py-2.5 text-sm hover:opacity-70">
                  <span className="w-5 shrink-0 text-right text-white/30">{t.track_no ?? '-'}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-white/30">{formatDuration(t.duration_seconds)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {creditGroups.length > 0 && (
        <details className="mt-14 border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-white/35 hover:text-white/60">
            <h2 className="inline text-[11px] font-medium uppercase tracking-[0.14em]">
              クレジット({creditGroups.reduce((total, g) => total + g.people.length, 0)}件)
            </h2>
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {creditGroups.map((group) => (
              <li key={group.role} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                <span className="text-white/40">{CREDIT_ROLE_LABEL[group.role] ?? group.role}</span>
                <span>
                  {group.people.map((person, i) => (
                    <span key={person.id}>
                      {i > 0 && '、'}
                      <Link href={`/people/${person.id}`} className="hover:text-white">
                        {person.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
