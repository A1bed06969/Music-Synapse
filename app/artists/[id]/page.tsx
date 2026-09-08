import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import {
  formatDate,
  extractYoutubeVideoId,
  ARTIST_STREAMING_STATUS_LABEL,
  ARTIST_TYPE_LABEL,
  STREAMING_STATUS_LABEL,
} from '@/utils/format'
import ArtistCreditQuadrantGraph from '@/app/components/ArtistCreditQuadrants'
import { buildArtistCreditQuadrants } from '@/utils/relationGraphData'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
import { resolveArtistPageKind, hasOwnRelease } from '@/utils/artistPageKind'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import MemberProfile from './MemberProfile'
import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { fetchAllNews, findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER, type AlbumType } from '@/utils/albumType'
import { fetchArtistMediaSelections } from '@/utils/fetchArtistMediaSelections'
import ArtistTimeline from './ArtistTimeline'
import DetailHeader from '@/app/components/detail/DetailHeader'
import VisualSlot, { hasVisualContent } from '@/app/components/detail/VisualSlot'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'

type ArtistAlbumRow = {
  id: string
  title: string
  jacket_url: string | null
  release_date: string | null
  album_type: string | null
  streaming_status: string | null
}

type ArtistAppearanceRow = {
  id: number
  stage: string | null
  venue: string | null
  is_headliner: boolean
  display_name: string | null
  start_time: string | null
  event_edition: { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null } | { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
}

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // 既存の/media/newsページやイベント詳細ページと同じfetchAllNewsを再利用する
  // (next:{revalidate:1800}でキャッシュされるため、ここで叩いても実質追加の外部通信は増えない)。
  // アーティスト名に依存しないためPromise.allと並行して先行取得しておく
  const newsItemsPromise = fetchAllNews(NEWS_SOURCES)

  // ディスコグラフィーに、代表アーティスト(album.artist_id)だけでなく
  // album_artist経由で追加アーティストとして紐づいているアルバムも含める。
  // 全リリース年表ページ(/artists/[id]/timeline)と同じ集合を返す共通ヘルパーを使う。
  const albumQuery = buildArtistAlbumQuery<ArtistAlbumRow>(
    supabase,
    id,
    'id, title, jacket_url, release_date, album_type, streaming_status'
  )

  const [
    [
      { data: artist, error },
      { data: albums },
      { data: musicEvents },
      { data: eventAppearances },
      { data: tieUps },
      { data: externalLinks },
      { data: awardEntries },
      { data: membershipRows },
      { data: rankingSelections },
    ],
    creditQuadrants,
    ownsRelease,
    mediaSelections,
  ] = await Promise.all([
    Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      albumQuery,
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      buildArtistAppearanceQuery<ArtistAppearanceRow>(
        supabase,
        id,
        'id, stage, venue, is_headliner, display_name, start_time, event_edition:event_edition_id(year, venue, event:event_id(name))'
      ),
      supabase
        .from('sync_entry')
        .select('id, usage_detail, sync_work:sync_work_id(title, work_type, year), track:track_id!inner(title, album_id, artist_id)')
        .eq('track.artist_id', id),
      supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
      supabase
        .from('award_entry')
        .select('id, year, category, result, award:award_id(name)')
        .eq('artist_id', id)
        .order('year', { ascending: false }),
      supabase
        .from('artist_relation')
        .select(
          'id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)'
        )
        .eq('relation_type', 'membership')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
      // artist_id直指定のranking_entry(タワレコメン等のトラック/アルバム起点とは別、
      // Fender NEXTのようなアーティストそのものが選出対象のキュレーションコンテンツ)。
      // selection型・ranked型の両方を表示する(3ページで方針を統一)。他の2ページと
      // 揃えて!innerにする(埋め込み先が無い行を素通りさせない)
      supabase
        .from('ranking_entry')
        .select('id, period_date, ranking:ranking_id!inner(id, name, list_type, source)')
        .eq('artist_id', id)
        .order('period_date', { ascending: false }),
    ]),
    buildArtistCreditQuadrants(supabase, id),
    hasOwnRelease(supabase, id),
    fetchArtistMediaSelections(supabase, id),
  ])

  if (error || !artist) {
    notFound()
  }

  const { items: newsItems } = await newsItemsPromise
  const relatedNews = findRelatedNews(
    newsItems,
    [artist.name, artist.name_kana, artist.name_en].filter((k): k is string => Boolean(k)),
    3
  )

  const mvVideoId = artist.url_latest_mv ? extractYoutubeVideoId(artist.url_latest_mv) : null

  const hasCreditQuadrantData =
    creditQuadrants.producers.length > 0 ||
    creditQuadrants.credits.length > 0 ||
    creditQuadrants.collaborators.length > 0 ||
    creditQuadrants.musicians.length > 0

  // membershipRows には自分がバンド側(artist_id_a)・メンバー側(artist_id_b)
  // 両方のケースが混在するので、id基準でどちら向きかを判定して振り分ける
  const members: { id: string; name: string; imageUrl: string | null; description: string | null }[] = []
  const belongsToBands: { id: string; name: string; description: string | null }[] = []
  for (const row of membershipRows ?? []) {
    const band = Array.isArray(row.band) ? row.band[0] : row.band
    const member = Array.isArray(row.member) ? row.member[0] : row.member
    if (!band || !member) continue
    if (band.id === id) {
      members.push({ id: member.id, name: member.name, imageUrl: member.image_url, description: row.description })
    } else if (member.id === id) {
      belongsToBands.push({ id: band.id, name: band.name, description: row.description })
    }
  }

  const pageKind = resolveArtistPageKind(artist.page_override, ownsRelease)

  if (pageKind === 'member') {
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, artist_a:artist_id_a(id, name), artist_b:artist_id_b(id, name)')
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)

    const productions = (productionRows ?? [])
      .map((row) => {
        const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
        const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
        if (!a || !b) return null
        const other = a.id === id ? b : a
        return { id: row.id, artistId: other.id, artistName: other.name, description: row.description }
      })
      .filter((row): row is { id: number; artistId: string; artistName: string; description: string | null } => row !== null)

    return (
      <MemberProfile
        name={artist.name}
        nameKana={artist.name_kana}
        nameEn={artist.name_en}
        imageUrl={artist.image_url}
        bio={artist.bio}
        bands={belongsToBands}
        productions={productions}
      />
    )
  }

  // タワレコメン等のアルバム起点と同じ「🏆 選出」タグを、Fender NEXT・NME 100等
  // アーティスト直指定のキュレーションコンテンツにも汎用的に表示する
  // (以前はFender NEXTだけをハードコードで年別チップ表示していた)
  type RankingRef = { id: string; name: string; source: string | null }
  const seenRankingIds = new Set<string>()
  const curationRankings: RankingRef[] = (rankingSelections ?? [])
    .map((row) => (Array.isArray(row.ranking) ? row.ranking[0] : row.ranking))
    .filter((r): r is RankingRef & { list_type: string } => r != null)
    .filter((r) => {
      if (seenRankingIds.has(r.id)) return false
      seenRankingIds.add(r.id)
      return true
    })

  const appearances = (eventAppearances ?? [])
    .map((row) => {
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? edition?.venue ?? null,
        isHeadliner: row.is_headliner,
        eventName: event?.name ?? '—',
        year: edition?.year ?? 0,
        displayName: row.display_name,
      }
    })
    .sort((a, b) => b.year - a.year)

  // 見開き右の「代表曲」。パワープレイ実績と選出の件数が多い順に最大5曲。
  // どちらも無いアーティストではセクションごと出さない。
  // 以前はtrackを`.limit(200)`(orderなし=Postgresが返す200件は不定)でサンプリングし、
  // そのサンプル内でしかスコアを数えていなかったため、200曲を超えるアーティスト
  // (最も情報が充実したアーティストほど該当しやすい)で表示が毎回変わる/出ない
  // 不具合になっていた。track側を絞り込むのではなく、radio_rotation/ranking_entryを
  // artist_idでtrackに紐付けて(SQL側の埋め込みフィルタで)実際にスコアを持つ行だけを
  // 取得するように直す。この2テーブルの行数はトラック総数よりずっと少ないため、
  // 全件走査してもtrackを200件に切り詰めるより安全に全アーティストをカバーできる。
  type ScoredTrackRow = { track_id: string; track: { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null } | { id: string; title: string; album: { id: string; jacket_url: string | null } | { id: string; jacket_url: string | null }[] | null }[] | null }
  const [{ data: rotationRows }, { data: rankingRows }] = await Promise.all([
    supabase
      .from('radio_rotation')
      .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
      .eq('track.artist_id', id)
      .overrideTypes<ScoredTrackRow[], { merge: false }>(),
    supabase
      .from('ranking_entry')
      .select('track_id, track:track_id!inner(id, title, album:album_id(id, jacket_url))')
      .eq('track.artist_id', id)
      .overrideTypes<ScoredTrackRow[], { merge: false }>(),
  ])

  const scoreByTrackId = new Map<string, number>()
  const trackById = new Map<string, { id: string; title: string; album: { id: string; jacket_url: string | null } | null }>()
  for (const row of [...(rotationRows ?? []), ...(rankingRows ?? [])]) {
    if (!row.track_id) continue
    scoreByTrackId.set(row.track_id, (scoreByTrackId.get(row.track_id) ?? 0) + 1)
    if (!trackById.has(row.track_id)) {
      const t = Array.isArray(row.track) ? row.track[0] : row.track
      if (t) {
        const album = Array.isArray(t.album) ? t.album[0] : t.album
        trackById.set(row.track_id, { id: t.id, title: t.title, album: album ?? null })
      }
    }
  }
  const topTracks = Array.from(trackById.values())
    .map((t) => ({ ...t, score: scoreByTrackId.get(t.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <StickyMiniHeader
        watchElementId="artist-header"
        imageUrl={artist.image_url}
        title={artist.name}
        subtitle={artist.name_kana ?? artist.name_en ?? null}
      />

      <div className="mt-4">
        <DetailHeader
          id="artist-header"
          imageUrl={artist.image_url}
          imageAlt={artist.name}
          imageShape="circle"
          title={artist.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2">
              {artist.name_kana && <span>{artist.name_kana}</span>}
              {artist.name_en && <span className="text-white/40">{artist.name_en}</span>}
            </span>
          }
          metaLine={
            <span className="flex flex-wrap items-center gap-x-2">
              {artist.artist_type && (
                <span>
                  {ARTIST_TYPE_LABEL[artist.artist_type as keyof typeof ARTIST_TYPE_LABEL] ?? artist.artist_type}
                </span>
              )}
              {artist.formed_year && (
                <>
                  <span>·</span>
                  <span>結成 {artist.formed_year}年</span>
                </>
              )}
              {(artist.origin_prefecture || artist.hometown_city) && (
                <>
                  <span>·</span>
                  <span>{artist.hometown_city ?? artist.origin_prefecture}</span>
                </>
              )}
              {artist.streaming_status && (
                <>
                  <span>·</span>
                  <span>配信: {ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]}</span>
                </>
              )}
              {belongsToBands.map((band) => (
                <span key={band.id} className="flex items-center gap-x-2">
                  <span>·</span>
                  <Link href={`/artists/${band.id}`} className="hover:text-white">
                    🎤 {band.name} のメンバー
                  </Link>
                </span>
              ))}
            </span>
          }
          actions={
            <ArtistLinkIcons
              artistName={artist.name}
              officialSiteUrl={artist.official_site_url}
              snsXUrl={artist.sns_x_url}
              snsInstagramUrl={artist.sns_instagram_url}
              appleMusicArtistId={artist.apple_music_artist_id}
              spotifyArtistId={artist.spotify_artist_id}
              externalLinks={externalLinks ?? []}
            />
          }
          rankings={curationRankings}
        />
      </div>

      {(() => {
        const showVisual = hasVisualContent({
          review: artist.bio,
          youtubeVideoId: mvVideoId,
          imageUrl: artist.image_url,
        })
        // `appearances` は既存コード(eventAppearancesを整形した変数)をそのまま使う
        const hasRightContent = topTracks.length > 0 || (musicEvents && musicEvents.length > 0) || appearances.length > 0

        if (!showVisual && !hasRightContent) return null

        return (
          <div className={showVisual && hasRightContent ? 'mt-10 flex flex-col gap-10 lg:flex-row' : 'mt-10'}>
            {showVisual && (
              <div className={hasRightContent ? 'lg:w-[46%] lg:shrink-0' : ''}>
                <VisualSlot
                  review={artist.bio}
                  youtubeVideoId={mvVideoId}
                  imageUrl={artist.image_url}
                  imageAlt={artist.name}
                  imageShape="circle"
                />
              </div>
            )}
            {hasRightContent && (
              <div className="min-w-0 flex-1 space-y-8">
                {topTracks.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">代表曲</h2>
                    <ol className="mt-3 divide-y divide-white/10">
                      {topTracks.map((t) => {
                        const tAlbum = Array.isArray(t.album) ? t.album[0] : t.album
                        return (
                          <li key={t.id}>
                            <Link href={`/tracks/${t.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:opacity-70">
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                                {tAlbum?.jacket_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={tAlbum.jacket_url} alt="" className="h-full w-full object-cover" />
                                )}
                              </div>
                              <span className="flex-1 truncate">{t.title}</span>
                            </Link>
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                )}

                {musicEvents && musicEvents.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">ライブ情報</h2>
                    <ul className="mt-3 space-y-2 text-sm">
                      {musicEvents.map((live) => (
                        <li key={live.id}>
                          <p className="font-medium">{live.name}</p>
                          <p className="text-xs text-white/40">
                            {formatDate(live.event_date)}
                            {live.venue ? ` ・ ${live.venue}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {appearances.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">フェス出演</h2>
                    <ul className="mt-3 space-y-3 text-sm">
                      {appearances.map((a) => (
                        <li key={a.id}>
                          <p className="font-medium">
                            {a.eventName}
                            {a.year > 0 ? `(${a.year})` : ''}
                          </p>
                          <p className="text-xs text-white/40">
                            {a.stage ?? ''}
                            {a.venue ? ` @ ${a.venue}` : ''}
                            {a.isHeadliner ? ' ・ ★ヘッドライナー' : ''}
                          </p>
                          {a.displayName && <p className="text-xs text-white/30">{a.displayName} 名義で出演</p>}
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

      <section className="mt-14">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Discography</h2>
        {!albums || albums.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <>
            {ALBUM_TYPE_ORDER.map((type) => {
              const albumsForType = albums.filter((album) => ((album.album_type as AlbumType | null) ?? 'Album') === type)
              if (albumsForType.length === 0) return null
              return (
                <div key={type} className="mt-6 first:mt-4">
                  <h3 className="text-xs uppercase tracking-wide text-white/40">
                    {ALBUM_TYPE_LABEL_JA[type]} <span className="text-white/25">({albumsForType.length})</span>
                  </h3>
                  <div className="mt-2 flex gap-4 overflow-x-auto pb-2">
                    {albumsForType.map((album) => {
                      // Apple Music限定(apple_only)は自動判定できず手動設定でしか付かないため、
                      // ここでは自動検知される「配信なし(未解禁・配信停止)」のみバッジ表示する
                      const status = album.streaming_status === 'none' ? STREAMING_STATUS_LABEL.none : null
                      return (
                        <Link key={album.id} href={`/albums/${album.id}`} className="group block w-28 flex-shrink-0">
                          <div className="relative aspect-square overflow-hidden rounded-md bg-white/5">
                            {album.jacket_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={album.jacket_url}
                                alt={album.title}
                                className={`h-full w-full object-cover transition group-hover:scale-105 ${
                                  status ? 'opacity-60' : ''
                                }`}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white/20">
                                No Art
                              </div>
                            )}
                          </div>
                          <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                          <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
                          {status && (
                            <p className="mt-0.5 text-xs text-white/40">
                              {status.icon} {status.label}
                            </p>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

      <section className="mt-14">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Timeline</h2>
        <ArtistTimeline
          albums={(albums ?? []).filter((a) => ['Album', 'Best'].includes((a.album_type as AlbumType | null) ?? 'Album'))}
          musicEvents={musicEvents ?? []}
          eventAppearances={eventAppearances ?? []}
          tieUps={tieUps ?? []}
          mediaSelections={mediaSelections}
          awards={(awardEntries ?? []).map((row) => {
            const award = Array.isArray(row.award) ? row.award[0] : row.award
            return {
              id: row.id,
              year: row.year,
              awardName: award?.name ?? '',
              category: row.category,
              result: row.result === 'winner' ? '受賞' : 'ノミネート',
            }
          })}
        />
        <Link href={`/artists/${id}/timeline`} className="mt-3 inline-block text-xs text-white/40 hover:text-white/70">
          年表をすべて見る(シングル・EPを含む全リリース) →
        </Link>
      </section>

      {members.length > 0 && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Members</h2>
          <div className="mt-4 flex flex-wrap gap-4">
            {members.map((member) => (
              <Link
                key={member.id}
                href={`/artists/${member.id}`}
                className="group flex w-32 flex-col items-center text-center"
              >
                {member.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.imageUrl}
                    alt={member.name}
                    className="h-20 w-20 rounded-full object-cover transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-2xl">
                    🎤
                  </div>
                )}
                <p className="mt-2 truncate text-sm font-medium">{member.name}</p>
                {member.description && <p className="text-xs text-white/40">{member.description}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {awardEntries && awardEntries.length > 0 && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Awards</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {awardEntries.map((row) => {
              const award = Array.isArray(row.award) ? row.award[0] : row.award
              return (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span>
                    {row.year} {award?.name}
                    {row.category && <span className="text-white/40"> ・ {row.category}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                      row.result === 'winner' ? 'border-amber-400/40 text-amber-300' : 'border-white/15 text-white/50'
                    }`}
                  >
                    {row.result === 'winner' ? '🏆 受賞' : 'ノミネート'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="mt-14">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">Relation Graph</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
          <ArtistCreditQuadrantGraph
            centerName={artist.name}
            centerImageUrl={artist.image_url}
            quadrants={creditQuadrants}
          />
        </div>
        {hasCreditQuadrantData && (
          <div>
            <Link
              href={`/artists/${artist.id}/relations`}
              className="mt-2 block text-right text-xs text-white/40 hover:text-white/70"
            >
              相関図を全画面で見る →
            </Link>
          </div>
        )}
      </section>

      {relatedNews.length > 0 && (
        <section className="mt-14">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">関連ニュース</h2>
          <div className="mt-3 space-y-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
            {relatedNews.map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2 transition hover:border-white/30 sm:block sm:overflow-hidden sm:rounded-lg sm:p-0"
              >
                <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-white/5 sm:aspect-video sm:h-auto sm:w-full sm:rounded-none">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20 sm:text-xs">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 sm:p-3">
                  <p className="line-clamp-2 text-xs font-medium leading-snug sm:text-sm">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40 sm:mt-2 sm:justify-between sm:text-xs">
                    <span>{item.source}</span>
                    <span>{formatRelativeTime(item.publishedAt)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
