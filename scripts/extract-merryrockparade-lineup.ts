// scripts/extract-merryrockparade-lineup.ts
/**
 * MERRY ROCK PARADE 公式サイト(http://www.merryrockparade.jp/artist.html)の出演者ページから、
 * 日ごと・ステージごとの出演者を取り出して、register-festival-lineup.ts が読むJSONに書き出す。
 * ページは静的なHTMLで、日ごとの <div class="tabBox" id="dayN">、ステージ名の <h3>、
 * 出演者の <li><a><b>名前</b></a></li> に並んでいるので、LLMは使わず正規表現で確実に取り出す。
 * 「and more!」「後日発表」などの未発表分は出演者として入れない(発表されたら再実行する)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/extract-merryrockparade-lineup.ts <出力JSONのパス> [--year=2026]
 */
import { writeFileSync } from 'fs'

type Pick = { name: string; stage: string | null; startTime: string }

// 開催日(MERRY ROCK PARADE 2026: 12/19(土)・12/20(日)、START 11:00)
const DAYS: Record<string, string> = { day1: '2026-12-19T11:00:00+09:00', day2: '2026-12-20T11:00:00+09:00' }

function decode(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

async function main() {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/extract-merryrockparade-lineup.ts <出力JSONのパス>')
    process.exit(1)
  }
  const res = await fetch('http://www.merryrockparade.jp/artist.html', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  const picks: Pick[] = []
  const boxes = html.match(/<div class="tabBox" id="day\d+">[\s\S]*?<\/div><!--\/tabBox-->/g) ?? []
  for (const box of boxes) {
    const dayKey = box.match(/id="(day\d+)"/)?.[1] ?? ''
    const startTime = DAYS[dayKey]
    if (!startTime) continue
    // <h3>ステージ名</h3> のあとに <ul class="artist"> が続く(ステージが複数あっても順に対応づける)
    const sections = box.split(/<h3>/).slice(1)
    for (const sec of sections) {
      const stage = decode(sec.split('</h3>')[0]) || null
      for (const li of sec.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? []) {
        const name = decode(li.match(/<b>([\s\S]*?)<\/b>/)?.[1] ?? '')
        if (name) picks.push({ name, stage, startTime })
      }
    }
  }
  writeFileSync(out, JSON.stringify(picks, null, 2))
  const byDay = new Map<string, number>()
  for (const p of picks) byDay.set(p.startTime.slice(0, 10), (byDay.get(p.startTime.slice(0, 10)) ?? 0) + 1)
  console.log(`出演者 ${picks.length}件 → ${out}`)
  for (const [d, n] of byDay) console.log(`  ${d}: ${n}組`)
  console.log(picks.map((p) => p.name).join(' / '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
