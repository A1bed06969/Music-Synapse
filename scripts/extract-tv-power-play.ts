// scripts/extract-tv-power-play.ts
/**
 * 個人収集スプレッドシートから、TV3局(スペースシャワーTV / MTV / MUSIC ON! TV)の
 * パワープレイを抽出し、import-hrpp-radio-picks.ts が読む形式のJSONに書き出す。
 *  - 「HR/PP」シートの右側(列239〜253)に月ごとのブロックがある
 *    (スペースシャワーTV=POWER PUSH/Waves!/IT、MTV=Buzz Clip、MUSIC ON! TV=Recommend)
 *  - 「スペシャ」シートにはスペースシャワーTVのPOWER PUSHが1993/07から1行1曲で並ぶ
 * 両方に載っている月のPOWER PUSHは (月, アーティスト, 曲) で重複を除く。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/extract-tv-power-play.ts <出力JSONのパス>
 */
import { google } from 'googleapis'
import { writeFileSync } from 'fs'

const SHEET_ID = '1zcH3gKu2oX8qgme3Nf6sjRL-jvlEkBMWgvaoZ1cBxtI'

type Pick = {
  region: string
  station_name: string
  campaign_name: string | null
  picked_date: string
  artist_name: string | null
  track_title: string | null
  is_domestic: boolean | null
}

// HR/PP シートの TV 列(0始まり)。各企画は [アーティスト, 曲, 邦洋] の3列
const HRPP_GROUPS = [
  { station: 'スペースシャワーTV', campaign: 'POWER PUSH', col: 238 },
  { station: 'スペースシャワーTV', campaign: 'Waves!', col: 241 },
  { station: 'スペースシャワーTV', campaign: 'IT', col: 244 },
  { station: 'MTV', campaign: 'Buzz Clip', col: 247 },
  { station: 'MUSIC ON! TV', campaign: 'Recommend', col: 250 },
]

function domestic(v: unknown): boolean | null {
  const s = String(v ?? '').trim().toUpperCase()
  if (s === 'DOMESTIC') return true
  if (s === 'OVERSEAS') return false
  return null
}

function monthDate(label: string): string | null {
  const m = label.trim().match(/^(\d{4})\/(\d{1,2})$/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-01` : null
}

async function main() {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/extract-tv-power-play.ts <出力JSONのパス>')
    process.exit(1)
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const get = async (range: string) =>
    (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range })).data.values ?? []

  const picks: Pick[] = []
  const seen = new Set<string>()
  const add = (p: Pick) => {
    if (!p.artist_name && !p.track_title) return
    const key = [p.station_name, p.campaign_name, p.picked_date.slice(0, 7), p.artist_name, p.track_title].join('\t')
    if (seen.has(key)) return
    seen.add(key)
    picks.push(p)
  }

  // --- HR/PP シート: 列Aの「2026/9」のような月ラベルから次のラベルまでが1か月ぶん ---
  const hrpp = await get("'HR/PP'")
  let current: string | null = null
  for (const row of hrpp) {
    const label = monthDate(String(row[0] ?? ''))
    if (label) current = label
    if (!current) continue
    for (const g of HRPP_GROUPS) {
      const artist = String(row[g.col] ?? '').trim()
      const title = String(row[g.col + 1] ?? '').trim()
      if (!artist && !title) continue
      add({
        region: 'TV',
        station_name: g.station,
        campaign_name: g.campaign,
        picked_date: current,
        artist_name: artist || null,
        track_title: title || null,
        is_domestic: domestic(row[g.col + 2]),
      })
    }
  }
  const fromHrpp = picks.length

  // --- スペシャ シート: [_, 選曲(年/月), 邦洋, アーティスト, 曲, タグ] ---
  const spesha = await get("'スペシャ'")
  for (const row of spesha.slice(1)) {
    const date = monthDate(String(row[1] ?? ''))
    if (!date) continue
    add({
      region: 'TV',
      station_name: 'スペースシャワーTV',
      campaign_name: 'POWER PUSH',
      picked_date: date,
      artist_name: String(row[3] ?? '').trim() || null,
      track_title: String(row[4] ?? '').trim() || null,
      is_domestic: domestic(row[2]),
    })
  }

  writeFileSync(out, JSON.stringify(picks, null, 2))
  const by = new Map<string, number>()
  for (const p of picks) by.set(`${p.station_name} / ${p.campaign_name}`, (by.get(`${p.station_name} / ${p.campaign_name}`) ?? 0) + 1)
  console.log(`HR/PP ${fromHrpp}件 + スペシャ(重複除く) ${picks.length - fromHrpp}件 = ${picks.length}件`)
  for (const [k, n] of by) console.log(`  ${k}: ${n}`)
  const months = picks.map((p) => p.picked_date.slice(0, 7)).sort()
  console.log(`期間: ${months[0]} 〜 ${months[months.length - 1]}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
