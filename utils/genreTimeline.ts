// utils/genreTimeline.ts
//
// ジャンル詳細ページが既に取得済みのデータ(発祥情報・サブジャンル・代表アーティスト/
// 作品・タグ付きアーティストのリリース)を、日付が分かる出来事だけ時系列1本のリストへ
// マージする。サブジャンル/派生ジャンルとその代表作品の行はindent=trueにして、
// 親ジャンルから枝分かれしていることを示す(app/genres/[id]/GenreTimeline.tsxが
// インデント表示に使う)。日付を持たない行は年表から除外する。

export type GenreTimelineEntry = {
  date: string
  kind: 'origin' | 'derived' | 'release' | 'highlight'
  title: string
  subtitle: string | null
  href: string | null
  indent: boolean
}

export type GenreTimelineInput = {
  genreId: string
  genreName: string
  originYear: number | null
  // 「19世紀後半」のように年が特定されていない場合の元の表記。あればoriginYear
  // (並び替え専用の概算値)より優先して表示する。
  originYearLabel: string | null
  originPlace: string | null
  children: {
    genreId: string
    genreName: string
    originYear: number | null
    originYearLabel: string | null
    originPlace: string | null
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

export function buildGenreTimeline(input: GenreTimelineInput): GenreTimelineEntry[] {
  const entries: GenreTimelineEntry[] = []

  if (input.originYear) {
    const subtitle = [input.originYearLabel, input.originPlace].filter((s): s is string => Boolean(s)).join(' ・ ')
    entries.push({
      date: `${input.originYear}-01-01`,
      kind: 'origin',
      title: `${input.genreName} 発祥`,
      subtitle: subtitle || null,
      href: null,
      indent: false,
    })
  }

  for (const child of input.children) {
    if (!child.originYear) continue
    const subtitle = [child.originYearLabel, child.originPlace].filter((s): s is string => Boolean(s)).join(' ・ ')
    entries.push({
      date: `${child.originYear}-01-01`,
      kind: 'derived',
      title: `${child.genreName}が派生`,
      subtitle: subtitle || null,
      href: `/genres/${child.genreId}`,
      indent: true,
    })
  }

  const originYearByGenre = new Map<string, number>()
  if (input.originYear) originYearByGenre.set(input.genreId, input.originYear)
  for (const child of input.children) {
    if (child.originYear) originYearByGenre.set(child.genreId, child.originYear)
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
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
