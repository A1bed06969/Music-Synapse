import { createClient } from '@/utils/Supabase/server'
import type { LineageEdge } from '@/utils/genreHistory'
import { resolveRootGenreName, calculateLandscapePosition } from '@/lib/landscape/coordinate'
import { colorForGenre } from '@/lib/landscape/genreColors'
import LandscapeView, { type LandscapeArtist } from './LandscapeView'

export const metadata = {
  title: 'ミュージックランドスケープ | Music Synapse',
  description: 'アーティストをジャンルの近さで空間に配置し、検索ではなく探索で音楽と出会うためのビジュアライゼーション。',
}

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

export default async function LandscapePage() {
  const supabase = await createClient()

  const [{ data: lineageRows }, { data: genreRows }, { data: highlightRows }, { data: tagRows }] = await Promise.all([
    supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type'),
    supabase.from('genre').select('id, name'),
    supabase.from('genre_highlight').select('artist_id, genre_id').not('artist_id', 'is', null),
    supabase.from('artist_genre').select('artist_id, genre_id'),
  ])

  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: (r.relation_type as LineageEdge['relationType']) ?? 'derivation',
  }))
  const genreNameById = new Map((genreRows ?? []).map((g) => [g.id, g.name]))

  const genreIdByArtistId = pickPrimaryGenrePerArtist(
    (highlightRows ?? []) as { artist_id: string | null; genre_id: string }[],
    (tagRows ?? []) as { artist_id: string; genre_id: string }[]
  )

  // 1アーティストが複数のgenre_highlightに登場する回数を軽い「重要度」の
  // シグナルとして使う(仕様11番: 既存DBに専用の重要度指標が無い場合は
  // まず簡易な値でよい、を踏襲。将来Discography数/Award等に置き換え可能)
  const highlightCountByArtistId = new Map<string, number>()
  for (const row of highlightRows ?? []) {
    if (!row.artist_id) continue
    highlightCountByArtistId.set(row.artist_id, (highlightCountByArtistId.get(row.artist_id) ?? 0) + 1)
  }

  const artistIds = [...genreIdByArtistId.keys()]

  const artistsById = new Map<
    string,
    { id: string; name: string; image_url: string | null; hometown_city: string | null; hometown_country: string | null; formed_year: number | null }
  >()
  // artist_id一覧が数百〜数千件になりうるため、PostgRESTの.in()一括取得ではなく
  // チャンク分割して取得する(URL長・行数上限を避けるため)
  const CHUNK = 300
  for (let i = 0; i < artistIds.length; i += CHUNK) {
    const chunk = artistIds.slice(i, i + CHUNK)
    const { data } = await supabase
      .from('artist')
      .select('id, name, image_url, hometown_city, hometown_country, formed_year')
      .in('id', chunk)
    for (const a of data ?? []) artistsById.set(a.id, a)
  }

  const landscapeArtists: LandscapeArtist[] = []
  for (const [artistId, genreId] of genreIdByArtistId) {
    const artist = artistsById.get(artistId)
    if (!artist) continue

    const specificGenreName = genreNameById.get(genreId) ?? null
    const rootGenreName = resolveRootGenreName(genreId, genreNameById, edges)
    const position = calculateLandscapePosition({ seedId: artistId, rootGenreName, specificGenreName })
    const highlightCount = highlightCountByArtistId.get(artistId) ?? 0

    landscapeArtists.push({
      artistId,
      name: artist.name,
      imageUrl: artist.image_url,
      rootGenre: rootGenreName,
      specificGenre: specificGenreName,
      origin: artist.hometown_city ?? artist.hometown_country ?? null,
      formedYear: artist.formed_year,
      x: position.x,
      y: position.y,
      importance: 1 + Math.min(highlightCount, 4) * 0.12,
      color: colorForGenre(rootGenreName),
    })
  }

  const genreOptions = [...new Set(landscapeArtists.map((a) => a.rootGenre).filter((g): g is string => !!g))].sort((a, b) =>
    a.localeCompare(b)
  )

  // モバイルでの描画負荷を抑えるため、799件全部ではなくジャンルごとに上限を
  // 設けて間引く。全体で単純にimportance上位だけを残すと、importanceの低い
  // (highlightの少ない)ジャンルが丸ごと消えて「ジャンル軸の分布」が
  // 分かりにくくなるため、ジャンルごとに上限件数を設けて満遍なく残す方式にする
  const PER_GENRE_CAP = 15
  const byGenre = new Map<string, LandscapeArtist[]>()
  for (const a of landscapeArtists) {
    const key = a.rootGenre ?? '__unclassified__'
    const list = byGenre.get(key) ?? []
    list.push(a)
    byGenre.set(key, list)
  }
  const cappedArtists: LandscapeArtist[] = []
  for (const list of byGenre.values()) {
    list.sort((a, b) => b.importance - a.importance)
    cappedArtists.push(...list.slice(0, PER_GENRE_CAP))
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">MUSIC LANDSCAPE</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストをジャンルの近さで空間に配置した地図。検索するのではなく、眺めながら歩いて音楽と出会うためのビジュアライゼーションです。
        (現在は各ジャンル上位{PER_GENRE_CAP}組・{cappedArtists.length}組を表示中)
      </p>

      <div className="mt-8">
        <LandscapeView artists={cappedArtists} genreOptions={genreOptions} />
      </div>
    </div>
  )
}
