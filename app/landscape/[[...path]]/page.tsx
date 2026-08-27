import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/utils/fetchAllRows'
import type { LineageEdge } from '@/utils/genreHistory'
import { resolveRootGenreId, resolveRootGenreName, calculateLandscapePosition, calculateLeafArtistPosition } from '@/lib/landscape/coordinate'
import { getGenreAnchor, type Vector2 } from '@/lib/landscape/genreAnchors'
import { colorForGenre } from '@/lib/landscape/genreColors'
import { getDerivationChildren, getSubtreeGenreIds, resolveGenrePath } from '@/lib/landscape/hierarchy'
import LandscapeView, { type LandscapeArtist, type GenreZoomTarget } from '../LandscapeView'
import SubgenreBrowseView, { type SubgenreTile } from '../SubgenreBrowseView'
import LandscapeBreadcrumb, { type BreadcrumbStep } from '../LandscapeBreadcrumb'

export const maxDuration = 60

export const metadata = {
  title: 'ミュージックランドスケープ | Music Synapse',
  description: 'アーティストをジャンルの近さで空間に配置し、検索ではなく探索で音楽と出会うためのビジュアライゼーション。',
}

const PER_GENRE_CAP = 15

/** artist_genre(疎だが直接タグ)とgenre_highlight(このセッションで構築した
 * ジャンル年表由来、より充実)の両方から、アーティストごとに1件だけ具体
 * ジャンルを採用する。両方に存在する場合はgenre_highlight(ジャンル年表側)を
 * 優先する(キュレーションされた代表アーティスト紐付けの方が質が高いため)。
 * 同じアーティストが複数ジャンルに紐づく場合は最初に見つかったものを採用する
 * (MVPでは1アーティスト=1ジャンルに単純化)。 */
function pickPrimaryGenrePerArtist(
  highlightRows: { artist_id: string | null; genre_id: string }[],
  tagRows: { artist_id: string; genre_id: string }[]
): Map<string, string> {
  const genreIdByArtistId = new Map<string, string>()
  for (const row of highlightRows) {
    if (!row.artist_id) continue
    if (genreIdByArtistId.has(row.artist_id)) continue
    genreIdByArtistId.set(row.artist_id, row.genre_id)
  }
  for (const row of tagRows) {
    if (genreIdByArtistId.has(row.artist_id)) continue
    genreIdByArtistId.set(row.artist_id, row.genre_id)
  }
  return genreIdByArtistId
}

type ArtistCardData = {
  artist: { id: string; name: string; image_url: string | null; hometown_city: string | null; hometown_country: string | null; formed_year: number | null }
  latestRelease: { title: string; releaseDate: string | null } | null
  liveAppearance: { eventName: string; startTime: string | null; isUpcoming: boolean } | null
}

/** 選ばれたアーティストID群について、カード表示に必要な詳細(プロフィール・
 * 直近リリース・直近ライブ)をまとめて取得する。ルート表示・リーフ表示の
 * 両方から使う共通ロジック(以前はルート表示にしか無かった)。 */
async function fetchArtistCardData(supabase: SupabaseClient, artistIds: string[]): Promise<Map<string, ArtistCardData>> {
  const result = new Map<string, ArtistCardData>()
  if (artistIds.length === 0) return result

  type AlbumRow = { artist_id: string | null; title: string; release_date: string | null }
  type AppearanceLinkRow = { artist_id: string; event_appearance_id: number }
  type EventRef = { name: string } | { name: string }[] | null
  type AppearanceRow = {
    id: number
    start_time: string | null
    event_edition: { event: EventRef } | { event: EventRef }[] | null
  }

  // 300件を超えるケースへの保険としてチャンク分割+並列取得にしておく
  const CHUNK = 300
  const chunks: string[][] = []
  for (let i = 0; i < artistIds.length; i += CHUNK) chunks.push(artistIds.slice(i, i + CHUNK))

  const [chunkResults, { data: albumRows }, { data: appearanceLinkRows }] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        supabase.from('artist').select('id, name, image_url, hometown_city, hometown_country, formed_year').in('id', chunk)
      )
    ),
    // カード用の「直近のリリース」は本人名義(album.artist_id)のみを対象にする
    // (コラボ・参加クレジット分まで含めるとartist_albumとの結合が必要になり、
    // ここでは簡易な最新1件表示のためのものなのでYAGNI: スコープを絞る)
    supabase
      .from('album')
      .select('artist_id, title, release_date')
      .in('artist_id', artistIds)
      .is('primary_album_id', null)
      .order('release_date', { ascending: false, nullsFirst: false }),
    supabase.from('event_appearance_artist').select('artist_id, event_appearance_id').in('artist_id', artistIds),
  ])

  const artistsById = new Map<string, ArtistCardData['artist']>()
  for (const { data } of chunkResults) {
    for (const a of data ?? []) artistsById.set(a.id, a)
  }

  const latestReleaseByArtistId = new Map<string, { title: string; releaseDate: string | null }>()
  for (const row of (albumRows ?? []) as AlbumRow[]) {
    if (!row.artist_id || latestReleaseByArtistId.has(row.artist_id)) continue
    latestReleaseByArtistId.set(row.artist_id, { title: row.title, releaseDate: row.release_date })
  }

  const appearanceIds = [...new Set((appearanceLinkRows ?? []).map((r) => r.event_appearance_id))]
  const { data: appearanceRows } =
    appearanceIds.length > 0
      ? await supabase
          .from('event_appearance')
          .select('id, start_time, event_edition:event_edition_id(event:event_id(name))')
          .in('id', appearanceIds)
      : { data: [] as AppearanceRow[] }

  const appearanceById = new Map<number, { eventName: string; startTime: string | null }>()
  for (const row of (appearanceRows ?? []) as AppearanceRow[]) {
    const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
    const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
    appearanceById.set(row.id, { eventName: event?.name ?? '—', startTime: row.start_time })
  }

  const appearanceIdsByArtist = new Map<string, number[]>()
  for (const row of (appearanceLinkRows ?? []) as AppearanceLinkRow[]) {
    const list = appearanceIdsByArtist.get(row.artist_id) ?? []
    list.push(row.event_appearance_id)
    appearanceIdsByArtist.set(row.artist_id, list)
  }

  const nowIso = new Date().toISOString()
  const liveAppearanceByArtistId = new Map<string, { eventName: string; startTime: string | null; isUpcoming: boolean }>()
  for (const [artistId, ids] of appearanceIdsByArtist) {
    const rows = ids.map((id) => appearanceById.get(id)).filter((r): r is { eventName: string; startTime: string | null } => !!r)
    if (rows.length === 0) continue
    const upcoming = rows.filter((r) => r.startTime && r.startTime >= nowIso).sort((a, b) => a.startTime!.localeCompare(b.startTime!))
    const past = rows.filter((r) => !r.startTime || r.startTime < nowIso).sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''))
    const chosen = upcoming[0] ?? past[0]
    if (chosen) liveAppearanceByArtistId.set(artistId, { ...chosen, isUpcoming: chosen === upcoming[0] })
  }

  for (const artistId of artistIds) {
    const artist = artistsById.get(artistId)
    if (!artist) continue
    result.set(artistId, {
      artist,
      latestRelease: latestReleaseByArtistId.get(artistId) ?? null,
      liveAppearance: liveAppearanceByArtistId.get(artistId) ?? null,
    })
  }
  return result
}

export default async function LandscapePage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params
  const supabase = await createClient()

  // artist_genreは1223件でPostgRESTの1回あたり上限(1000件)を超えており、
  // 単純な.select()だと後半のタグが欠落する(ランドスケープの対象アーティスト
  // 選定漏れにつながる)ためページングする
  const [{ data: lineageRows }, { data: genreRows }, { data: highlightRows }, tagRows] = await Promise.all([
    supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type'),
    supabase.from('genre').select('id, name, landscape_x, landscape_y'),
    supabase.from('genre_highlight').select('artist_id, genre_id').not('artist_id', 'is', null),
    fetchAllRows<{ artist_id: string; genre_id: string }>(supabase, 'artist_genre', 'artist_id, genre_id', 'artist_id'),
  ])

  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: (r.relation_type as LineageEdge['relationType']) ?? 'derivation',
  }))
  const genreNameById = new Map((genreRows ?? []).map((g) => [g.id, g.name]))
  const genreIdSet = new Set(genreNameById.keys())

  // genre_lineageからのUMAP埋め込み(仕様29番ステップ2)
  const dbGenreAnchors = new Map<string, Vector2>(
    (genreRows ?? [])
      .filter((g) => g.landscape_x != null && g.landscape_y != null)
      .map((g) => [g.name.trim().toLowerCase(), { x: g.landscape_x as number, y: g.landscape_y as number }])
  )

  const genreIdByArtistId = pickPrimaryGenrePerArtist(
    (highlightRows ?? []) as { artist_id: string | null; genre_id: string }[],
    (tagRows ?? []) as { artist_id: string; genre_id: string }[]
  )

  // 1アーティストが複数のgenre_highlightに登場する回数を軽い「重要度」の
  // シグナルとして使う(仕様11番)
  const highlightCountByArtistId = new Map<string, number>()
  for (const row of highlightRows ?? []) {
    if (!row.artist_id) continue
    highlightCountByArtistId.set(row.artist_id, (highlightCountByArtistId.get(row.artist_id) ?? 0) + 1)
  }

  // URLのジャンルパスを検証する。ルートから順にderivationの親子関係として
  // 辻褄が合わないパスは404にする
  let currentGenreId: string | null = null
  if (path.length > 0) {
    currentGenreId = resolveGenrePath(path, edges, genreIdSet)
    if (!currentGenreId) notFound()
  }

  const breadcrumbSteps: BreadcrumbStep[] = [{ name: '全音楽', href: '/landscape' }]
  for (let i = 0; i < path.length; i++) {
    breadcrumbSteps.push({
      name: genreNameById.get(path[i]) ?? '?',
      href: `/landscape/${path.slice(0, i + 1).join('/')}`,
    })
  }

  // --- 階層ズームの分岐: (1)ルート一覧 (2)サブジャンル一覧 (3)リーフのアーティスト地図 ---

  if (currentGenreId) {
    const children = getDerivationChildren(currentGenreId, edges)

    if (children.length > 0) {
      // (2) サブジャンル一覧: 簡易レイアウト(UMAPは使わない)
      const tiles: SubgenreTile[] = children.map((childId) => {
        const subtreeIds = getSubtreeGenreIds(childId, edges)
        let artistCount = 0
        for (const genreId of genreIdByArtistId.values()) {
          if (subtreeIds.has(genreId)) artistCount++
        }
        return {
          genreId: childId,
          name: genreNameById.get(childId) ?? '?',
          artistCount,
          href: `/landscape/${[...path, childId].join('/')}`,
        }
      })

      return (
        <div className="mx-auto max-w-[1600px] px-6 py-12">
          <LandscapeBreadcrumb steps={breadcrumbSteps} />
          <h1 className="mt-4 text-2xl font-bold">{genreNameById.get(currentGenreId) ?? '?'}</h1>
          <p className="mt-2 text-sm text-white/50">サブジャンルをクリックしてさらに掘り下げます。円の大きさはそのジャンル配下のアーティスト数です。</p>
          <div className="mt-8">
            <SubgenreBrowseView currentName={genreNameById.get(currentGenreId) ?? '?'} tiles={tiles} />
          </div>
        </div>
      )
    }

    // (3) リーフ: このジャンルに直接タグ付けされたアーティストの地図
    const leafArtistIds = [...genreIdByArtistId.entries()].filter(([, gId]) => gId === currentGenreId).map(([aId]) => aId)
    const cardDataByArtistId = await fetchArtistCardData(supabase, leafArtistIds)

    const leafName = genreNameById.get(currentGenreId) ?? '?'
    const landscapeArtists: LandscapeArtist[] = []
    for (const artistId of leafArtistIds) {
      const cardData = cardDataByArtistId.get(artistId)
      if (!cardData) continue
      const position = calculateLeafArtistPosition(artistId)
      landscapeArtists.push({
        artistId,
        name: cardData.artist.name,
        imageUrl: cardData.artist.image_url,
        rootGenre: leafName,
        specificGenre: leafName,
        origin: cardData.artist.hometown_city ?? cardData.artist.hometown_country ?? null,
        formedYear: cardData.artist.formed_year,
        x: position.x,
        y: position.y,
        importance: 1 + Math.min(highlightCountByArtistId.get(artistId) ?? 0, 4) * 0.12,
        color: colorForGenre(resolveRootGenreName(currentGenreId, genreNameById, edges)),
        latestRelease: cardData.latestRelease,
        liveAppearance: cardData.liveAppearance,
      })
    }

    return (
      <div className="mx-auto max-w-[1600px] px-6 py-12">
        <LandscapeBreadcrumb steps={breadcrumbSteps} />
        <h1 className="mt-4 text-2xl font-bold">{leafName}</h1>
        <p className="mt-2 text-sm text-white/50">これ以上サブジャンルはありません。{leafName}のアーティスト({landscapeArtists.length}組)です。</p>
        <div className="mt-8">
          <LandscapeView artists={landscapeArtists} genreOptions={[leafName]} />
        </div>
      </div>
    )
  }

  // (1) ルート一覧: 既存のトップレベル表示(全ルートジャンル横断)
  const rootGenreByArtistId = new Map<string, string | null>()
  const specificGenreByArtistId = new Map<string, string | null>()
  for (const [artistId, genreId] of genreIdByArtistId) {
    specificGenreByArtistId.set(artistId, genreNameById.get(genreId) ?? null)
    rootGenreByArtistId.set(artistId, resolveRootGenreName(genreId, genreNameById, edges))
  }

  // ルートジャンル名 -> ズーム先ID(パンくず/ドリルダウン用リンクに使う)。
  // アーティストの具体ジャンルIDから直接ルートIDを辿る(そのアーティスト自身が
  // ルートジャンルに直接タグ付けされているとは限らないため、名前の一致では
  // なくresolveRootGenreIdで確実に求める)。
  const rootGenreIdByName = new Map<string, string>()
  for (const genreId of genreIdByArtistId.values()) {
    const rootId = resolveRootGenreId(genreId, edges)
    const rootName = genreNameById.get(rootId)
    if (rootName && !rootGenreIdByName.has(rootName)) rootGenreIdByName.set(rootName, rootId)
  }

  const idsByGenre = new Map<string, string[]>()
  for (const [artistId] of genreIdByArtistId) {
    const key = rootGenreByArtistId.get(artistId) ?? '__unclassified__'
    const list = idsByGenre.get(key) ?? []
    list.push(artistId)
    idsByGenre.set(key, list)
  }

  const selectedArtistIds: string[] = []
  for (const ids of idsByGenre.values()) {
    ids.sort((a, b) => (highlightCountByArtistId.get(b) ?? 0) - (highlightCountByArtistId.get(a) ?? 0))
    selectedArtistIds.push(...ids.slice(0, PER_GENRE_CAP))
  }

  const cardDataByArtistId = await fetchArtistCardData(supabase, selectedArtistIds)

  const landscapeArtists: LandscapeArtist[] = []
  for (const artistId of selectedArtistIds) {
    const cardData = cardDataByArtistId.get(artistId)
    if (!cardData) continue

    const specificGenreName = specificGenreByArtistId.get(artistId) ?? null
    const rootGenreName = rootGenreByArtistId.get(artistId) ?? null
    const position = calculateLandscapePosition({ seedId: artistId, rootGenreName, specificGenreName }, dbGenreAnchors)
    const highlightCount = highlightCountByArtistId.get(artistId) ?? 0

    landscapeArtists.push({
      artistId,
      name: cardData.artist.name,
      imageUrl: cardData.artist.image_url,
      rootGenre: rootGenreName,
      specificGenre: specificGenreName,
      origin: cardData.artist.hometown_city ?? cardData.artist.hometown_country ?? null,
      formedYear: cardData.artist.formed_year,
      x: position.x,
      y: position.y,
      importance: 1 + Math.min(highlightCount, 4) * 0.12,
      color: colorForGenre(rootGenreName),
      latestRelease: cardData.latestRelease,
      liveAppearance: cardData.liveAppearance,
    })
  }

  const genreOptions = [...new Set(landscapeArtists.map((a) => a.rootGenre).filter((g): g is string => !!g))].sort((a, b) =>
    a.localeCompare(b)
  )

  // ルート一覧のズームを、別リストのテキストリンクではなく地図上の実座標に
  // 直接重ねたクリック可能マーカーにする(ジャンルのアンカー位置=そのジャンルの
  // アーティストがクラスタしている場所そのもの)
  const genreZoomTargets: GenreZoomTarget[] = [...rootGenreIdByName.entries()].map(([name, id]) => {
    const anchor = getGenreAnchor(name, dbGenreAnchors)
    return {
      name,
      x: anchor.x,
      y: anchor.y,
      href: `/landscape/${id}`,
      artistCount: idsByGenre.get(name)?.length ?? 0,
    }
  })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">MUSIC LANDSCAPE</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストをジャンルの近さで空間に配置した地図。検索するのではなく、眺めながら歩いて音楽と出会うためのビジュアライゼーションです。
        (現在は各ジャンル上位{PER_GENRE_CAP}組・{landscapeArtists.length}組を表示中。丸いマーカーをクリックするとそのジャンルへズームします)
      </p>

      <div className="mt-8">
        <LandscapeView artists={landscapeArtists} genreOptions={genreOptions} genreZoomTargets={genreZoomTargets} />
      </div>
    </div>
  )
}
