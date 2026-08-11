// パイロット3局(J-WAVE, FM福井, FMノースウェーブ)のパワープレイ/ヘビーローテーション
// ページから最新の選曲を取得する。3局とも静的HTMLで構成されているため、
// (JS描画が必要なFM802等とは異なり)fetch+正規表現の軽量な抽出で済む。
// スケールする際、サイト構造がもっとバラつく局が増えたらHaiku等でのLLM抽出に
// 切り替える想定。

const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type RadioPick = {
  stationName: string
  programName: string
  artistName: string
  trackTitle: string
  /** 'YYYY-MM-01' 形式。月が特定できない場合はnull */
  periodStartDate: string | null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${url}): ${res.status}`)
  }
  return res.text()
}

/** "June 2025" のような英語表記を 'YYYY-MM-01' に変換する */
function parseEnglishMonthLabel(label: string): string | null {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const match = label.match(/([A-Za-z]+)\s+(\d{4})/)
  if (!match) return null
  const monthIndex = months.findIndex((m) => m.toLowerCase() === match[1].toLowerCase())
  if (monthIndex === -1) return null
  return `${match[2]}-${String(monthIndex + 1).padStart(2, '0')}-01`
}

/** "2026年08月" のような和暦月表記を 'YYYY-MM-01' に変換する */
function parseJapaneseMonthLabel(label: string): string | null {
  const match = label.match(/(\d{4})年(\d{1,2})月/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-01`
}

export async function fetchJWaveSonarTrax(): Promise<RadioPick[]> {
  const html = await fetchHtml('https://www.j-wave.co.jp/special/sonartrax/')
  const monthMatch = html.match(/<p class="note">([^<]+)<\/p>/)
  const periodStartDate = monthMatch ? parseEnglishMonthLabel(monthMatch[1].trim()) : null

  const picks: RadioPick[] = []
  const entryRe = /<dt>SONG TITLE<\/dt><dd>([^<]+)<\/dd>\s*<dt>ARTIST NAME<\/dt><dd>([^<]+)<\/dd>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(html))) {
    picks.push({
      stationName: 'J-WAVE',
      programName: 'SONAR TRAX',
      trackTitle: m[1].trim(),
      artistName: m[2].trim(),
      periodStartDate,
    })
  }
  return picks
}

export async function fetchFmFukuiHeavyRotation(): Promise<RadioPick[]> {
  const html = await fetchHtml('https://www.fmfukui.jp/heavyrotation/')

  // 月見出しは新しい順に並んでいるため、最初の1ブロック(最新月)だけを対象にする
  const sectionMatch = html.match(
    /<h3 class="contents_title_03">([^<]+)<\/h3>([\s\S]*?)(?=<h3 class="contents_title_03">|$)/
  )
  if (!sectionMatch) return []
  const periodStartDate = parseJapaneseMonthLabel(sectionMatch[1].trim())
  const section = sectionMatch[2]

  const picks: RadioPick[] = []
  const entryRe = /<p class="heavy_tableText01">\s*<a[^>]*>([^／<]+)／([^<]+)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(section))) {
    picks.push({
      stationName: 'FM福井',
      programName: 'Heavy Rotation',
      artistName: m[1].trim(),
      trackTitle: m[2].trim(),
      periodStartDate,
    })
  }
  return picks
}

function extractBetween(html: string, startMarker: string, endMarker: string | null): string {
  const start = html.indexOf(startMarker)
  if (start === -1) return ''
  const end = endMarker ? html.indexOf(endMarker, start) : -1
  return end === -1 ? html.slice(start) : html.slice(start, end)
}

export async function fetchNorthWaveMegaPlay(): Promise<RadioPick[]> {
  const html = await fetchHtml('https://www.fmnorth.co.jp/megaplay/')

  // このページは今月の選曲のみを表示し、年月の記載自体が無いため、
  // 取得時点の年月をそのまま採用する
  const now = new Date()
  const periodStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const blocks: [string, string][] = [
    ['MEGA PLAY', extractBetween(html, 'class="c-megapower _megaPlay"', 'class="c-megapower _powerPush"')],
    ['POWER PUSH', extractBetween(html, 'class="c-megapower _powerPush"', null)],
  ]

  const picks: RadioPick[] = []
  for (const [programName, block] of blocks) {
    const titleMatch = block.match(/dataHeaderTitle _song">([^<]+)</)
    const artistMatch = block.match(/dataHeaderTitle _artist">(?:<a[^>]*>)?([^<]+)/)
    if (titleMatch && artistMatch) {
      picks.push({
        stationName: 'FMノースウェーブ',
        programName,
        trackTitle: titleMatch[1].trim(),
        artistName: artistMatch[1].trim(),
        periodStartDate,
      })
    }
  }
  return picks
}

export async function fetchPilotRadioPicks(): Promise<RadioPick[]> {
  const results: RadioPick[] = []
  for (const fetcher of [fetchJWaveSonarTrax, fetchFmFukuiHeavyRotation, fetchNorthWaveMegaPlay]) {
    try {
      results.push(...(await fetcher()))
    } catch (err) {
      console.error('ラジオ局データの取得に失敗しました:', err)
    }
    await sleep(500)
  }
  return results
}
