/**
 * ROCK GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk-genre-history.tsと
 * 同じ方針: app/genres/[id]/は完全に汎用実装なので新規UIコードは書かず、genre /
 * genre_lineage / genre_highlight にrockの系譜データを投入するだけで
 * /genres/{rockのid} がそのままROCK HISTORYページとして機能する。
 *
 * Rock固有の追加要素:
 *  - Cross-Genre Connection: genre_lineageは元々多親を許容する設計なので、
 *    新しいスキーマは不要。例えば blues rock は「シカゴ・ブルース→blues rock」
 *    (blues側、既存)に加えて「British Rock→blues rock」(rock側、今回追加)の
 *    2つの親を持つ。relation_type='crossover'で「他ジャンルとの融合」を示す。
 *  - 「はっぴいえんど」は仕様書のASCII図ではノードのように描かれているが実際は
 *    バンド名なので、ジャンルノードにはせず日本語ロックのCORE代表アーティストとして
 *    (「重要な転換点」という注記付きで)登録する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-rock-genre-history.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, searchAlbums, fetchTracksForAlbum, millisToSeconds } from '@/utils/itunes'
import { upsertArtistFromItunes, fillMissingArtistImage } from '@/app/admin/import/actions'
import { classifyAlbumType } from '@/utils/albumType'

type RelationType = 'derivation' | 'influence' | 'crossover'
type Classification = 'core' | 'influence' | 'approach'

type GenreDef = {
  name: string
  originYear: number | null
  originYearLabel: string | null
  originCountry: string | null
  backgroundNote: string | null
  // 複数親(Cross-Genre Connection)を許容するため配列にする
  parents?: { name: string; relationType: RelationType }[]
}

type HighlightDef = {
  genreName: string
  artistName: string
  workTitle?: string
  note?: string
  eventYear?: number
  classification?: Classification
}

function parent(name: string, relationType: RelationType = 'derivation') {
  return { name, relationType }
}

// ─── ジャンル階層(親を先に処理する順序で並べる) ───────────────────────────

const GENRES: GenreDef[] = [
  {
    name: "rock'n'roll",
    originYear: 1951,
    originYearLabel: '1950s前半〜中盤',
    originCountry: 'アメリカ南部',
    backgroundNote:
      '誕生期・ロックンロール。ブルース、R&B、カントリー、ゴスペルなどの音楽が融合し、1950年代に若者向けの強いビートを持つロックンロールが誕生。ラジオ、テレビ、レコードを通じて全米の若者文化へ急速に拡大し、戦後の若者文化を象徴する存在となる。日本でも1950年代後半からロカビリー・ブームが起こり、ロックンロールが日本へ伝播した。',
    parents: [parent('Rock'), parent('blues', 'crossover'), parent('r&b', 'crossover')],
  },
  {
    name: 'rockabilly',
    originYear: 1953,
    originYearLabel: '1950s前半〜中盤',
    originCountry: 'アメリカ南部',
    backgroundNote: "Rock'n'Rollとカントリーが融合したスタイル。",
    parents: [parent("rock'n'roll")],
  },
  {
    name: '日本のロカビリー',
    originYear: 1957,
    originYearLabel: '1950s前半〜中盤',
    originCountry: '日本',
    backgroundNote: '1950年代後半に日本で起こったロカビリー旋風。平尾昌晃、山下敬二郎、ミッキー・カーチスらが牽引した。',
    parents: [parent('rockabilly')],
  },
  {
    name: 'Beat Music',
    originYear: 1962,
    originYearLabel: '1960年代前半',
    originCountry: 'イギリス',
    backgroundNote:
      'ブリティッシュ・インヴェイジョン。イギリスの若いバンドがアメリカのロックンロールやR&Bを吸収し、独自のバンド・サウンドへ発展(Merseybeat / British R&B)。The Beatlesを中心としたBritish Invasionによって、イギリスのロックがアメリカへ逆輸入される。バンド形式と自作自演が世界的に普及し、ロックの創作主体が「スター歌手」から「バンド」へ移行した。',
    parents: [parent("rock'n'roll")],
  },
  {
    name: 'British Rock',
    originYear: 1963,
    originYearLabel: '1960年代前半',
    originCountry: 'イギリス',
    backgroundNote: 'Beat Musicがイギリス独自のロック・サウンドへ発展したもの。以降のロックの多くの分岐がここから始まる。',
    parents: [parent('Beat Music')],
  },
  {
    name: 'グループ・サウンズ',
    originYear: 1966,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: '日本',
    backgroundNote: 'British Invasionに影響を受けた日本のバンド・ブーム。',
    parents: [parent('British Rock', 'crossover'), parent('日本のロカビリー')],
  },
  {
    name: 'psychedelic rock',
    originYear: 1966,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: 'イギリス / アメリカ',
    backgroundNote:
      'カウンターカルチャーとロックの巨大化。ベトナム反戦運動、公民権運動、カウンターカルチャーなどの社会背景とロックが結びつく。エレクトリック楽器とアンプ技術の発展により、より大音量で重厚なサウンドが生まれた。',
    parents: [parent('British Rock')],
  },
  {
    name: 'progressive rock',
    originYear: 1967,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: 'イギリス',
    backgroundNote: '長尺曲や複雑な構成、スタジオ技術を追求したスタイル。',
    parents: [parent('British Rock')],
  },
  {
    name: 'ニューロック',
    originYear: 1969,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: '日本',
    backgroundNote: 'グループ・サウンズから発展した、より自由な表現を志向する日本のロック。',
    parents: [parent('グループ・サウンズ')],
  },
  {
    name: '日本語ロック',
    originYear: 1971,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: '日本',
    backgroundNote: 'ニューロックから発展した、日本語の歌詞でロックを表現する潮流。「はっぴいえんど」が日本語によるロック表現の重要な転換点となった。',
    parents: [parent('ニューロック')],
  },
  {
    name: 'punk rock',
    originYear: 1975,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'イギリス / アメリカ',
    backgroundNote:
      'パンク・ロックの衝撃と多様化。巨大化・商業化したロックへの反発から、シンプルな3コード、短い楽曲、DIY精神によるPunk Rockが登場。Punkを起点として、Post-Punk、New Wave、Alternative Rockなど新たな音楽が次々に派生した。',
    parents: [parent('Rock')],
  },
  {
    name: 'post-punk',
    originYear: 1978,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'イギリス',
    backgroundNote: 'Punkのシンプルさを引き継ぎつつ、より実験的な音響表現を追求したスタイル。',
    parents: [parent('punk rock')],
  },
  {
    name: 'new wave',
    originYear: 1979,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'イギリス',
    backgroundNote: 'Post-Punkからさらにポップで電子的な方向へ発展したスタイル。',
    parents: [parent('post-punk')],
  },
  {
    name: 'hardcore punk',
    originYear: 1980,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'アメリカ',
    backgroundNote: 'Punk Rockをさらに過激化・高速化したスタイル。',
    parents: [parent('punk rock')],
  },
  {
    name: 'stadium rock',
    originYear: 1977,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'アメリカ',
    backgroundNote: '大規模会場での興行を前提とした、壮大でエンターテインメント性の高いハード・ロック。',
    parents: [parent('hard rock')],
  },
  {
    name: 'alternative rock',
    originYear: 1979,
    originYearLabel: '1970s後半〜1980s',
    originCountry: 'アメリカ',
    backgroundNote: 'Punk以降のアンダーグラウンドから生まれた、メインストリームとは異なる価値観のロック。1990年代に大きく開花する。',
    parents: [parent('punk rock')],
  },
  {
    name: '日本のパンク/New Wave',
    originYear: 1978,
    originYearLabel: '1970s後半〜1980s',
    originCountry: '日本',
    backgroundNote: '1970年代後半から、パンク／ニュー・ウェイブ／ロックが日本のインディーズ文化と結びつき発展したシーン。',
    parents: [parent('日本語ロック'), parent('punk rock', 'crossover')],
  },
  {
    name: 'grunge',
    originYear: 1991,
    originYearLabel: '1990s',
    originCountry: 'アメリカ(シアトル)',
    backgroundNote:
      'オルタナティブ・ロックとグランジ。1980年代の商業的なロックやヘヴィメタルへの反動として、アンダーグラウンドからAlternative Rockが台頭。シアトルを中心にGrungeが世界的ブームとなった。',
    parents: [parent('alternative rock')],
  },
  {
    name: 'britpop',
    originYear: 1994,
    originYearLabel: '1990s',
    originCountry: 'イギリス',
    backgroundNote: 'イギリスで台頭し、OasisやBlurなどが90年代のロック文化を代表する存在となった。',
    parents: [parent('alternative rock')],
  },
  {
    name: 'post-grunge',
    originYear: 1994,
    originYearLabel: '1990s',
    originCountry: 'アメリカ',
    backgroundNote: 'Grungeのサウンドをよりメインストリーム向けに洗練したスタイル。',
    parents: [parent('grunge')],
  },
  {
    name: 'indie rock',
    originYear: 1990,
    originYearLabel: '1990s',
    originCountry: 'アメリカ / イギリス',
    backgroundNote: 'メジャーレーベルに依存しない、独立した価値観で制作されるロック。',
    parents: [parent('alternative rock')],
  },
  {
    name: '日本のバンドブーム',
    originYear: 1989,
    originYearLabel: '1990s',
    originCountry: '日本',
    backgroundNote: '日本で起きたバンドブームを経て、その後のインディー・シーンの土台が形成された。',
    parents: [parent('日本のパンク/New Wave')],
  },
  {
    name: '下北沢インディー',
    originYear: 1994,
    originYearLabel: '1990s',
    originCountry: '日本',
    backgroundNote: '下北沢などを中心に形成された、日本のインディー／オルタナティブ・ロックのシーン。',
    parents: [parent('日本のバンドブーム'), parent('indie rock', 'crossover')],
  },
  {
    name: 'garage rock revival',
    originYear: 2001,
    originYearLabel: '2000s',
    originCountry: 'アメリカ / イギリス',
    backgroundNote:
      'ガレージ・ロック・リバイバルとインディー化。The Strokes、The White Stripes、The Hivesなどを中心に世界的に注目される。インターネットの普及によって、レコード会社だけに依存しない音楽流通が拡大した。',
    parents: [parent('indie rock')],
  },
  {
    name: 'post-punk revival',
    originYear: 2002,
    originYearLabel: '2000s',
    originCountry: 'イギリス / アメリカ',
    backgroundNote: 'Post-Punkのサウンドを2000年代に再解釈したスタイル。',
    parents: [parent('garage rock revival')],
  },
  {
    name: '現代日本のAlternative/Indie',
    originYear: 2001,
    originYearLabel: '2000s',
    originCountry: '日本',
    backgroundNote:
      '下北沢インディーの流れを継承しつつ、2010年代以降はロックの境界そのものが曖昧になる中で、日本独自のオルタナティブ／インディー・シーンが多様化を続けている。',
    parents: [parent('下北沢インディー')],
  },
  {
    name: 'art rock',
    originYear: 2011,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: '芸術性・実験性を重視したロック。',
    parents: [parent('progressive rock')],
  },
  {
    name: 'experimental rock',
    originYear: 2014,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'ボーダレス化・ロックの再定義。ストリーミングとSNSの普及により、ロックの流通構造が大きく変化。ヒップホップ、エレクトロニカ、R&B、ポップ、ジャズ、アンビエントなどとのジャンル融合が進み、「ロック」というジャンルの境界そのものが曖昧になっている。',
    parents: [parent('art rock')],
  },
  {
    name: 'noise rock',
    originYear: 2010,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: '実験的でノイジーなサウンドを追求するロック。',
    parents: [parent('experimental rock')],
  },
  {
    name: 'post-rock',
    originYear: 2012,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: 'ボーカルよりも音響そのものの構築を重視するロック。',
    parents: [parent('art rock')],
  },
  {
    name: 'math rock',
    originYear: 2013,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: '変拍子や複雑なリズム構成を特徴とするロック。',
    parents: [parent('post-rock')],
  },
]

// heavy metalは既存ジャンル(既にhard rockの子として登録済み)。ここでは
// Cross-Genre的な補強のみ行うため、GENRESとは別に軽量な追加リストとして扱う。
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'blues rock', parentName: 'British Rock', relationType: 'crossover' },
  { childName: 'folk rock', parentName: 'British Rock', relationType: 'crossover' },
  { childName: 'jazz rock', parentName: 'Rock', relationType: 'derivation' },
  { childName: 'jazz rock', parentName: 'jazz fusion', relationType: 'crossover' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: "rock'n'roll", artistName: 'Elvis Presley', workTitle: 'Hound Dog' },
  { genreName: "rock'n'roll", artistName: 'Chuck Berry', workTitle: 'Johnny B. Goode' },
  { genreName: "rock'n'roll", artistName: 'Little Richard', workTitle: 'Tutti Frutti' },
  { genreName: 'rockabilly', artistName: 'Buddy Holly', workTitle: "That'll Be the Day" },
  { genreName: 'rockabilly', artistName: 'Jerry Lee Lewis' },
  { genreName: '日本のロカビリー', artistName: '平尾昌晃' },
  { genreName: '日本のロカビリー', artistName: '山下敬二郎' },
  { genreName: '日本のロカビリー', artistName: 'ミッキー・カーチス' },

  // ERA02
  { genreName: 'Beat Music', artistName: 'The Beatles', workTitle: 'Please Please Me' },
  { genreName: 'British Rock', artistName: 'The Beatles', workTitle: "A Hard Day's Night" },
  { genreName: 'British Rock', artistName: 'The Rolling Stones', workTitle: "(I Can't Get No) Satisfaction" },
  { genreName: 'British Rock', artistName: 'The Kinks', workTitle: 'You Really Got Me' },
  { genreName: 'British Rock', artistName: 'The Who' },
  { genreName: 'British Rock', artistName: 'The Animals' },

  // ERA03
  { genreName: 'psychedelic rock', artistName: 'Jimi Hendrix', workTitle: 'Are You Experienced' },
  { genreName: 'psychedelic rock', artistName: 'The Doors' },
  { genreName: 'blues rock', artistName: 'Cream', workTitle: 'Disraeli Gears' },
  { genreName: 'hard rock', artistName: 'Led Zeppelin', workTitle: 'Led Zeppelin IV' },
  { genreName: 'progressive rock', artistName: 'Pink Floyd', workTitle: 'The Dark Side of the Moon' },
  { genreName: 'British Rock', artistName: 'The Beatles', workTitle: "Sgt. Pepper's Lonely Hearts Club Band" },
  { genreName: 'グループ・サウンズ', artistName: '内田裕也' },
  { genreName: 'ニューロック', artistName: 'フラワー・トラベリン・バンド' },
  {
    genreName: '日本語ロック',
    artistName: 'はっぴいえんど',
    note: '日本語によるロック表現の重要な転換点として位置づけられるバンド。',
  },

  // ERA04
  { genreName: 'punk rock', artistName: 'Sex Pistols', workTitle: 'Never Mind the Bollocks' },
  { genreName: 'punk rock', artistName: 'The Clash', workTitle: 'London Calling' },
  { genreName: 'punk rock', artistName: 'Ramones' },
  { genreName: 'new wave', artistName: 'Talking Heads' },
  { genreName: 'post-punk', artistName: 'Joy Division', workTitle: 'Unknown Pleasures' },
  { genreName: 'hard rock', artistName: 'AC/DC', workTitle: 'Back in Black' },
  { genreName: 'stadium rock', artistName: 'Van Halen' },
  { genreName: 'heavy metal', artistName: 'Iron Maiden' },
  { genreName: '日本のパンク/New Wave', artistName: 'RCサクセション' },
  { genreName: '日本のパンク/New Wave', artistName: 'BOØWY' },
  { genreName: '日本のパンク/New Wave', artistName: 'P-MODEL' },
  { genreName: '日本のパンク/New Wave', artistName: 'INU' },
  { genreName: '日本のパンク/New Wave', artistName: 'フリクション' },

  // ERA05
  { genreName: 'grunge', artistName: 'Nirvana', workTitle: 'Nevermind', eventYear: 1991 },
  { genreName: 'grunge', artistName: 'Pearl Jam', workTitle: 'Ten' },
  { genreName: 'grunge', artistName: 'Soundgarden' },
  { genreName: 'grunge', artistName: 'Alice in Chains' },
  { genreName: 'alternative rock', artistName: 'Radiohead', workTitle: 'OK Computer' },
  { genreName: 'britpop', artistName: 'Oasis', workTitle: "(What's the Story) Morning Glory?" },
  { genreName: 'britpop', artistName: 'Blur' },
  { genreName: 'britpop', artistName: 'Pulp' },
  { genreName: '下北沢インディー', artistName: 'BLANKEY JET CITY' },
  { genreName: '下北沢インディー', artistName: 'THEE MICHELLE GUN ELEPHANT' },
  { genreName: '下北沢インディー', artistName: 'THE ROOSTERS' },
  { genreName: '下北沢インディー', artistName: 'NUMBER GIRL' },

  // ERA06
  { genreName: 'garage rock revival', artistName: 'The Strokes', workTitle: 'Is This It', eventYear: 2001 },
  { genreName: 'garage rock revival', artistName: 'The White Stripes', workTitle: 'Elephant' },
  { genreName: 'garage rock revival', artistName: 'The Hives' },
  { genreName: 'garage rock revival', artistName: 'Arctic Monkeys', workTitle: "Whatever People Say I Am, That's What I'm Not" },
  { genreName: 'post-punk revival', artistName: 'Franz Ferdinand', workTitle: 'Franz Ferdinand' },
  { genreName: 'post-punk revival', artistName: 'Interpol' },
  { genreName: 'post-punk revival', artistName: 'Yeah Yeah Yeahs' },
  { genreName: '現代日本のAlternative/Indie', artistName: 'くるり' },
  { genreName: '現代日本のAlternative/Indie', artistName: 'ASIAN KUNG-FU GENERATION' },
  { genreName: '現代日本のAlternative/Indie', artistName: 'BUMP OF CHICKEN' },
  { genreName: '現代日本のAlternative/Indie', artistName: 'ストレイテナー' },

  // ERA07
  { genreName: 'art rock', artistName: 'Black Country, New Road' },
  { genreName: 'post-punk revival', artistName: 'Fontaines D.C.' },
  { genreName: 'experimental rock', artistName: 'King Gizzard & the Lizard Wizard' },
  { genreName: 'indie rock', artistName: 'Big Thief', classification: 'influence', note: 'Folk / Indie Rockを横断するアーティスト。' },
  { genreName: 'indie rock', artistName: 'Tame Impala', classification: 'influence', note: 'Psychedelic Popとの境界を横断する。' },
  { genreName: 'indie rock', artistName: 'The 1975', classification: 'approach', note: 'ロックのバンド・フォーマットを基盤に、Pop / R&B / Electronicaを横断する。' },
  { genreName: '現代日本のAlternative/Indie', artistName: 'DYGL' },
  {
    genreName: '現代日本のAlternative/Indie',
    artistName: '羊文学',
    classification: 'influence',
    note: '現代日本のオルタナティブ・ロックを代表するバンド。[JAPAN]',
  },
  {
    genreName: '現代日本のAlternative/Indie',
    artistName: 'King Gnu',
    classification: 'influence',
    note: 'ロックを重要な要素としつつ、Pop / R&B / Classicalを横断する。[JAPAN]',
  },
  {
    genreName: '現代日本のAlternative/Indie',
    artistName: 'Tempalay',
    classification: 'influence',
    note: 'ロックを基盤に、Psychedelic / Electronicaを横断する。[JAPAN]',
  },
  {
    genreName: '現代日本のAlternative/Indie',
    artistName: 'Chilli Beans.',
    classification: 'approach',
    note: 'バンド・フォーマットとDIY精神を部分的に継承する現代アーティスト。[JAPAN]',
  },
  {
    genreName: '現代日本のAlternative/Indie',
    artistName: 'サカナクション',
    classification: 'approach',
    note: 'ロックのバンド・フォーマットを基盤に、Electronicaと横断する。[JAPAN]',
  },
]

// ─── 実行本体 ───────────────────────────────────────────────────────────

async function findOrCreateGenre(supabase: SupabaseClient, def: GenreDef): Promise<string> {
  const { data: existing } = await supabase.from('genre').select('id').ilike('name', def.name).limit(1).maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('genre')
      .update({
        origin_year: def.originYear,
        origin_year_label: def.originYearLabel,
        origin_country: def.originCountry,
        background_note: def.backgroundNote,
      })
      .eq('id', existing.id)
    if (error) console.error(`ジャンル更新失敗(${def.name}):`, error.message)
    return existing.id
  }

  const { data: inserted, error } = await supabase
    .from('genre')
    .insert({
      name: def.name,
      origin_year: def.originYear,
      origin_year_label: def.originYearLabel,
      origin_country: def.originCountry,
      background_note: def.backgroundNote,
    })
    .select('id')
    .single()
  if (error || !inserted) throw new Error(`ジャンル作成失敗(${def.name}): ${error?.message}`)
  return inserted.id
}

async function upsertLineage(supabase: SupabaseClient, parentId: string, childId: string, relationType: RelationType) {
  const { error } = await supabase
    .from('genre_lineage')
    .upsert({ parent_genre_id: parentId, child_genre_id: childId, relation_type: relationType }, { onConflict: 'parent_genre_id,child_genre_id' })
  if (error) console.error(`lineage upsert失敗(${parentId}->${childId}):`, error.message)
}

async function findOrCreateArtist(supabase: SupabaseClient, name: string): Promise<string | null> {
  const { data: existing } = await supabase.from('artist').select('id').ilike('name', name).limit(1).maybeSingle()
  if (existing) return existing.id

  let candidates: Awaited<ReturnType<typeof searchArtist>> = []
  try {
    candidates = await searchArtist(name)
  } catch (err) {
    console.error(`iTunesアーティスト検索失敗(${name}):`, err)
  }

  const lower = name.toLowerCase()
  const best =
    candidates.find((c) => c.artistName.toLowerCase() === lower) ??
    candidates.find((c) => c.artistName.toLowerCase().includes(lower) || lower.includes(c.artistName.toLowerCase()))

  if (!best) {
    console.warn(`iTunesで一致するアーティストが見つからず、名前のみの手動スタブを作成します: ${name}`)
    const { data: inserted, error } = await supabase.from('artist').insert({ name }).select('id').single()
    if (error || !inserted) {
      console.error(`手動スタブ作成失敗(${name}):`, error?.message)
      return null
    }
    return inserted.id
  }

  const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, {
    wrapperType: 'artist',
    artistId: best.artistId,
    artistName: best.artistName,
    artistLinkUrl: best.artistLinkUrl,
  })
  if (errorMessage || !artistId) {
    console.error(`アーティスト作成失敗(${name}):`, errorMessage)
    return null
  }
  await fillMissingArtistImage(supabase, artistId, String(best.artistId))
  return artistId
}

async function findOrCreateAlbum(supabase: SupabaseClient, artistId: string, artistName: string, workTitle: string): Promise<string | null> {
  const { data: existing } = await supabase.from('album').select('id').eq('artist_id', artistId).ilike('title', `%${workTitle}%`).limit(1).maybeSingle()
  if (existing) return existing.id

  let results: Awaited<ReturnType<typeof searchAlbums>> = []
  try {
    results = await searchAlbums(`${artistName} ${workTitle}`, 10)
  } catch (err) {
    console.error(`iTunesアルバム検索失敗(${artistName} - ${workTitle}):`, err)
  }

  const lowerTitle = workTitle.toLowerCase()
  const best = results.find((r) => r.collectionName.toLowerCase().includes(lowerTitle)) ?? results[0]
  if (!best) {
    console.warn(`iTunesでアルバムが見つかりませんでした: ${artistName} - ${workTitle}`)
    return null
  }

  const { data: existingByAppleId } = await supabase.from('album').select('id').eq('apple_music_album_id', String(best.collectionId)).maybeSingle()
  if (existingByAppleId) return existingByAppleId.id

  const title = best.collectionName
  const { data: inserted, error } = await supabase
    .from('album')
    .insert({
      artist_id: artistId,
      title,
      release_date: best.releaseDate ? best.releaseDate.slice(0, 10) : null,
      track_count: best.trackCount ?? null,
      jacket_url: best.artworkUrl100 ? best.artworkUrl100.replace('100x100', '1200x1200') : null,
      apple_music_album_id: String(best.collectionId),
      apple_music_available: true,
      album_type: classifyAlbumType(title, best.trackCount ?? null),
      last_synced_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !inserted) {
    console.error(`アルバム作成失敗(${artistName} - ${workTitle}):`, error?.message)
    return null
  }
  const albumId: string = inserted.id

  try {
    const { tracks } = await fetchTracksForAlbum(best.collectionId)
    for (const t of tracks) {
      await supabase.from('track').insert({
        album_id: albumId,
        artist_id: artistId,
        track_no: t.trackNumber ?? null,
        disc_number: t.discNumber ?? null,
        title: t.trackName,
        duration_seconds: millisToSeconds(t.trackTimeMillis),
        apple_music_track_id: String(t.trackId),
        last_synced_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error(`トラック取得失敗(${title}):`, err)
  }

  return albumId
}

async function insertHighlight(supabase: SupabaseClient, h: HighlightDef, genreIdByName: Map<string, string>) {
  const genreId = genreIdByName.get(h.genreName.toLowerCase())
  if (!genreId) {
    console.error(`未知のジャンル名(highlight): ${h.genreName}`)
    return
  }

  const artistId = await findOrCreateArtist(supabase, h.artistName)
  let albumId: string | null = null
  if (h.workTitle && artistId) {
    albumId = await findOrCreateAlbum(supabase, artistId, h.artistName, h.workTitle)
  }
  if (!artistId && !albumId) {
    console.warn(`スキップ(アーティスト/アルバムどちらも解決できず): ${h.genreName} / ${h.artistName}`)
    return
  }

  let dupQuery = supabase.from('genre_highlight').select('id').eq('genre_id', genreId)
  dupQuery = artistId ? dupQuery.eq('artist_id', artistId) : dupQuery.is('artist_id', null)
  dupQuery = albumId ? dupQuery.eq('album_id', albumId) : dupQuery.is('album_id', null)
  const { data: dup } = await dupQuery.maybeSingle()
  if (dup) {
    console.log(`既存のためスキップ: ${h.genreName} / ${h.artistName}`)
    return
  }

  const { error } = await supabase.from('genre_highlight').insert({
    genre_id: genreId,
    artist_id: artistId,
    album_id: albumId,
    note: h.note ?? null,
    event_year: h.eventYear ?? null,
    classification: h.classification ?? 'core',
  })
  if (error) console.error(`highlight作成失敗(${h.genreName} / ${h.artistName}):`, error.message)
  else console.log(`highlight登録: ${h.genreName} / ${h.artistName}${h.workTitle ? ' / ' + h.workTitle : ''}`)
}

async function main() {
  const supabase = createAdminClient()

  const { data: rockRow } = await supabase.from('genre').select('id').ilike('name', 'rock').limit(1).maybeSingle()
  if (!rockRow) throw new Error('genreテーブルに"Rock"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('rock', rockRow.id)

  // GENRES/HIGHLIGHTSがparent()やgenreNameとして参照する、他ジャンルのGenre History
  // 投入時に既に作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['blues', 'r&b', 'hard rock', 'blues rock', 'heavy metal']
  for (const name of preExisting) {
    const { data } = await supabase.from('genre').select('id').ilike('name', name).limit(1).maybeSingle()
    if (!data) {
      console.error(`前提となる既存ジャンルが見つかりません: ${name}`)
      continue
    }
    genreIdByName.set(name.toLowerCase(), data.id)
  }

  console.log('=== ジャンル階層を投入 ===')
  for (const def of GENRES) {
    const id = await findOrCreateGenre(supabase, def)
    genreIdByName.set(def.name.toLowerCase(), id)
    console.log(`genre: ${def.name} -> ${id}`)

    for (const p of def.parents ?? []) {
      const parentId = genreIdByName.get(p.name.toLowerCase())
      if (!parentId) {
        console.error(`親ジャンルが未解決です: ${p.name} (子: ${def.name})`)
        continue
      }
      await upsertLineage(supabase, parentId, id, p.relationType)
    }
  }

  console.log('=== Cross-Genre Connectionを追加 ===')
  for (const link of EXTRA_LINEAGE) {
    const { data: childRow } = await supabase.from('genre').select('id').ilike('name', link.childName).limit(1).maybeSingle()
    const { data: parentRow } = await supabase.from('genre').select('id').ilike('name', link.parentName).limit(1).maybeSingle()
    if (!childRow || !parentRow) {
      console.error(`Cross-Genre Connection未解決: ${link.parentName} -> ${link.childName}`)
      continue
    }
    await upsertLineage(supabase, parentRow.id, childRow.id, link.relationType)
    console.log(`cross-genre: ${link.parentName} -> ${link.childName} [${link.relationType}]`)
  }

  console.log('=== 代表アーティスト/作品を投入 ===')
  for (const h of HIGHLIGHTS) {
    await insertHighlight(supabase, h, genreIdByName)
  }

  console.log('完了。Rockのgenre id:', rockRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
