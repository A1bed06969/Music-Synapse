// scripts/extract-future-of-music-us.ts
/**
 * Rolling Stone US「Future of Music」の「Future 25」(2023〜2026年、各25組)を、import-future-of-music.ts
 * (--edition=us)が読むCSV(年度,アーティスト名)に書き出す。スクレイピングではなく、確認済みの一覧を持つ。
 *
 * 出典と確認方法(2026-10-20):
 *  - 2023: 公式の一覧ページ「Meet Music's Future 25」
 *    https://www.rollingstone.com/music/music-lists/best-new-rising-artists-2023-1234745765/ (見出し25件)
 *  - 2024: 紹介記事の末尾タグに「Future 25」と「Future of Music 2024」が付く25組
 *    (Peso Pluma が表紙。ショーケース出演だけのFaye Webster・Flo Milliや別特集のxaviersobasedは含まない)
 *  - 2025: 米国版の25組。Mega Hits / AgitoPOP の転載リストと、Rolling Stoneの紹介記事の見出しが一致
 *  - 2026: https://www.rollingstone.com/p/future-of-music-2026/ のハブページの24件 + BigXthaPlugの
 *    Texas rap supergroup「600 Entertainment」(紹介記事に Future 25 タグ)で25組
 *
 * 実行方法:
 *   npx tsx scripts/extract-future-of-music-us.ts <出力CSVのパス>
 */
import { writeFileSync } from 'fs'

const LISTS: Record<number, string[]> = {
  2023: [
    'GloRilla', 'NewJeans', 'Villano Antillano', 'Model/Actriz', 'Asake', 'Young Miko', 'Otoboke Beaver', 'Sudan Archives', 'FLO',
    'Brittney Spencer', 'Doechii', 'Omar Courtz', 'Babyface Ray', 'Elyanna', 'Peso Pluma', 'Tsumyoki', 'Teezo Touchdown', 'Soul Glo',
    'Destroy Lonely', 'Baby Rose', 'Annie Blackman', 'McKinley Dixon', 'Water From Your Eyes', 'Black Belt Eagle Scout', 'Balming Tiger',
  ],
  2024: [
    'Peso Pluma', 'Le Sserafim', 'Samia', 'Ryan Castro', 'Young Nudy', 'Scowl', 'The Last Dinner Party', 'MC Abdul', 'J Noa',
    'Chappell Roan', 'Lola Brooke', 'Veeze', 'Black Sherif', 'Lizzie No', 'Omah Lay', 'Saiko', 'Peggy Gou', 'Wyatt Flores',
    'Yovngchimi', 'John Summit', 'Masicka', 'Mirror', 'Jasiel Nuñez', 'Teezo Touchdown', 'Young Miko',
  ],
  2025: [
    'Anycia', 'Benson Boone', 'CA7RIEL & Paco Amoroso', 'Chuwi', 'Fcukers', 'Girlpuppy', 'Gyrofield', 'Hanumankind', 'Ivan Cornejo',
    'Jasmine.4.t', 'Jim Legxacy', 'KiiiKiii', 'Laila!', 'Lola Young', 'Medium Build', 'Megan Moroney', 'Nemahsis', 'Nsqk',
    'Odumodublvck', 'Rachel Chinouriri', 'Rema', 'Samara Cyn', 'Stephen Wilson Jr.', 'TUL8TE', 'Wunderhorse',
  ],
  2026: [
    'Fuerza Regida', 'Oklou', 'xaviersobased', 'Nabeel', 'Ink', 'Gigi Perez', 'Lola Young', 'Asher White', 'Wallie the Sensei',
    'Tyler Ballgame', 'TWS', 'Die Spitz', 'BigXthaPlug', 'Bunt.', 'WordsofAzia', '2hollis', 'Audrey Hobert', 'Ravyn Lenae',
    'Dexter in the Newsagent', 'Linea Personal', 'Clave Especial', 'Haylie Davis', 'Chino Pacas', 'Saint Harison', '600 Entertainment',
  ],
}

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

const out = process.argv[2]
if (!out) {
  console.error('使い方: npx tsx scripts/extract-future-of-music-us.ts <出力CSVのパス>')
  process.exit(1)
}
const lines = ['年度,アーティスト名']
for (const [year, names] of Object.entries(LISTS)) {
  if (names.length !== 25 || new Set(names).size !== 25) throw new Error(`${year}年が25組ではありません(${names.length}組)`)
  for (const n of names) lines.push(`${year},${csvField(n)}`)
}
writeFileSync(out, lines.join('\n') + '\n')
console.log(`${lines.length - 1}件(4年 × 25組) → ${out}`)
