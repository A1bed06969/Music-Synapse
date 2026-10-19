// scripts/extract-future-of-music.ts
/**
 * Rolling Stone Japan「Future of Music」日本代表(各年25組)の一覧を、import-future-of-music.ts が読むCSV
 * (年度,アーティスト名)に書き出す。
 *  - 2025・2026年: 個人収集スプレッドシートのタブ「Future of Music2025」「Future of Music2026」
 *  - 2024年(日本版の第1回): 発表記事 https://rollingstonejapan.com/articles/detail/40719 (3ページ構成)の25組。
 *    記事のHTMLで表記を確認して手入力した(日本版は2024年開始で、それ以前の開催は無い)
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/extract-future-of-music.ts <出力CSVのパス>
 */
import { google } from 'googleapis'
import { writeFileSync } from 'fs'

const SHEET_ID = '1zcH3gKu2oX8qgme3Nf6sjRL-jvlEkBMWgvaoZ1cBxtI'

const FUTURE_2024 = [
  'MAZZEL', 'ME:I', '明日の叙景', '紫 今', '花冷え。',
  'Ave Mujica', 'HALLEY', '大森日向子', '星熊南巫', 'jo0ji', 'Khaki', 'ミームトーキョー', 'MONJOE', 'NENE', '乃紫',
  'ぺろぺろきゃんでー', 'REJAY', 'SATOH', 'Skaai', 'TAMTAM', 'VivaOla', 'VMO', 'Xansei', '由薫', '長瀬有花',
]

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

async function main() {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/extract-future-of-music.ts <出力CSVのパス>')
    process.exit(1)
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })

  const rows: { year: number; name: string }[] = FUTURE_2024.map((name) => ({ year: 2024, name }))
  for (const year of [2025, 2026]) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Future of Music${year}'` })
    // 1列目にアーティスト名が縦に並ぶ(2025は先頭に見出し「Future of Music」と空行がある)
    for (const row of res.data.values ?? []) {
      const name = String(row[0] ?? '').replace(/\r/g, '').trim()
      if (!name || name === 'Future of Music') continue
      rows.push({ year, name })
    }
  }

  writeFileSync(out, ['年度,アーティスト名', ...rows.map((r) => `${r.year},${csvField(r.name)}`)].join('\n') + '\n')
  const by = new Map<number, number>()
  for (const r of rows) by.set(r.year, (by.get(r.year) ?? 0) + 1)
  console.log(`${rows.length}件 → ${out}`)
  for (const [y, n] of by) console.log(`  ${y}: ${n}組`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
