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

/** 'YYYY-MM-DD' から 'YYYY.MM' を取り出す(ツアー期間の表示用) */
function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7).replace('-', '.')
}

/** 同じ名前のmusic_event(単独ライブ)を1本のツアーとしてまとめる。全国ツアーの
 * 各会場が同名の別行として登録されている場合、日付範囲+公演数の1エントリに
 * 圧縮する(公演が1件だけの名前は従来通り単発ライブとして扱い、会場名を
 * そのままsubtitleに使う)。 */
function groupLivesByName(
  lives: { id: string; name: string; eventDate: string | null; venue: string | null }[]
): { date: string; title: string; subtitle: string | null }[] {
  const groups = new Map<string, { dates: string[]; venues: Set<string> }>()
  for (const live of lives) {
    if (!live.eventDate) continue
    const group = groups.get(live.name) ?? { dates: [], venues: new Set<string>() }
    group.dates.push(live.eventDate)
    if (live.venue) group.venues.add(live.venue)
    groups.set(live.name, group)
  }

  return Array.from(groups.entries()).map(([name, group]) => {
    const sortedDates = [...group.dates].sort()
    const startDate = sortedDates[0]
    const endDate = sortedDates[sortedDates.length - 1]

    if (sortedDates.length === 1) {
      return { date: startDate, title: name, subtitle: group.venues.size > 0 ? [...group.venues][0] : null }
    }

    const range =
      toYearMonth(startDate) === toYearMonth(endDate)
        ? toYearMonth(startDate)
        : `${toYearMonth(startDate)}〜${toYearMonth(endDate)}`
    return { date: startDate, title: name, subtitle: `${range}(${sortedDates.length}公演)` }
  })
}

/** 同じ楽曲が同日に複数局でパワープレイ等に選出されている場合、局ごとに別行に
 * ならないよう1エントリにまとめる(全国ネットの提供楽曲は数十局まとめて登録
 * されるため、まとめないと年表が同じ日付の行で埋まってしまう)。選出が1件だけの
 * 楽曲は従来通りメディア名+番組名をsubtitleに使う。楽曲名が無い行(アーティスト
 * 直接指定)は他の行と誤って混ざらないようid単位で独立させる。 */
function groupMediaSelections(
  mediaSelections: ArtistTimelineInput['mediaSelections']
): { date: string; title: string; subtitle: string | null }[] {
  const groups = new Map<string, { date: string; mediaName: string | null; programName: string | null }[]>()

  for (const media of mediaSelections) {
    if (!media.date) continue
    const key = media.trackTitle ?? `__untitled_${media.id}`
    const items = groups.get(key) ?? []
    items.push({ date: media.date, mediaName: media.mediaName, programName: media.programName })
    groups.set(key, items)
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const title = key.startsWith('__untitled_') ? '—' : key

    if (items.length === 1) {
      return {
        date: items[0].date,
        title,
        subtitle: [items[0].mediaName, items[0].programName].filter(Boolean).join(' ') || null,
      }
    }

    const sortedDates = [...items.map((i) => i.date)].sort()
    const startDate = sortedDates[0]
    const endDate = sortedDates[sortedDates.length - 1]
    const rangePrefix = toYearMonth(startDate) === toYearMonth(endDate) ? '' : `${toYearMonth(startDate)}〜${toYearMonth(endDate)}・`
    const stationCount = new Set(items.map((i) => i.mediaName).filter(Boolean)).size || items.length

    return {
      date: startDate,
      title,
      subtitle: `${rangePrefix}全国${stationCount}局にてパワープレイ選出`,
    }
  })
}

export type ArtistTimelineEntry = {
  date: string
  kind: 'release' | 'live' | 'festival' | 'tieup' | 'media' | 'award'
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
  mediaSelections: { id: string; date: string | null; trackTitle: string | null; mediaName: string | null; programName: string | null }[]
  awards: { id: number; year: number | null; awardName: string; category: string | null; result: string | null }[]
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

  for (const tour of groupLivesByName(input.lives)) {
    entries.push({
      date: tour.date,
      kind: 'live',
      title: tour.title,
      subtitle: tour.subtitle,
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

  for (const media of groupMediaSelections(input.mediaSelections)) {
    entries.push({
      date: media.date,
      kind: 'media',
      title: media.title,
      subtitle: media.subtitle,
      href: null,
      imageUrl: null,
    })
  }

  for (const award of input.awards) {
    if (!award.year) continue
    const namePart = [award.awardName, award.category].filter(Boolean).join(' ')
    const resultPart = award.result ? `(${award.result})` : ''
    entries.push({
      date: `${award.year}-01-01`,
      kind: 'award',
      title: `${namePart}${resultPart}`,
      subtitle: null,
      href: null,
      imageUrl: null,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
