// scripts/extract-andpremium-music.ts
/**
 * 雑誌『&Premium』の連載コーナー「土曜の朝と日曜の夜の音楽」と、併設の小さなコーナー「土曜の夜と日曜の朝のジャズ」の
 * 選曲を、スプレッドシート(シート「&Music」)から読んでJSONに書き出す。
 *   左(A〜G列): 土曜の朝と日曜の夜の音楽 = 番号・アーティスト名・曲名・選曲者・選曲(年月日)・曜日・邦洋
 *   右(H〜M列): 土曜の夜と日曜の朝のジャズ = アーティスト名・曲名・選曲者・選曲(年月)・曜日・邦洋
 * 書き込みは行わない(読み取りのみ)。同じ曲が複数回出る場合も、日付ごとの別の選曲として残す。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/extract-andpremium-music.ts <出力JSONのパス>
 */
import { writeFileSync } from 'fs'
import { google } from 'googleapis'

const SHEET_ID = '1zcH3gKu2oX8qgme3Nf6sjRL-jvlEkBMWgvaoZ1cBxtI'

export type AndPremiumPick = {
  corner: 'music' | 'jazz'
  artist_name: string
  track_title: string
  curator: string
  /** 選曲日。「2015/11/22」は日まで、「2016/08」は月まで(日は1日で補う) */
  picked_date: string
  date_precision: 'day' | 'month'
  weekday_slot: string | null // 土曜の朝 / 日曜の夜 / 土曜の夜 / 日曜の朝
  is_domestic: boolean | null
}

function clean(s: unknown): string {
  return String(s ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim()
}

function parseDate(label: string): { date: string; precision: 'day' | 'month' } | null {
  const m = label.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/)
  if (!m) return null
  const mm = m[2].padStart(2, '0')
  return m[3] ? { date: `${m[1]}-${mm}-${m[3].padStart(2, '0')}`, precision: 'day' } : { date: `${m[1]}-${mm}-01`, precision: 'month' }
}

async function main() {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/extract-andpremium-music.ts <出力JSONのパス>')
    process.exit(1)
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "'&Music'!A3:AA1300" })).data.values ?? []

  const picks: AndPremiumPick[] = []
  const bad: string[] = []
  const add = (corner: 'music' | 'jazz', r: unknown[], at: number, rowNo: number) => {
    const artist = clean(r[at])
    const title = clean(r[at + 1])
    if (!artist && !title) return
    const d = parseDate(clean(r[at + 3]))
    if (!artist || !title || !d) {
      bad.push(`行${rowNo}: ${corner} ${artist} / ${title} / ${clean(r[at + 3])}`)
      return
    }
    const oy = clean(r[at + 5])
    picks.push({
      corner, artist_name: artist, track_title: title, curator: clean(r[at + 2]),
      picked_date: d.date, date_precision: d.precision, weekday_slot: clean(r[at + 4]) || null,
      is_domestic: oy === 'DOMESTIC' ? true : oy === 'OVERSEAS' ? false : null,
    })
  }
  rows.forEach((r, i) => {
    add('music', r, 1, i + 3)
    add('jazz', r, 7, i + 3)
  })
  writeFileSync(out, JSON.stringify(picks, null, 1))
  const n = (c: string) => picks.filter((p) => p.corner === c).length
  console.log(`土曜の朝と日曜の夜の音楽 ${n('music')}曲 / 土曜の夜と日曜の朝のジャズ ${n('jazz')}曲 / 読めなかった行 ${bad.length}`)
  for (const b of bad.slice(0, 10)) console.log('  ' + b)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
