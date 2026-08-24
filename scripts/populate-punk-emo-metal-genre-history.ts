/**
 * PUNK / EMO / METAL / HARD ROCK / GARAGE ROCK のデータ投入スクリプト。
 * populate-jazz/.../rnb-genre-history.tsと同じ方針だが、今回は完全新規のジャンル
 * ツリーではなく、既存DBに以前から存在していた「薄い骨組み」(punk rock, hardcore
 * punk, post-punk, emo, garage rock, hard rock, stadium rock, heavy metal 等 —
 * origin_yearや簡単なnoteはあるがhighlightが0件、または雑なiTunesマッチ済み)を
 * 土台にして、ユーザーがレビュー済みの「ジャンル系譜大全」ドキュメント相当の
 * 深さまで肉付けする。
 *
 * 設計判断:
 * - 既存の "punk" (空stub, 系譜なし) には触れない。実質的なPunkルートは
 *   既に "punk rock"(1975, Rock配下)として系譜・highlightを持っているため、
 *   そちらを土台に肉付けする。
 * - 既存の "heavy metal" stub(highlight 1件=Iron Maiden、系譜なし)は、
 *   ドキュメントで説明した「NWOBHM期に"ヘヴィメタル"という言葉が独自の
 *   アイデンティティを確立した」の実体として再利用し、metal の子として
 *   NWOBHM相当のカードに仕立てる。
 * - 誤ったiTunesマッチ(Sex Pistolsが子守唄カバー盤、Nirvanaがピアノ
 *   トリビュート盤にひも付いていた)は削除して正しいアルバムに差し替える。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-punk-emo-metal-genre-history.ts
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

// ─── ジャンル階層 ────────────────────────────────────────────────────────

const GENRES: GenreDef[] = [
  // ---- GARAGE ROCK (proto-punkの親として先に解決しておく必要がある) ----
  {
    name: 'garage rock',
    originYear: 1963,
    originYearLabel: '1963–67年',
    originCountry: 'アメリカ各地',
    backgroundNote:
      'British Invasionへの熱狂的反応として、アメリカ各地の10代バンドがラジオヒットを模倣し自宅ガレージで演奏したのが起点。母体はRock&Roll+R&BとBritish Invasion(特にThe Kinks/The Rolling Stonesの荒々しさ)。粗削りな演奏とファズギターが特徴。1972年編纂のコンピレーション『Nuggets』(Lenny Kaye編)が、ジャンルとしての事後的な再定義に決定的役割を果たした。',
    parents: [parent('blues rock', 'influence'), parent('r&b')],
  },
  // ---- PUNK ----
  {
    name: 'proto-punk',
    originYear: 1969,
    originYearLabel: '1960s末〜1970s前半',
    originCountry: 'アメリカ(ミシガン / ニューヨーク)',
    backgroundNote:
      'ガレージロックの荒々しさを、より過激・実験的な方向へ先鋭化させた一群。The StoogesやMC5はデトロイトのカウンターカルチャーと結びつき大音量・破壊的なライブで知られ、New York DollsはNYのアート/クィアシーンから生まれた。後のパンク・ロックの直接の設計図となった。',
    parents: [parent('garage rock')],
  },
  {
    name: 'pop punk',
    originYear: 1994,
    originYearLabel: '1990年代',
    originCountry: 'アメリカ(カリフォルニア)',
    backgroundNote:
      'Buzzcocks等のキャッチーなパンクの系譜を継ぎつつ、90年代カリフォルニアでよりポップに洗練。Green Day『Dookie』(1994)の全米ヒットでPunk Rockの語法が初めてメインストリームのポップチャートへ本格進出した。',
    parents: [parent('punk rock')],
  },
  {
    name: 'skate punk',
    originYear: 1988,
    originYearLabel: '1980年代末〜1990年代',
    originCountry: 'アメリカ(カリフォルニア)',
    backgroundNote: 'スケートボード文化と結びついた高速でメロディックなパンク。Bad ReligionやNOFXが牽引し、Pop Punkの隆盛と並走した。',
    parents: [parent('pop punk')],
  },
  // ---- EMO ----
  {
    name: 'emo',
    originYear: 1985,
    originYearLabel: '1985年〜',
    originCountry: 'アメリカ(ワシントンD.C.)',
    backgroundNote:
      'ハードコアパンクの政治的・攻撃的表現への飽和から生まれた「Emotional Hardcore」。Dischordレーベル周辺のDCシーンで、Rites of SpringやEmbraceがハードコアの激しさを保ちながら歌詞を個人的・感情的な内容に転換した。注意点として、この発祥期のサウンドは、後年広く「エモ」として知られるようになる2000年代のポップパンク寄りでメロディアスな音楽性とは大きく異なる。両者を繋いだのは90年代のMidwest Emoと、2000年代のPop Punkとの融合である。',
    parents: [parent('hardcore punk')],
  },
  {
    name: 'midwest emo',
    originYear: 1994,
    originYearLabel: '1990年代',
    originCountry: 'アメリカ中西部',
    backgroundNote:
      'Emotional Hardcoreがより複雑なギターワークとインディーロック的感性を取り入れて音楽的に独立。Sunny Day Real Estateがその基準を作り、American Footballはインストゥルメンタル・パッセージと変則的なタイム感で後年再評価される名盤を残した。',
    parents: [parent('emo')],
  },
  {
    name: 'screamo',
    originYear: 1993,
    originYearLabel: '1990年代',
    originCountry: 'アメリカ',
    backgroundNote: '絶叫ヴォーカルを取り入れ、感情表現を極端に先鋭化させた一派。Orchidらが代表的で、Post-Hardcoreとも重なりながら独自の激しさを追求した。',
    parents: [parent('emo')],
  },
  {
    name: '2000s emo',
    originYear: 2001,
    originYearLabel: '2001–2008年',
    originCountry: 'アメリカ',
    backgroundNote:
      'Emotional HardcoreがPop Punkの語法(キャッチーなコーラス、大衆的なプロダクション)と融合し、商業的最盛期を迎えた時代。Jimmy Eat World『Bleed American』(2001)が突破口となり、My Chemical RomanceやFall Out Boyが全米的なヒットを記録。現在多くの人が「エモ」と聞いて連想するイメージはこの時代のもの。',
    parents: [parent('emo'), parent('pop punk', 'crossover')],
  },
  {
    name: 'emo revival',
    originYear: 2011,
    originYearLabel: '2010年代',
    originCountry: 'アメリカ',
    backgroundNote: '90年代Midwest Emoの複雑なギターワークと内省的な作風への回帰。The World Is a Beautiful Place & I Am No Longer Afraid to Dieらが牽引した。',
    parents: [parent('midwest emo', 'influence'), parent('2000s emo')],
  },
  // ---- HARD ROCK / METAL ----
  {
    name: 'glam metal',
    originYear: 1981,
    originYearLabel: '1980年代',
    originCountry: 'アメリカ(ロサンゼルス)',
    backgroundNote:
      'ロサンゼルスのサンセット・ストリップを中心に発展した、派手なビジュアルとキャッチーなリフを特徴とするハードロック/メタル。Mötley CrüeやGuns N\' Rosesが代表格。80年代後半に商業的頂点を迎えるが、過剰な装飾性への飽和がGrunge台頭の反動を招いた。',
    parents: [parent('hard rock')],
  },
  {
    name: 'metal',
    originYear: 1969,
    originYearLabel: '1969–70年',
    originCountry: 'イギリス(バーミンガム)',
    backgroundNote:
      'バーミンガムという工業都市の陰鬱な労働者階級の環境の中、Black Sabbathがブルースロックをダウンチューニングと増四度(トライトーン)の多用で重厚・不吉な響きに変えたことに始まる。同時期にLed Zeppelin、Deep Purpleもハード化を推し進めており、当時「ヘヴィメタル」は「ハードロック」とほぼ同義の総称として使われていた。80年代のサブジャンル分岐を経て「メタル」は独自の音楽的アイデンティティ(過激さ・様式美・テクニカル性)を確立し、現在では「メタル」がジャンル総称、「ヘヴィメタル」はその中でもNWOBHM直系の一様式を指すことが多い、という意味の逆転が起きている。',
    parents: [parent('blues rock')],
  },
  {
    name: 'heavy metal',
    originYear: 1979,
    originYearLabel: '1979–83年(NWOBHM)',
    originCountry: 'イギリス',
    backgroundNote:
      'NWOBHM(New Wave of British Heavy Metal)を通じて「ヘヴィメタル」が独自の音楽的アイデンティティを確立した時代。ツインギター様式化とスピードアップが進み、Iron MaidenやJudas Priestが様式を決定づけた。この様式化がThrash Metalの直接の設計図となる。',
    parents: [parent('metal')],
  },
  {
    name: 'thrash metal',
    originYear: 1983,
    originYearLabel: '1983–88年',
    originCountry: 'アメリカ(カリフォルニア)',
    backgroundNote: 'NWOBHMの様式を米西海岸の若者が超高速・攻撃的に発展させた。Metallica『Master of Puppets』(1986)が金字塔とされる。Hardcore Punkとの相互越境(クロスオーバー・スラッシュ)も生まれた。',
    parents: [parent('heavy metal')],
  },
  {
    name: 'death metal',
    originYear: 1988,
    originYearLabel: '1980年代末',
    originCountry: 'アメリカ(フロリダ)',
    backgroundNote: 'スラッシュの過激化がさらに先鋭化。極端な速度、ガテラルヴォーカル、不協和音を特徴とする。Deathがジャンルの基準を築いた。',
    parents: [parent('thrash metal')],
  },
  {
    name: 'black metal',
    originYear: 1991,
    originYearLabel: '1990年代初頭',
    originCountry: 'ノルウェー',
    backgroundNote: 'ノルウェーを中心に発展した、極端な音響美学とダークな世界観を特徴とするサブジャンル。Mayhemが代表格。',
    parents: [parent('thrash metal')],
  },
  {
    name: 'nu metal',
    originYear: 1994,
    originYearLabel: '1994–2003年',
    originCountry: 'アメリカ(カリフォルニア)',
    backgroundNote:
      '90年代グランジ台頭でメタル市場が低迷する中、ヒップホップのグルーヴとダウンチューンされた7弦ギターを融合させ復権。Korn『Korn』(1994)が起点。ヒップホップとの融合という点で新規層を獲得した。',
    parents: [parent('metal')],
  },
  {
    name: 'metalcore',
    originYear: 2000,
    originYearLabel: '2000年代',
    originCountry: 'アメリカ',
    backgroundNote: 'Hardcore PunkとMetalの融合。Killswitch Engageらが代表的。Punk側の系譜(Hardcore Punk)とMetal側の系譜が交差する結節点にあたる。',
    parents: [parent('metal'), parent('hardcore punk', 'crossover')],
  },
  {
    name: 'post-metal',
    originYear: 2002,
    originYearLabel: '2000年代',
    originCountry: 'アメリカ',
    backgroundNote: 'Metalcoreからさらに実験的・アトモスフェリックな方向へ発展。Isisが代表的。',
    parents: [parent('metalcore')],
  },
]

// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'proto-punk', parentName: 'punk rock', relationType: 'influence' },
  { childName: 'garage rock revival', parentName: 'garage rock', relationType: 'influence' },
  { childName: 'post-hardcore', parentName: 'hardcore punk', relationType: 'derivation' },
  { childName: 'gothic rock', parentName: 'post-punk', relationType: 'derivation' },
  { childName: 'grunge', parentName: 'glam metal', relationType: 'influence' },
  { childName: 'doom metal', parentName: 'metal', relationType: 'derivation' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

// 既存の誤ったiTunesマッチ(カバー/トリビュート盤)を削除して正しいアルバムに差し替える対象
const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = [
  { genreName: 'punk rock', artistName: 'Sex Pistols' },
  { genreName: 'grunge', artistName: 'Nirvana' },
]

const HIGHLIGHTS: HighlightDef[] = [
  // punk rock (既存ルート、founding期を補強)
  { genreName: 'punk rock', artistName: 'Sex Pistols', workTitle: 'Never Mind the Bollocks, Here\'s the Sex Pistols', eventYear: 1977 },
  { genreName: 'punk rock', artistName: 'Ramones', workTitle: 'Ramones', eventYear: 1976 },
  { genreName: 'proto-punk', artistName: 'The Stooges', workTitle: 'Raw Power', classification: 'influence' },
  { genreName: 'proto-punk', artistName: 'MC5', workTitle: 'Kick Out the Jams', classification: 'influence' },
  { genreName: 'proto-punk', artistName: 'New York Dolls', classification: 'influence' },

  // hardcore punk
  { genreName: 'hardcore punk', artistName: 'Black Flag', workTitle: 'Damaged', eventYear: 1981 },
  { genreName: 'hardcore punk', artistName: 'Minor Threat' },
  { genreName: 'hardcore punk', artistName: 'Bad Brains' },

  // post-punk (既存ルート補強)
  { genreName: 'post-punk', artistName: 'Gang of Four', workTitle: 'Entertainment!' },
  { genreName: 'post-punk', artistName: 'Wire', workTitle: 'Pink Flag' },
  { genreName: 'gothic rock', artistName: 'Bauhaus' },
  { genreName: 'gothic rock', artistName: 'Siouxsie and the Banshees' },

  // pop punk / skate punk
  { genreName: 'pop punk', artistName: 'Green Day', workTitle: 'Dookie', eventYear: 1994 },
  { genreName: 'pop punk', artistName: 'Buzzcocks', classification: 'influence', note: '70年代の先駆的なキャッチーなパンク。' },
  { genreName: 'skate punk', artistName: 'NOFX' },
  { genreName: 'skate punk', artistName: 'Bad Religion' },

  // post-hardcore
  { genreName: 'post-hardcore', artistName: 'At the Drive-In', workTitle: 'Relationship of Command' },

  // emo系
  { genreName: 'emo', artistName: 'Rites of Spring', note: 'Emotional Hardcoreを確立した最初期のバンド。' },
  { genreName: 'emo', artistName: 'Embrace' },
  { genreName: 'midwest emo', artistName: 'Sunny Day Real Estate', workTitle: 'Diary', eventYear: 1994 },
  { genreName: 'midwest emo', artistName: 'American Football', workTitle: 'American Football' },
  { genreName: 'screamo', artistName: 'Orchid' },
  { genreName: '2000s emo', artistName: 'Jimmy Eat World', workTitle: 'Bleed American', eventYear: 2001 },
  { genreName: '2000s emo', artistName: 'My Chemical Romance', workTitle: 'The Black Parade', eventYear: 2006 },
  { genreName: '2000s emo', artistName: 'Fall Out Boy' },
  { genreName: '2000s emo', artistName: 'Dashboard Confessional' },
  { genreName: 'emo revival', artistName: 'The World Is a Beautiful Place & I Am No Longer Afraid to Die', workTitle: 'Whenever, If Ever' },

  // garage rock
  { genreName: 'garage rock', artistName: 'The Sonics' },
  { genreName: 'garage rock', artistName: '? and the Mysterians', note: '「96 Tears」で知られる。' },

  // hard rock (既存ルート補強)
  { genreName: 'hard rock', artistName: 'Deep Purple', workTitle: 'Deep Purple in Rock', eventYear: 1970 },
  { genreName: 'hard rock', artistName: 'Cream', workTitle: 'Disraeli Gears' },
  { genreName: 'stadium rock', artistName: 'Boston' },
  { genreName: 'stadium rock', artistName: 'Journey' },
  { genreName: 'glam metal', artistName: "Mötley Crüe" },
  { genreName: 'glam metal', artistName: "Guns N' Roses", workTitle: 'Appetite for Destruction', eventYear: 1987 },

  // metal系
  { genreName: 'metal', artistName: 'Black Sabbath', workTitle: 'Paranoid', eventYear: 1970 },
  { genreName: 'heavy metal', artistName: 'Judas Priest' },
  { genreName: 'thrash metal', artistName: 'Metallica', workTitle: 'Master of Puppets', eventYear: 1986 },
  { genreName: 'thrash metal', artistName: 'Slayer' },
  { genreName: 'death metal', artistName: 'Death', workTitle: 'Scream Bloody Gore' },
  { genreName: 'black metal', artistName: 'Mayhem' },
  { genreName: 'nu metal', artistName: 'Korn', workTitle: 'Korn', eventYear: 1994 },
  { genreName: 'metalcore', artistName: 'Killswitch Engage' },
  { genreName: 'post-metal', artistName: 'Isis' },
  { genreName: 'doom metal', artistName: 'Candlemass' },

  // grunge (誤マッチ差し替え)
  { genreName: 'grunge', artistName: 'Nirvana', workTitle: 'Nevermind', eventYear: 1991 },
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

async function fixBadHighlight(supabase: SupabaseClient, genreIdByName: Map<string, string>, genreName: string, artistName: string) {
  const genreId = genreIdByName.get(genreName.toLowerCase())
  if (!genreId) return
  const { data: artist } = await supabase.from('artist').select('id').ilike('name', artistName).limit(1).maybeSingle()
  if (!artist) return
  const { data: rows } = await supabase.from('genre_highlight').select('id, album_id').eq('genre_id', genreId).eq('artist_id', artist.id)
  for (const row of rows ?? []) {
    console.log(`誤マッチ削除: ${genreName} / ${artistName} (highlight ${row.id})`)
    await supabase.from('genre_highlight').delete().eq('id', row.id)
  }
}

async function main() {
  const supabase = createAdminClient()

  const genreIdByName = new Map<string, string>()

  // GENRES/HIGHLIGHTSが参照する、既存の骨組みジャンルをあらかじめ解決
  const preExisting = [
    'punk rock', 'hardcore punk', 'post-punk', 'gothic rock', 'post-hardcore',
    'garage rock revival', 'hard rock', 'stadium rock', 'grunge', 'doom metal',
    'blues rock', 'r&b',
  ]
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
    const childId = genreIdByName.get(link.childName.toLowerCase())
    const parentId = genreIdByName.get(link.parentName.toLowerCase())
    if (!childId || !parentId) {
      console.error(`Cross-Genre Connection未解決: ${link.parentName} -> ${link.childName}`)
      continue
    }
    await upsertLineage(supabase, parentId, childId, link.relationType)
    console.log(`cross-genre: ${link.parentName} -> ${link.childName} [${link.relationType}]`)
  }

  console.log('=== 誤マッチの修正 ===')
  for (const fix of BAD_HIGHLIGHT_FIXES) {
    await fixBadHighlight(supabase, genreIdByName, fix.genreName, fix.artistName)
  }

  console.log('=== 代表アーティスト/作品を投入 ===')
  for (const h of HIGHLIGHTS) {
    await insertHighlight(supabase, h, genreIdByName)
  }

  console.log('完了。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
