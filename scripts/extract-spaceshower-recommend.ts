// scripts/extract-spaceshower-recommend.ts
/**
 * スペースシャワーTV「レコメンドアーティスト」(https://tv.spaceshower.jp/recommend/)の
 * 各番組のバックナンバー表(タイトル・アーティスト・期間)から選曲を抽出し、
 * import-hrpp-radio-picks.ts が読む形式のJSONに書き出す。
 * 対象: POWER PUSH! / POWER PUSH INTERNATIONAL / Waves! / It!
 * (VIP / VIP INTERNATIONAL は対象外)
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/extract-spaceshower-recommend.ts <出力JSONのパス>
 */
import { writeFileSync } from 'fs'

type Pick = {
  region: string
  station_name: string
  campaign_name: string | null
  picked_date: string
  artist_name: string | null
  track_title: string | null
  is_domestic: boolean | null
}

const PROGRAMS = [
  { path: 'powerpush', campaign: 'POWER PUSH', domestic: true },
  { path: 'powerpushintl', campaign: 'POWER PUSH INTERNATIONAL', domestic: false },
  { path: 'waves', campaign: 'Waves!', domestic: null },
  { path: 'it', campaign: 'IT', domestic: null },
] as const

function decode(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

async function main() {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/extract-spaceshower-recommend.ts <出力JSONのパス>')
    process.exit(1)
  }

  const picks: Pick[] = []
  for (const program of PROGRAMS) {
    const base = `https://tv.spaceshower.jp/recommend/${program.path}/`
    const first = await fetchHtml(base)
    // バックナンバーは10件ずつ index_2.html, index_3.html ... に分かれている。
    // ページ送りの番号は先頭の数ページ分しか出ないので、行が無くなるページまで順に辿る
    const pages = [first]
    for (let n = 2; n <= 200; n++) {
      await new Promise((r) => setTimeout(r, 800))
      let page: string
      try {
        page = await fetchHtml(`${base}index_${n}.html`)
      } catch {
        break
      }
      if (!/<tr class="p-recommendTable__row">[\s\S]*?<td class="p-recommendTable__item">/.test(page)) break
      pages.push(page)
    }
    const html = pages.join('\n')
    // 行ごとに [タイトル, アーティスト, 期間] の3セルが並ぶ
    const rows = html.match(/<tr class="p-recommendTable__row">[\s\S]*?<\/tr>/g) ?? []
    let count = 0
    for (const row of rows) {
      const cells = (row.match(/<td class="p-recommendTable__item">[\s\S]*?<\/td>/g) ?? []).map((c) =>
        decode(c.replace(/<span class="p-recommendTable__itemCat">[\s\S]*?<\/span>/, ''))
      )
      if (cells.length < 3) continue
      const [title, artist, period] = cells
      // 月単位は「2026/10」、週単位(Waves! / It!)は「2026/10/19(月)～10/25(日)」。週は開始日をそのまま使う
      const m = period.match(/(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?/)
      if (!m) continue
      picks.push({
        region: 'TV',
        station_name: 'スペースシャワーTV',
        campaign_name: program.campaign,
        picked_date: `${m[1]}-${m[2].padStart(2, '0')}-${(m[3] ?? '1').padStart(2, '0')}`,
        artist_name: artist || null,
        track_title: title || null,
        is_domestic: program.domestic,
      })
      count++
    }
    const dates = picks.filter((p) => p.campaign_name === program.campaign).map((p) => p.picked_date).sort()
    console.log(`${program.campaign}: ${count}件(${dates[0]} 〜 ${dates[dates.length - 1]})`)
  }
  writeFileSync(out, JSON.stringify(picks, null, 2))
  console.log(`合計 ${picks.length}件 → ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
