/**
 * TECHNO GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock/funk-genre-history.ts
 * と同じ方針: 新規UIコードは書かず、genre / genre_lineage / genre_highlight に
 * technoの系譜データを投入するだけで /genres/{technoのid} がそのまま
 * TECHNO HISTORYページとして機能する。
 *
 * 仕様書からの主な設計判断(スクリプト内で完結させ、確認は求めなかったもの):
 *
 * 1. 「TECHNO PIONEER/ARCHITECT/CLUB CULTURE/MODERN TECHNO/JAPANESE TECHNO」の
 *    5分類は導入しない。これは「ジャンルへの中心度」ではなく「時代の役割」と
 *    「出身地域」という別々の軸を1つのenumに混ぜたもので、既存のcore/influence/
 *    approachという単一軸の分類とは性質が異なる。既存3値へ素直に対応させ、
 *    日本のアーティストは既存の[JAPAN]タグ表記(note欄)で区別する。
 * 2. 「Technology Timeline」「Technology Node」は実装しない。仕様書自身が
 *    「Techno専用UIとして」と明記しており、ジャンル非依存というコンポーネント
 *    設計方針と矛盾する。TR-808/909, TB-303, DAW等の言及は各era genreの
 *    background_noteに文章として含める。
 * 3. 「TECHNO × CITY」は新規UIを作らず、既存のRegion Interaction(RegionBar)を
 *    そのまま使う。origin_countryに都市名(デトロイト、ベルリン、東京など)を
 *    具体的に入れることで、既存の地域クリック機能がそのまま都市フィルタとして働く。
 * 4. 「Detroit Line」「Berlin Line」「UK Rave Line」を独立UIとしては作らず、
 *    genre_lineageの実際の親子関係として編み込むことで、既存のGENRE EVOLUTION
 *    ツリー1つがこれらの系譜を自然に表現するようにする。
 * 5. Krautrock/YMOなどはTechnoの「先行世代」であり、Technoから見て子孫ではなく
 *    祖先にあたる(方向が逆)。無理に子ノードとして作らず、Electro/synth-popの
 *    background_noteとハイライトのnoteで文脈として説明するに留める
 *    (jazz投入時のRagtime、blues投入時のr&bと同じ判断)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-techno-genre-history.ts
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
    name: 'electro',
    originYear: 1977,
    originYearLabel: '1970年代〜1980年代前半',
    originCountry: 'ドイツ(デュッセルドルフ)',
    backgroundNote:
      'エレクトロニック・ルーツ。シンセサイザー、シーケンサー、ドラムマシンなどの電子楽器が普及し、「反復」「機械的リズム」「電子音」「未来的なサウンド」を中心とした音楽が発展。ドイツではKraftwerkが人間と機械の関係をテーマにしたミニマルで反復的な電子音楽を確立し、この音楽思想が後のDetroit Technoへ大きな影響を与えた(Kraftwerkそのものはこのジャンルの先行世代であり、正式なTechnoのサブジャンルとしては扱わない)。',
    parents: [parent('techno')],
  },
  {
    name: 'synth-pop',
    originYear: 1978,
    originYearLabel: '1970年代〜1980年代前半',
    originCountry: 'イギリス / 日本',
    backgroundNote:
      '電子音楽をポップミュージックの形で提示したムーブメント。日本ではYellow Magic Orchestra(YMO)が電子音楽をポップミュージックとして世界的に提示し、テクノポップという独自の文化を形成。後の日本の電子音楽、ゲーム音楽、クラブミュージックへ接続する。',
    parents: [parent('techno', 'influence')],
  },
  {
    name: 'techno kayō',
    originYear: 1981,
    originYearLabel: '1970年代〜1980年代前半',
    originCountry: '日本',
    backgroundNote: 'テクノ歌謡。YMOのブームを受け、電子音楽的なアレンジを取り入れた日本の歌謡曲・アイドル歌謡のスタイル。',
    parents: [parent('synth-pop')],
  },
  {
    name: 'Detroit Techno',
    originYear: 1985,
    originYearLabel: '1980年代中盤〜後半',
    originCountry: 'アメリカ(デトロイト)',
    backgroundNote:
      'デトロイト・テクノの誕生。工業都市デトロイトのアフリカ系アメリカ人コミュニティを背景に、Funk・Soul・Electro・European Electronic Musicが融合。Juan Atkins・Derrick May・Kevin SaundersonによるThe Belleville Threeが、未来的な電子音楽とダンス・グルーヴを融合しDetroit Technoの基礎を形成した。Kraftwerkなどヨーロッパ電子音楽から影響を受けながら、Funk由来の身体的なグルーヴを残したことが重要。制作にはRoland TR-808/TR-909/TB-303といったアナログ機材が使われた。',
    parents: [parent('electro'), parent('funk', 'crossover')],
  },
  {
    name: 'house',
    originYear: 1985,
    originYearLabel: '1980年代中盤〜後半',
    originCountry: 'アメリカ(シカゴ)',
    backgroundNote: 'Detroit Technoとほぼ同時期にシカゴで発展した、ハウス・ミュージック。Technoとは相互に影響し合う関係にある(Chicago Houseとの交差)。',
    parents: [parent('Detroit Techno', 'crossover')],
  },
  {
    name: 'acid house',
    originYear: 1987,
    originYearLabel: '1980年代末〜1990年代前半',
    originCountry: 'イギリス',
    backgroundNote:
      'UK Rave CultureとSecond Summer of Love。Detroit TechnoやChicago Houseがイギリスへ流入し、Warehouse・Outdoor Rave・Illegal Party・Sound Systemなどの巨大なレイヴ文化と結びつく。1988年頃のSecond Summer of Loveを契機に、電子ダンスミュージックが巨大な社会現象となった。TB-303の酸性(Acid)サウンドが特徴。',
    parents: [parent('house')],
  },
  {
    name: 'Hardcore Techno',
    originYear: 1990,
    originYearLabel: '1980年代末〜1990年代前半',
    originCountry: 'イギリス',
    backgroundNote: 'レイヴ・カルチャーの中で生まれた、より高速でハードなテクノ。',
    parents: [parent('techno')],
  },
  {
    name: 'Ambient Techno',
    originYear: 1991,
    originYearLabel: '1980年代末〜1990年代前半',
    originCountry: 'イギリス',
    backgroundNote: 'The Orbなどが提示した、ダンスフロアだけでなくリスニングのためのテクノ。',
    parents: [parent('techno'), parent('ambient', 'crossover')],
  },
  {
    name: 'minimal techno',
    originYear: 1994,
    originYearLabel: '1990年代中盤〜後半',
    originCountry: 'ドイツ(ベルリン)',
    backgroundNote:
      'Minimal TechnoとTechnoの黄金期。レイヴ・カルチャーの巨大化に対して、よりミニマルで反復的、音響的なテクノが発展。ベルリンではTresorなどのクラブ／レーベルを中心に、Detroit Technoの精神を受け継ぎながら新しいヨーロッパ型Technoを形成した。1989年のベルリンの壁崩壊後、廃墟や空き建物を利用したクラブカルチャーが急速に発展したことも背景にある。',
    parents: [parent('Detroit Techno')],
  },
  {
    name: 'idm',
    originYear: 1992,
    originYearLabel: '1990年代中盤〜後半',
    originCountry: 'イギリス',
    backgroundNote: 'Warp Recordsなどを中心に、TechnoとExperimental Electronic Musicが融合し発展したスタイル。',
    parents: [parent('techno'), parent('experimental electronic', 'crossover')],
  },
  {
    name: 'tech house',
    originYear: 1995,
    originYearLabel: '1990年代中盤〜後半',
    originCountry: 'ヨーロッパ',
    backgroundNote: 'TechnoとHouseの融合スタイル。',
    parents: [parent('house'), parent('techno', 'crossover')],
  },
  {
    name: 'big beat',
    originYear: 1996,
    originYearLabel: '1990年代中盤〜後半',
    originCountry: 'イギリス',
    backgroundNote: 'Breakbeatをベースにした、よりロック的でエネルギッシュな電子音楽。',
    parents: [parent('breakbeat')],
  },
  {
    name: 'Japanese Techno',
    originYear: 1990,
    originYearLabel: '1990年代',
    originCountry: '日本',
    backgroundNote:
      '日本ではTechnoがクラブだけでなく大型フェスやメディアへ進出。WIREなどの大型テクノイベントによって、Technoが国内の巨大な音楽文化として定着した。YMOという独自の電子音楽文化が、日本のTechno / Club Musicの重要な前史となっていることを明示する — 単なる海外Technoの輸入としては扱わない。',
    parents: [parent('synth-pop')],
  },
  {
    name: '現代日本のTechno',
    originYear: 2015,
    originYearLabel: '2010年代後半〜現代',
    originCountry: '日本',
    backgroundNote: '日本でもハードテクノ、インダストリアル・テクノ、アンダーグラウンド・レイヴが新世代のクラブシーンで拡大。Boiler Room Tokyoなどを通じ、日本のクラブカルチャーがグローバルなネットワークと接続している。',
    parents: [parent('Japanese Techno')],
  },
  {
    name: 'microhouse',
    originYear: 2001,
    originYearLabel: '2000年代',
    originCountry: 'ヨーロッパ',
    backgroundNote:
      'デジタル・レボリューションとPC音楽化。音楽制作環境がハードウェア中心からコンピューター中心へ移行。DAW、ソフトウェア・シンセサイザー、プラグイン、デジタル配信などが普及し、Ableton Liveなどの登場によりラップトップ1台でも高度な電子音楽制作が可能になった。',
    parents: [parent('house'), parent('tech house', 'crossover')],
  },
  {
    name: 'electronica',
    originYear: 2002,
    originYearLabel: '2000年代',
    originCountry: 'グローバル',
    backgroundNote: '音楽制作の民主化が進み、小規模レーベルやインディペンデントなアーティストが世界中で活動するようになった時代の電子音楽の総称。',
    parents: [parent('techno', 'influence')],
  },
  {
    name: 'edm',
    originYear: 2010,
    originYearLabel: '2010年代',
    originCountry: 'グローバル / 北米',
    backgroundNote:
      'EDM ExplosionとFestival Culture。電子ダンスミュージックがクラブ文化を越えて巨大なフェスティバル市場へ進出。巨大なステージ、レーザー、LED、DJパフォーマンスなどと結びついた。一方、Techno本来のアンダーグラウンドなクラブ文化も並行して発展を続けた。',
    parents: [parent('techno', 'influence')],
  },
  {
    name: 'electro house',
    originYear: 2011,
    originYearLabel: '2010年代',
    originCountry: 'グローバル',
    backgroundNote: 'EDMムーブメントの中で発展した、エレクトロ由来の重いベースを特徴とするハウス。',
    parents: [parent('edm')],
  },
  {
    name: 'progressive house',
    originYear: 2009,
    originYearLabel: '2010年代',
    originCountry: 'グローバル',
    backgroundNote: '長い展開とビルドアップを特徴とするハウス。EDMのフェスティバル文化とも結びついた。',
    parents: [parent('house'), parent('edm', 'crossover')],
  },
  {
    name: 'Hard Techno',
    originYear: 2018,
    originYearLabel: '2010年代後半〜現代',
    originCountry: 'ベルリン / ヨーロッパ',
    backgroundNote:
      'Hard Techno / Industrial Techno Revival。EDMの巨大化と対照的に、アンダーグラウンドなクラブカルチャーではTechnoの原点回帰が進む。高速なBPM、強烈なキック、ディストーション、インダストリアルな質感などを特徴とするスタイルが世界的に拡大。SNSやストリーミングによってクラブカルチャーの映像が世界中へ瞬時に拡散され、若い世代にもTechnoが再発見された(Acid Techno, Raw Techno, Hypnotic Technoなど関連スタイルを含む)。',
    parents: [parent('techno')],
  },
  {
    name: 'Industrial Techno',
    originYear: 2017,
    originYearLabel: '2010年代後半〜現代',
    originCountry: 'ベルリン',
    backgroundNote: 'インダストリアル・ミュージックの質感とTechnoが融合したスタイル。Berghainなどのベルリンのクラブを中心に発展した。',
    parents: [parent('Hard Techno'), parent('post-industrial', 'crossover')],
  },
]

// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
// (Cross-Genre Connection、および既存ジャンルの再利用によるreachability確保)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'breakbeat', parentName: 'techno', relationType: 'influence' },
  { childName: 'jungle', parentName: 'breakbeat', relationType: 'derivation' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  {
    genreName: 'electro',
    artistName: 'Kraftwerk',
    workTitle: 'Trans-Europe Express',
    eventYear: 1977,
    classification: 'influence',
    note: '人間と機械の関係をテーマにしたミニマルで反復的な電子音楽を確立し、Detroit Technoへ大きな影響を与えた先行世代。',
  },
  { genreName: 'electro', artistName: 'Kraftwerk', workTitle: 'Autobahn', eventYear: 1974, classification: 'influence' },
  { genreName: 'electro', artistName: 'Tangerine Dream', classification: 'influence' },
  { genreName: 'electro', artistName: 'Neu!', classification: 'influence' },
  { genreName: 'electro', artistName: 'Can', classification: 'influence' },
  { genreName: 'synth-pop', artistName: 'Gary Numan', workTitle: 'The Pleasure Principle', eventYear: 1979 },
  { genreName: 'synth-pop', artistName: 'Depeche Mode' },
  { genreName: 'synth-pop', artistName: 'Yellow Magic Orchestra', workTitle: 'Solid State Survivor', eventYear: 1979, note: '[JAPAN]' },
  { genreName: 'synth-pop', artistName: '坂本龍一', note: 'YMOのメンバー。[JAPAN]' },
  { genreName: 'synth-pop', artistName: '細野晴臣', note: 'YMOのメンバー。[JAPAN]' },
  { genreName: 'synth-pop', artistName: '高橋幸宏', note: 'YMOのメンバー。[JAPAN]' },

  // ERA02
  { genreName: 'Detroit Techno', artistName: 'Juan Atkins', workTitle: "No UFO's" },
  { genreName: 'Detroit Techno', artistName: 'Derrick May' },
  { genreName: 'Detroit Techno', artistName: 'Kevin Saunderson' },
  { genreName: 'Detroit Techno', artistName: 'Cybotron', workTitle: 'Clear' },
  { genreName: 'Detroit Techno', artistName: 'Rhythim Is Rhythim', workTitle: 'Strings of Life', eventYear: 1987 },
  { genreName: 'Detroit Techno', artistName: 'Inner City', workTitle: 'Good Life' },

  // ERA03
  { genreName: 'Ambient Techno', artistName: 'The Orb', workTitle: "The Orb's Adventures Beyond the Underworld" },
  { genreName: 'idm', artistName: 'Aphex Twin', workTitle: 'Selected Ambient Works 85–92' },
  { genreName: 'Hardcore Techno', artistName: 'The Prodigy', workTitle: 'Experience' },
  { genreName: 'techno', artistName: 'Underworld', workTitle: 'Dubnobasswithmyheadman', eventYear: 1994, classification: 'influence' },
  { genreName: 'Hardcore Techno', artistName: '808 State' },
  { genreName: 'techno', artistName: 'Orbital', classification: 'influence' },

  // ERA04
  { genreName: 'minimal techno', artistName: 'Jeff Mills', workTitle: 'Waveform Transmission' },
  { genreName: 'minimal techno', artistName: 'Richie Hawtin' },
  { genreName: 'minimal techno', artistName: 'Plastikman', workTitle: 'Sheet One' },
  { genreName: 'minimal techno', artistName: 'Robert Hood' },
  { genreName: 'minimal techno', artistName: 'Basic Channel', workTitle: 'BCD' },
  { genreName: 'idm', artistName: 'Aphex Twin', workTitle: 'Richard D. James Album' },
  { genreName: 'idm', artistName: 'Autechre' },
  { genreName: 'big beat', artistName: 'The Chemical Brothers', workTitle: 'Dig Your Own Hole' },
  { genreName: 'techno', artistName: 'Underworld', workTitle: 'Second Toughest in the Infants', classification: 'influence' },
  { genreName: 'Japanese Techno', artistName: 'Ken Ishii', workTitle: 'Jelly Tones', eventYear: 1995, note: '[JAPAN]' },
  { genreName: 'Japanese Techno', artistName: '電気グルーヴ', workTitle: 'Shangri-La', eventYear: 1997, note: '[JAPAN]' },
  { genreName: 'Japanese Techno', artistName: '石野卓球', note: '電気グルーヴのメンバーであり、ソロでも日本のテクノシーンを牽引。[JAPAN]' },

  // ERA05
  { genreName: 'microhouse', artistName: 'Richie Hawtin', workTitle: 'Decks, EFX & 909' },
  { genreName: 'microhouse', artistName: 'Ricardo Villalobos', workTitle: 'Alcachofa' },
  { genreName: 'microhouse', artistName: 'Akufen', workTitle: 'My Way' },
  { genreName: 'microhouse', artistName: 'Isolée', workTitle: 'We Are Monster' },
  { genreName: 'electronica', artistName: 'Four Tet' },
  { genreName: 'electronica', artistName: 'Luomo' },

  // ERA06
  { genreName: 'edm', artistName: 'Avicii', workTitle: 'Levels' },
  { genreName: 'edm', artistName: 'Calvin Harris', workTitle: '18 Months' },
  { genreName: 'electro house', artistName: 'Deadmau5', workTitle: 'Strobe' },
  { genreName: 'edm', artistName: 'Skrillex' },
  { genreName: 'techno', artistName: 'Carl Cox' },

  // ERA07
  { genreName: 'Hard Techno', artistName: 'Charlotte de Witte', workTitle: 'Selected' },
  { genreName: 'Hard Techno', artistName: 'Amelie Lens', workTitle: 'Exhale' },
  { genreName: 'Hard Techno', artistName: '999999999' },
  { genreName: 'Hard Techno', artistName: 'Dax J' },
  { genreName: 'Hard Techno', artistName: 'VTSS' },
  { genreName: 'Industrial Techno', artistName: 'Blawan', workTitle: 'Why They Hide Their Bodies Under My Garage?' },
  { genreName: 'Industrial Techno', artistName: 'Perc' },
  { genreName: 'idm', artistName: 'Bicep', workTitle: 'Bicep', classification: 'influence' },
  { genreName: '現代日本のTechno', artistName: 'DJ Nobu', note: '[JAPAN]' },
  { genreName: '現代日本のTechno', artistName: 'Fumiya Tanaka', note: '[JAPAN]' },
  { genreName: '現代日本のTechno', artistName: '半野喜弘', note: '[JAPAN]' },
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

  const { data: technoRow } = await supabase.from('genre').select('id').ilike('name', 'techno').limit(1).maybeSingle()
  if (!technoRow) throw new Error('genreテーブルに"techno"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('techno', technoRow.id)

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['funk', 'ambient', 'experimental electronic', 'post-industrial', 'breakbeat', 'jungle']
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

  console.log('完了。technoのgenre id:', technoRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
