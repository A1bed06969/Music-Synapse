export type LabelTimelineEntry = {
  date: string
  kind: 'founded' | 'founder' | 'joined' | 'left' | 'release' | 'award'
  title: string
  href: string | null
}

export type LabelTimelineInput = {
  foundedYear: number | null
  founders: { name: string; role: string | null }[]
  roster: { artistId: string; artistName: string; startDate: string | null; endDate: string | null }[]
  catalog: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[]
  awards: { year: number; awardName: string; category: string | null; result: string | null; subjectName: string }[]
}

/** レーベル詳細ページが既に取得済みのデータを、日付が分かる出来事だけ時系列1本の
 * リストへマージする。日付を持たない行(所属開始日未入力の所属アーティスト等)は
 * 年表からは除外する(既存の所属アーティスト一覧側には引き続き表示される)。 */
export function buildLabelTimeline(input: LabelTimelineInput): LabelTimelineEntry[] {
  const entries: LabelTimelineEntry[] = []

  if (input.foundedYear) {
    const foundedDate = `${input.foundedYear}-01-01`
    entries.push({ date: foundedDate, kind: 'founded', title: 'レーベル発足', href: null })
    for (const founder of input.founders) {
      entries.push({
        date: foundedDate,
        kind: 'founder',
        title: founder.role ? `${founder.name}(${founder.role})が設立` : `${founder.name}が設立`,
        href: null,
      })
    }
  }

  for (const member of input.roster) {
    if (member.startDate) {
      entries.push({
        date: member.startDate,
        kind: 'joined',
        title: `${member.artistName} 加入`,
        href: `/artists/${member.artistId}`,
      })
    }
    if (member.endDate) {
      entries.push({
        date: member.endDate,
        kind: 'left',
        title: `${member.artistName} 脱退`,
        href: `/artists/${member.artistId}`,
      })
    }
  }

  for (const album of input.catalog) {
    if (album.releaseDate) {
      entries.push({
        date: album.releaseDate,
        kind: 'release',
        title: `${album.artistName}「${album.albumTitle}」リリース`,
        href: `/albums/${album.albumId}`,
      })
    }
  }

  for (const award of input.awards) {
    const parts = [award.awardName, award.category, award.result ? `(${award.result})` : null].filter(Boolean)
    entries.push({
      date: `${award.year}-01-01`,
      kind: 'award',
      title: `${award.subjectName} ${parts.join(' ').replace(' (', '(')} 受賞`,
      href: null,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
