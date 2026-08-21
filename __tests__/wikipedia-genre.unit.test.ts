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

describe('parseGenreInfobox', () => {
  test('parses English infobox (Techno): year from free text, place from wikilinks, link lists', () => {
    const info = parseGenreInfobox(TECHNO_WIKITEXT, 'https://en.wikipedia.org/wiki/Techno')
    assert.ok(info)
    assert.equal(info!.originYear, 1980)
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
    assert.equal(info!.originPlace, '日本')
    assert.deepEqual(info!.stylisticOrigins, ['ニューミュージック', 'AOR', '湘南サウンド'])
    assert.deepEqual(info!.derivatives, ['渋谷系', 'ヴェイパーウェイヴ'])
    assert.deepEqual(info!.subgenres, [])
  })

  test('returns null when no Infobox music genre template is present', () => {
    const info = parseGenreInfobox('Just some article text with no infobox at all.', 'https://en.wikipedia.org/wiki/Nothing')
    assert.equal(info, null)
  })
})
