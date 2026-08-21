// __tests__/wikipedia-genre.unit.test.ts
//
// Wikipediaの{{Infobox music genre}}wikitext解析ロジックのユニットテスト。
// 実際にen.wikipedia.org/Techno、ja.wikipedia.org/シティ・ポップから取得した
// 生wikitextを元にした固定データで検証する(ネットワーク不要)。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseGenreInfobox } from '../utils/wikipediaGenre.ts'

const TECHNO_WIKITEXT = `{{Infobox music genre <!-- See Wikipedia:WikiProject Music genres -->
| name              = Techno
| stylistic_origins = {{hlist|[[House music|House]]|[[Electro (music)|electro]]|[[synth-pop]]}}
| cultural_origins  = Mid-1980s, [[Detroit]], [[Michigan]], U.S.
| derivatives       = {{hlist|[[Alternative dance]]|[[trance music|trance]]}}
| subgenres         = {{hlist|[[Acid techno]]|[[Detroit techno]]|[[Minimal techno]]}}
}}
Techno is a genre of electronic dance music...`

const CITY_POP_WIKITEXT = `{{Infobox music genre
|name= シティ・ポップ
|image= File:A walk around Brickell Key-jikatu.jpg
|color=black
|bgcolor=#87CEEB
|stylistic_origins = {{Hlist-comma|[[ニューミュージック]]|[[AOR]]|[[湘南サウンド]]}}
|cultural_origins = {{Plainlist|
* [[1970年代]]
* {{JPN}}
}}
|instruments =
|derivatives = {{Hlist-comma|[[渋谷系]]|[[ヴェイパーウェイヴ]]}}
|subgenrelist =
|subgenres =
|fusiongenres =
|regional_scenes = [[ポップ・クレアティフ]]
|other_topics = {{仮リンク|ヨット・ロック|en|Yacht rock}}、[[J-POP]]
}}
シティ・ポップは1970年代の日本で生まれた音楽ジャンル...`

// ja.wikipedia.org/ジャズのcultural_originsから採取した実データ。西暦4桁が
// 無く「19世紀」という世紀表記+諸説ある旨の注記のみのケース。
const JAZZ_WIKITEXT = `{{Infobox music genre
|name= ジャズ
|stylistic_origins = {{Hlist-comma|[[ブルース]]|[[ラグタイム]]}}
|cultural_origins = [[19世紀]]、アメリカ南部（諸説あり）
|derivatives =
|subgenres =
}}
ジャズは...`

describe('parseGenreInfobox', () => {
  test('parses English infobox (Techno): year from free text, place from wikilinks, link lists', () => {
    const info = parseGenreInfobox(TECHNO_WIKITEXT, 'https://en.wikipedia.org/wiki/Techno')
    assert.ok(info)
    assert.equal(info!.originYear, 1980)
    assert.equal(info!.originYearLabel, null)
    assert.equal(info!.originPlace, 'Detroit, Michigan')
    assert.deepEqual(info!.stylisticOrigins, ['House', 'electro', 'synth-pop'])
    assert.deepEqual(info!.subgenres, ['Acid techno', 'Detroit techno', 'Minimal techno'])
    assert.deepEqual(info!.derivatives, ['Alternative dance', 'trance'])
    assert.equal(info!.sourceUrl, 'https://en.wikipedia.org/wiki/Techno')
  })

  test('parses Japanese infobox (シティ・ポップ): Plainlist cultural_origins with a country template', () => {
    const info = parseGenreInfobox(CITY_POP_WIKITEXT, 'https://ja.wikipedia.org/wiki/シティ・ポップ')
    assert.ok(info)
    assert.equal(info!.originYear, 1970)
    assert.equal(info!.originYearLabel, null)
    assert.equal(info!.originPlace, '日本')
    assert.deepEqual(info!.stylisticOrigins, ['ニューミュージック', 'AOR', '湘南サウンド'])
    assert.deepEqual(info!.derivatives, ['渋谷系', 'ヴェイパーウェイヴ'])
    assert.deepEqual(info!.subgenres, [])
  })

  test('parses a century-only cultural_origins (ジャズ: 諸説あり, no 4-digit year) into an approximate year plus the original label', () => {
    const info = parseGenreInfobox(JAZZ_WIKITEXT, 'https://ja.wikipedia.org/wiki/ジャズ')
    assert.ok(info)
    assert.equal(info!.originYear, 1850)
    assert.equal(info!.originYearLabel, '19世紀')
    assert.equal(info!.originPlace, 'アメリカ南部（諸説あり）')
  })

  test('century qualifiers (前半/後半/半ば/末/初頭) shift the approximate year within the century', () => {
    const wikitext = (cultural: string) =>
      `{{Infobox music genre\n|cultural_origins = ${cultural}\n}}\ntext`
    assert.equal(parseGenreInfobox(wikitext('19世紀初頭'), 'u')!.originYear, 1810)
    assert.equal(parseGenreInfobox(wikitext('19世紀前半'), 'u')!.originYear, 1825)
    assert.equal(parseGenreInfobox(wikitext('19世紀半ば'), 'u')!.originYear, 1850)
    assert.equal(parseGenreInfobox(wikitext('19世紀後半'), 'u')!.originYear, 1875)
    assert.equal(parseGenreInfobox(wikitext('19世紀末'), 'u')!.originYear, 1890)
    assert.equal(parseGenreInfobox(wikitext('19世紀後半'), 'u')!.originYearLabel, '19世紀後半')
  })

  test('English century notation (mid-20th century) is also recognized', () => {
    const wikitext = `{{Infobox music genre\n|cultural_origins = mid-20th century, [[United States]]\n}}\ntext`
    const info = parseGenreInfobox(wikitext, 'u')
    assert.ok(info)
    assert.equal(info!.originYear, 1950)
    assert.equal(info!.originYearLabel, 'mid-20th century')
  })

  test('returns null when no Infobox music genre template is present', () => {
    const info = parseGenreInfobox('Just some article text with no infobox at all.', 'https://en.wikipedia.org/wiki/Nothing')
    assert.equal(info, null)
  })
})
