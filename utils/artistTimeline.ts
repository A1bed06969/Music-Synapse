const WORK_TYPE_LABEL: Record<string, string> = {
  anime: 'アニメ',
  tv_program: 'TV番組',
  movie: '映画',
  cm: 'CM',
  game: 'ゲーム',
}

/** timestamptz(UTC)からJSTの日付部分を取り出す。PostgRESTはtimestamptzをUTCで
 * 返すため、そのままslice(0,10)すると日付がずれることがある(実データで確認済み)。 */
function toJstDate(isoString: string): string {
  return new Date(new Date(isoString).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export type ArtistTimelineEntry = {
  date: string
  kind: 'release' | 'live' | 'festival' | 'tieup'
  title: string
  subtitle: string | null
  href: string | null
  imageUrl: string | null
}

export type ArtistTimelineInput = {
  releases: { albumId: string; title: string; releaseDate: string | null; jacketUrl: string | null }[]
  lives: { id: string; name: string; eventDate: string | null; venue: string | null }[]
  festivals: { appearanceId: number; eventName: string; startTime: string | null; venue: string | null }[]
  tieUps: { id: number; trackTitle: string; workType: string; workTitle: string; year: number | null; usageDetail: string | null; albumId: string | null }[]
}

/** アーティストページが既に取得済みのデータを、日付が分かる出来事だけ時系列1本の
 * リストへマージする。日付を持たない行(タイアップのyear未入力、フェス出演の
 * start_time未設定等)は年表からは除外する(既存の各セクション側には引き続き表示される)。 */
export function buildArtistTimeline(input: ArtistTimelineInput): ArtistTimelineEntry[] {
  const entries: ArtistTimelineEntry[] = []

  for (const release of input.releases) {
    if (!release.releaseDate) continue
    entries.push({
      date: release.releaseDate,
      kind: 'release',
      title: release.title,
      subtitle: null,
      href: `/albums/${release.albumId}`,
      imageUrl: release.jacketUrl,
    })
  }

  for (const live of input.lives) {
    if (!live.eventDate) continue
    entries.push({
      date: live.eventDate,
      kind: 'live',
      title: live.name,
      subtitle: live.venue,
      href: null,
      imageUrl: null,
    })
  }

  for (const festival of input.festivals) {
    if (!festival.startTime) continue
    entries.push({
      date: toJstDate(festival.startTime),
      kind: 'festival',
      title: festival.eventName,
      subtitle: festival.venue,
      href: null,
      imageUrl: null,
    })
  }

  for (const tieUp of input.tieUps) {
    if (!tieUp.year) continue
    const typeLabel = WORK_TYPE_LABEL[tieUp.workType] ?? tieUp.workType
    const subtitle = tieUp.usageDetail
      ? `${tieUp.workTitle}(${typeLabel}・${tieUp.usageDetail})`
      : `${tieUp.workTitle}(${typeLabel})`
    entries.push({
      date: `${tieUp.year}-01-01`,
      kind: 'tieup',
      title: tieUp.trackTitle,
      subtitle,
      href: tieUp.albumId ? `/albums/${tieUp.albumId}` : null,
      imageUrl: null,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
