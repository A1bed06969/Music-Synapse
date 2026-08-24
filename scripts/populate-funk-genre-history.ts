/**
 * FUNK GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock-genre-history.ts
 * と同じ方針: 新規UIコードは書かず、genre / genre_lineage / genre_highlight に
 * funkの系譜データを投入するだけで /genres/{funkのid} がそのままFUNK HISTORY
 * ページとして機能する。
 *
 * 仕様書からの主な設計判断(実装前に確認せず、既存の汎用設計を優先して決めたもの):
 *
 * 1. classificationは3値(core/influence/approach)のまま拡張しない。仕様書は
 *    CORE FUNK/FUNK-DRIVEN/FUNK-INFLUENCED/MODERN FUNK APPROACHの4段階を
 *    求めているが、"FUNK-DRIVEN"(Prince, Earth Wind & Fire, Herbie Hancockなど)
 *    は実際にはそれぞれの専門ジャンル(Minneapolis Sound, Disco Funk, Jazz Funk)
 *    の中心人物であり、そのカード上ではcoreとして扱うのが実態に即している。
 *    ジャンルをまたぐごとに専用の分類を増やし続けると汎用コンポーネントの意味が
 *    薄れるため、既存3値のままにする(仕様書自身も「UI Componentはジャンル
 *    非依存にする」と明記している)。
 * 2. 「Groove Node」は実装しない。仕様書自身が「Funk専用UIとして、可能であれば」
 *    と明記しており、ジャンル非依存の方針と矛盾する。グルーヴの特徴(ON THE ONE等)
 *    は各era genreのbackground_noteに文章として含める。
 * 3. Sampling Connection用の新しいrelation_type('sampled'等)は追加しない。
 *    既存の'influence'(点線)で「直接の派生ではないが強く影響を受けた」という
 *    意味は表現できるため、P-Funk→G-Funkの関係は'influence'で表す。
 * 4. city pop / shibuya-kei は既存ジャンル行を流用し、日本のFunk独自系譜
 *    (disco→city pop→Japanese Dance Pop→shibuya-kei→Modern Funk)を構築する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-funk-genre-history.ts
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
    name: 'funk',
    originYear: 1965,
    originYearLabel: '1960年代中盤',
    originCountry: 'アメリカ南部 / デトロイト / ニューオーリンズ',
    backgroundNote:
      '誕生期・創始。ソウルやR&Bを背景に、リズムそのものを前面に押し出した新しい音楽が誕生した。James Brownは、ベース・ドラム・ギター・ホーンを細かく組み合わせながら、「1拍目を強調する(ON THE ONE)」「リズムを反復する」というファンク特有のグルーヴを確立。歌やメロディだけではなく「リズムそのもの」が主役となる。',
    // 意図的に親を持たせない: blues/jazz/rock/folkの各ルートも同様に無親のままにしており、
    // /genresの「メインジャンル」判定はgenre_lineageで親を持たないジャンルを基準にしている。
    // soul/r&bへの由来は上のbackgroundNoteの文章で表現するに留める。
  },
  {
    name: 'P-Funk',
    originYear: 1971,
    originYearLabel: '1970年代前半',
    originCountry: 'デトロイト',
    backgroundNote:
      '黄金期。ファンクはさらに実験性を増し、サイケデリックな音響、巨大なベースライン、長時間のグルーヴ、SF的世界観を取り込む。George Clinton率いるParliament / Funkadelicは、ファンクを単なるダンスミュージックから巨大な音楽宇宙へと拡張した。',
    parents: [parent('funk')],
  },
  {
    name: 'Psychedelic Funk',
    originYear: 1971,
    originYearLabel: '1970年代前半',
    originCountry: 'デトロイト',
    backgroundNote: 'P-Funkのサイケデリックな音響志向をさらに突き詰めたスタイル。',
    parents: [parent('P-Funk')],
  },
  {
    name: 'jazz-funk',
    originYear: 1973,
    originYearLabel: '1970年代前半',
    originCountry: 'ロサンゼルス / ニューヨーク',
    backgroundNote: '同時期にジャズミュージシャンもファンクのリズムを積極的に導入し、Jazz Funkが発展した。Herbie Hancockの『Head Hunters』(1973)がその代表作。',
    parents: [parent('funk'), parent('jazz', 'crossover')],
  },
  {
    name: 'Disco Funk',
    originYear: 1975,
    originYearLabel: '1970年代後半',
    originCountry: 'ニューヨーク',
    backgroundNote:
      'ディスコ・ブームとメインストリーム化。ファンクのダンサブルなリズムがディスコ文化と結びつき、世界的なダンス・ミュージックへ発展。ホーン、ベース、カッティング・ギター、ストリングスなどを組み合わせた洗練されたサウンドが登場し、Funkはポップ・チャートにも進出した。',
    parents: [parent('funk')],
  },
  {
    name: 'disco',
    originYear: 1977,
    originYearLabel: '1970年代後半',
    originCountry: 'アメリカ / グローバル',
    backgroundNote: 'Disco Funkが世界的なダンス・ミュージックのムーブメントへと発展したもの。',
    parents: [parent('Disco Funk')],
  },
  {
    name: 'boogie',
    originYear: 1980,
    originYearLabel: '1970年代後半〜1980年代',
    originCountry: 'アメリカ',
    backgroundNote: 'Discoの後継として発展した、よりシンセサイザーを多用するダンス・ミュージック。',
    parents: [parent('disco')],
  },
  {
    name: 'city pop',
    originYear: 1977,
    originYearLabel: '1970年代後半〜1980年代',
    originCountry: '日本',
    backgroundNote:
      '日本でもディスコ文化が拡大し、新宿・六本木・大阪などのディスコでファンク／ディスコが定番化。Funk / Soul / Disco的アプローチを取り入れた日本独自のCity Popが発展した。山下達郎「SPARKLE」はその代表例。',
    parents: [parent('disco')],
  },
  {
    name: 'Japanese Dance Pop',
    originYear: 1983,
    originYearLabel: '1980年代',
    originCountry: '日本',
    backgroundNote: 'Michael JacksonやPrinceの世界的ヒットを通じ、日本でもファンク的なリズムやダンス・ミュージックへの関心が拡大。80年代の日本のダンスポップ、シンセポップ、ニューウェーブに影響した。',
    parents: [parent('city pop')],
  },
  {
    name: 'shibuya-kei',
    originYear: 1992,
    originYearLabel: '1990年代',
    originCountry: '日本',
    backgroundNote: '渋谷系。クラブカルチャーの拡大の中で、渋谷系、クラブジャズ、R&B、Hip-Hopなどを通じてファンクが再解釈された。',
    parents: [parent('Japanese Dance Pop')],
  },
  {
    name: 'Electro Funk',
    originYear: 1982,
    originYearLabel: '1980年代',
    originCountry: 'ミネアポリス / アメリカ',
    backgroundNote:
      'シンセ・ファンクとMinneapolis Sound。シンセサイザー、ドラムマシン、電子ベース、サンプラーなどの普及によってファンクのサウンドが電子化した。',
    parents: [parent('funk')],
  },
  {
    name: 'synth funk',
    originYear: 1982,
    originYearLabel: '1980年代',
    originCountry: 'アメリカ',
    backgroundNote: 'シンセサイザーを主体とした電子化されたファンク。',
    parents: [parent('Electro Funk')],
  },
  {
    name: 'Minneapolis Sound',
    originYear: 1982,
    originYearLabel: '1980年代',
    originCountry: 'ミネアポリス',
    backgroundNote:
      'PrinceはFunk + Rock + New Wave + Synthesizerを融合し、Minneapolis Soundという独自の音楽スタイルを確立した。同時期にMichael Jacksonなどを通じ、ファンク由来のグルーヴが世界的なポップミュージックへ浸透した。',
    parents: [parent('Electro Funk')],
  },
  {
    name: 'G-Funk',
    originYear: 1992,
    originYearLabel: '1990s',
    originCountry: 'ロサンゼルス',
    backgroundNote:
      'Hip-Hopへの継承。1970年代のファンクがHip-Hopのサンプリング文化によって再発見される。特にJames Brown、P-Funkなどのドラム・ベース・ホーン・ギターリフが大量にサンプリングされ、ロサンゼルスでG-Funkが発展した。',
    parents: [parent('P-Funk', 'influence')],
  },
  {
    name: 'Modern Funk',
    originYear: 2015,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'Modern Funk・レトロ・ファンク・リバイバル。70〜80年代のファンクを現代的なプロダクションで再構築。アナログ機材、ヴィンテージ・シンセ、生演奏、サンプル、デジタル制作を組み合わせた新しいFunkが世界的に広がる。Bruno Mars / Silk Sonicなどによって、ファンクの要素が現代ポップの中心へ再び戻った。',
    parents: [parent('funk'), parent('neo soul', 'crossover')],
  },
  {
    name: 'Broken Beat',
    originYear: 2003,
    originYearLabel: '2000s',
    originCountry: 'イギリス',
    backgroundNote: 'Neo Soulとジャズ・ファンクの融合から生まれた、複雑なリズムを特徴とするイギリス発のスタイル。',
    parents: [parent('neo soul')],
  },
]

// preExisting(funk, soul, r&b, jazz, Acid Jazz, neo soul)以外に、
// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
// (Cross-Genre Connection)。
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'Acid Jazz', parentName: 'funk', relationType: 'crossover' },
  { childName: 'neo soul', parentName: 'funk', relationType: 'influence' },
  { childName: 'new jack swing', parentName: 'funk', relationType: 'influence' },
  { childName: 'funk rock', parentName: 'Psychedelic Funk', relationType: 'derivation' },
  { childName: 'funk rock', parentName: 'Minneapolis Sound', relationType: 'crossover' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'funk', artistName: 'James Brown', workTitle: "Papa's Got a Brand New Bag", eventYear: 1965 },
  { genreName: 'funk', artistName: 'James Brown', workTitle: 'Cold Sweat', eventYear: 1967 },
  { genreName: 'funk', artistName: 'Sly & The Family Stone', workTitle: 'Thank You (Falettinme Be Mice Elf Agin)', eventYear: 1969 },
  { genreName: 'funk', artistName: 'The Meters', workTitle: 'Cissy Strut' },
  { genreName: 'funk', artistName: "Booker T. & the M.G.'s" },

  // ERA02
  { genreName: 'P-Funk', artistName: 'Parliament', workTitle: 'Mothership Connection', eventYear: 1975 },
  { genreName: 'P-Funk', artistName: 'Funkadelic', workTitle: 'Maggot Brain', eventYear: 1971 },
  { genreName: 'P-Funk', artistName: 'George Clinton' },
  { genreName: 'jazz-funk', artistName: 'Herbie Hancock', workTitle: 'Head Hunters', eventYear: 1973 },
  { genreName: 'jazz-funk', artistName: 'Roy Ayers Ubiquity', workTitle: 'Everybody Loves the Sunshine' },
  { genreName: 'P-Funk', artistName: 'The Meters', workTitle: 'Rejuvenation' },

  // ERA03
  { genreName: 'Disco Funk', artistName: 'Earth, Wind & Fire', workTitle: 'September', eventYear: 1978 },
  { genreName: 'Disco Funk', artistName: 'Earth, Wind & Fire', workTitle: 'That\'s the Way of the World' },
  { genreName: 'disco', artistName: 'Chic', workTitle: 'Good Times', eventYear: 1979 },
  { genreName: 'Disco Funk', artistName: 'Kool & The Gang', workTitle: 'Celebration' },
  { genreName: 'Disco Funk', artistName: 'Commodores' },
  { genreName: 'city pop', artistName: '山下達郎', workTitle: 'SPARKLE', note: '日本のCity PopにおけるFunk / Soul / Disco的アプローチの代表例。[JAPAN]' },
  { genreName: 'city pop', artistName: '大貫妙子' },
  { genreName: 'city pop', artistName: '角松敏生' },
  { genreName: 'city pop', artistName: '吉田美奈子' },

  // ERA04
  { genreName: 'Minneapolis Sound', artistName: 'Prince', workTitle: '1999', eventYear: 1982 },
  { genreName: 'Minneapolis Sound', artistName: 'Prince', workTitle: 'Purple Rain' },
  { genreName: 'Electro Funk', artistName: 'Rick James', workTitle: 'Super Freak' },
  { genreName: 'Electro Funk', artistName: 'Cameo' },
  { genreName: 'synth funk', artistName: 'Zapp', workTitle: 'More Bounce to the Ounce' },
  {
    genreName: 'Electro Funk',
    artistName: 'Michael Jackson',
    workTitle: 'Billie Jean',
    eventYear: 1983,
    classification: 'influence',
    note: 'ファンク由来のグルーヴを世界的なポップミュージックへ浸透させた。',
  },
  { genreName: 'Japanese Dance Pop', artistName: 'TM NETWORK', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Japanese Dance Pop', artistName: '久保田利伸', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Japanese Dance Pop', artistName: '米米CLUB', classification: 'influence', note: '[JAPAN]' },

  // ERA05
  { genreName: 'G-Funk', artistName: 'Dr. Dre', workTitle: 'The Chronic', eventYear: 1992 },
  { genreName: 'G-Funk', artistName: 'Snoop Dogg', workTitle: 'Doggystyle' },
  { genreName: 'G-Funk', artistName: 'George Clinton' },
  { genreName: 'Acid Jazz', artistName: 'Jamiroquai', workTitle: 'Travelling Without Moving', eventYear: 1996, classification: 'influence' },
  { genreName: 'Acid Jazz', artistName: 'The Brand New Heavies', workTitle: 'Brother Sister', classification: 'influence' },
  { genreName: 'Acid Jazz', artistName: 'Incognito', workTitle: 'Tribes, Vibes and Scribes', classification: 'influence' },
  { genreName: 'shibuya-kei', artistName: 'ORIGINAL LOVE', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'shibuya-kei', artistName: 'UA', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'shibuya-kei', artistName: 'スチャダラパー', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'shibuya-kei', artistName: '電気グルーヴ', classification: 'influence', note: '[JAPAN]' },

  // ERA06
  { genreName: 'neo soul', artistName: "D'Angelo", workTitle: 'Voodoo', eventYear: 2000, classification: 'influence' },
  { genreName: 'neo soul', artistName: 'Erykah Badu', workTitle: 'Worldwide Underground', classification: 'influence' },
  { genreName: 'neo soul', artistName: 'Jill Scott', classification: 'influence' },
  { genreName: 'Broken Beat', artistName: 'J Dilla', workTitle: 'Donuts', classification: 'influence' },
  { genreName: 'Modern Funk', artistName: 'Thundercat', workTitle: 'The Golden Age of Apocalypse', classification: 'influence' },

  // ERA07
  { genreName: 'Modern Funk', artistName: 'Bruno Mars' },
  { genreName: 'Modern Funk', artistName: 'Silk Sonic', workTitle: 'An Evening with Silk Sonic', eventYear: 2021 },
  { genreName: 'Modern Funk', artistName: 'Vulfpeck', workTitle: 'The Beautiful Game', classification: 'influence' },
  { genreName: 'Modern Funk', artistName: 'Anderson .Paak', workTitle: 'Malibu', classification: 'influence' },
  { genreName: 'Modern Funk', artistName: 'Thundercat', workTitle: 'Drunk', classification: 'influence' },
  { genreName: 'Broken Beat', artistName: 'Kokoroko' },
  { genreName: 'Broken Beat', artistName: 'Jungle', workTitle: 'Jungle' },
  { genreName: 'Modern Funk', artistName: 'cero', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Modern Funk', artistName: 'Suchmos', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Modern Funk', artistName: 'WONK', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Modern Funk', artistName: 'Kan Sano', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Modern Funk', artistName: 'Nulbarich', classification: 'influence', note: '[JAPAN]' },
  { genreName: 'Modern Funk', artistName: 'Yogee New Waves', classification: 'influence', note: '[JAPAN]' },
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

  const { data: funkRow } = await supabase.from('genre').select('id').ilike('name', 'funk').limit(1).maybeSingle()
  if (!funkRow) throw new Error('genreテーブルに"funk"が見つかりません。')

  const genreIdByName = new Map<string, string>()

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['soul', 'r&b', 'jazz', 'Acid Jazz', 'neo soul', 'new jack swing', 'funk rock']
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

  console.log('完了。funkのgenre id:', funkRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
