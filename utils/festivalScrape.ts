// パイロット: Glastonbury Festivalの公式ラインナップページから出演者を取得する。
// このページは静的HTMLでステージ/曜日ごとに構造化されているため、
// (Coachella等JS描画のサイトとは異なり)fetch+正規表現の軽量な抽出で済む。
// スケールする際、サイト構造がもっとバラつくフェスが増えたらHaiku等での
// LLM抽出に切り替える想定(ラジオ局PP収集と同じ方針)。

const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'
const BASE_URL = 'https://www.glastonburyfestivals.co.uk'

export type FestivalPick = {
  festivalName: string
  editionYear: number
  stage: string | null
  day: string | null
  artistName: string
  /** 'YYYY-MM-DD' 形式。取得できない場合はnull */
  startDate: string | null
  endDate: string | null
  /** dayの曜日ラベルをstartDate〜endDateの実日付に解決したもの('YYYY-MM-DD')。
   * 出演日ごとのグルーピング表示に使う。解決できない場合はnull */
  performanceDate: string | null
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${url}): ${res.status}`)
  }
  return res.text()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "25th - 29th June 2025" のような表記を開始日・終了日のISO文字列に変換する */
function parseFestivalDates(label: string): { startDate: string | null; endDate: string | null } {
  const match = label.match(/(\d{1,2})\w{0,2}\s*-\s*(\d{1,2})\w{0,2}\s+([A-Za-z]+)\s+(\d{4})/)
  if (!match) return { startDate: null, endDate: null }
  const [, startDay, endDay, monthName, year] = match
  const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === monthName.toLowerCase())
  if (monthIndex === -1) return { startDate: null, endDate: null }
  const month = String(monthIndex + 1).padStart(2, '0')
  return {
    startDate: `${year}-${month}-${startDay.padStart(2, '0')}`,
    endDate: `${year}-${month}-${endDay.padStart(2, '0')}`,
  }
}

const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** startDate〜endDateの各日を曜日名(例: "FRIDAY")から実日付へ引けるMapを作る */
function buildWeekdayDateMap(startDate: string, endDate: string): Map<string, string> {
  const map = new Map<string, string>()
  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cursor.getTime() <= end.getTime()) {
    const weekday = WEEKDAY_NAMES[cursor.getUTCDay()]
    map.set(weekday, cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return map
}

/** ラインナップ一覧ページから、公開済みの開催年のうち最新のものを見つける */
async function findLatestEditionYear(): Promise<number> {
  const html = await fetchHtml(`${BASE_URL}/line-up/`)
  const years = Array.from(html.matchAll(/line-up-(\d{4})/g)).map((m) => Number(m[1]))
  if (years.length === 0) {
    throw new Error('開催年が見つかりませんでした。')
  }
  return Math.max(...years)
}

const LANDMARK_RE =
  /<h2 class="festival-dates">([^<]+)<\/h2>|<h3[^>]*class="stage-name"><button[^>]*>([^<]+)<span|<h4 class="stage-day">([^<]+)<\/h4>|<a class="artist-link"[^>]*>([^<]+)<\/a>/g

export async function fetchGlastonburyLineup(): Promise<FestivalPick[]> {
  const editionYear = await findLatestEditionYear()
  const html = await fetchHtml(`${BASE_URL}/line-up/line-up-${editionYear}/`)

  let startDate: string | null = null
  let endDate: string | null = null
  let weekdayDateMap: Map<string, string> = new Map()
  let currentStage: string | null = null
  let currentDay: string | null = null
  const picks: FestivalPick[] = []

  for (const m of html.matchAll(LANDMARK_RE)) {
    if (m[1] !== undefined) {
      ;({ startDate, endDate } = parseFestivalDates(m[1].trim()))
      weekdayDateMap = startDate && endDate ? buildWeekdayDateMap(startDate, endDate) : new Map()
    } else if (m[2] !== undefined) {
      currentStage = m[2].trim()
      currentDay = null
    } else if (m[3] !== undefined) {
      currentDay = m[3].trim()
    } else if (m[4] !== undefined) {
      const artistName = m[4].trim()
      if (!artistName || artistName === 'TBA') continue
      picks.push({
        festivalName: 'Glastonbury Festival',
        editionYear,
        stage: currentStage,
        day: currentDay,
        artistName,
        startDate,
        endDate,
        performanceDate: currentDay ? (weekdayDateMap.get(currentDay) ?? null) : null,
      })
    }
  }

  return picks
}
