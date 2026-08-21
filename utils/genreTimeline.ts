// utils/genreTimeline.ts
//
// ジャンル詳細ページが既に取得済みのデータ(発祥情報・サブジャンル・代表アーティスト/
// 作品・タグ付きアーティストのリリース)を、日付が分かる出来事だけエリア別にグループ化し、
// 各グループ内は時系列1本のリストへマージする。エリアはWikipediaから取り込んだ
// 発祥国のテキストをそのままグルーピングキーとして使う(正規化はしない。同じ国でも
// 表記が微妙に違えば別グループになるベストエフォート方式)。サブジャンル/派生ジャンルと
// その代表作品の行はindent=trueにして、親ジャンルから枝分かれしていることを示す
// (app/genres/[id]/GenreTimeline.tsxがインデント表示に使う)。日付を持たない行は
// 年表から除外する。

export type GenreTimelineEntry = {
  date: string
  kind: 'origin' | 'derived' | 'release' | 'highlight'
  title: string
  subtitle: string | null
  href: string | null
  indent: boolean
}

export type GenreTimelineGroup = {
  area: string
  entries: GenreTimelineEntry[]
}

const UNKNOWN_AREA = 'エリア不明'

export type GenreTimelineInput = {
  genreId: string
  genreName: string
  originYear: number | null
  // 「19世紀後半」のように年が特定されていない場合の元の表記。あればoriginYear
  // (並び替え専用の概算値)より優先して表示する。
  originYearLabel: string | null
  // エリアのグルーピングキー(セクション見出しにそのまま使う)。都市を含む詳細な
  // 発祥地テキストはUIの発祥地表示側(page.tsx)で別途扱う。
  originCountry: string | null
  children: {
    genreId: string
    genreName: string
    originYear: number | null
    originYearLabel: string | null
    originCountry: string | null
  }[]
  highlights: {
    genreId: string
    artistId: string | null
    artistName: string | null
    albumId: string | null
    albumTitle: string | null
    note: string | null
  }[]
  releases: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[]
}

function highlightTitle(h: GenreTimelineInput['highlights'][number]): string {
  if (h.albumTitle) {
    return h.artistName ? `代表: ${h.artistName}「${h.albumTitle}」` : `代表: 「${h.albumTitle}」`
  }
  return `代表: ${h.artistName ?? ''}`
}

export function buildGenreTimeline(input: GenreTimelineInput): GenreTimelineGroup[] {
  const entries: (GenreTimelineEntry & { area: string })[] = []

  if (input.originYear) {
    entries.push({
      date: `${input.originYear}-01-01`,
      kind: 'origin',
      title: `${input.genreName} 発祥`,
      subtitle: input.originYearLabel,
      href: null,
      indent: false,
      area: input.originCountry || UNKNOWN_AREA,
    })
  }

  for (const child of input.children) {
    if (!child.originYear) continue
    entries.push({
      date: `${child.originYear}-01-01`,
      kind: 'derived',
      title: `${child.genreName}が派生`,
      subtitle: child.originYearLabel,
      href: `/genres/${child.genreId}`,
      indent: true,
      area: child.originCountry || UNKNOWN_AREA,
    })
  }

  const originYearByGenre = new Map<string, number>()
  const originCountryByGenre = new Map<string, string>()
  if (input.originYear) originYearByGenre.set(input.genreId, input.originYear)
  if (input.originCountry) originCountryByGenre.set(input.genreId, input.originCountry)
  for (const child of input.children) {
    if (child.originYear) originYearByGenre.set(child.genreId, child.originYear)
    if (child.originCountry) originCountryByGenre.set(child.genreId, child.originCountry)
  }

  for (const h of input.highlights) {
    const year = originYearByGenre.get(h.genreId)
    if (!year) continue
    entries.push({
      date: `${year}-01-01`,
      kind: 'highlight',
      title: highlightTitle(h),
      subtitle: h.note,
      href: h.albumId ? `/albums/${h.albumId}` : h.artistId ? `/artists/${h.artistId}` : null,
      indent: h.genreId !== input.genreId,
      area: originCountryByGenre.get(h.genreId) || UNKNOWN_AREA,
    })
  }

  for (const release of input.releases) {
    if (!release.releaseDate) continue
    entries.push({
      date: release.releaseDate,
      kind: 'release',
      title: `${release.artistName}「${release.albumTitle}」リリース`,
      subtitle: null,
      href: `/albums/${release.albumId}`,
      indent: false,
      area: input.originCountry || UNKNOWN_AREA,
    })
  }

  const byArea = new Map<string, GenreTimelineEntry[]>()
  for (const { area, ...entry } of entries) {
    if (!byArea.has(area)) byArea.set(area, [])
    byArea.get(area)!.push(entry)
  }

  const groups: GenreTimelineGroup[] = Array.from(byArea.entries()).map(([area, groupEntries]) => ({
    area,
    entries: groupEntries.sort((a, b) => a.date.localeCompare(b.date)),
  }))

  // グループの並び順は、そのエリアで最も古い出来事の日付順(歴史的に早く動きが
  // あったエリアを先に表示する)。エリア不明は常に最後に回す。
  groups.sort((a, b) => {
    if (a.area === UNKNOWN_AREA) return 1
    if (b.area === UNKNOWN_AREA) return -1
    return a.entries[0].date.localeCompare(b.entries[0].date)
  })

  return groups
}
