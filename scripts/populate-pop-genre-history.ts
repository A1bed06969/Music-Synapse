/**
 * POP GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock/funk/techno/
 * hiphop-genre-history.tsと同じ方針: 新規UIコードは書かず、genre / genre_lineage /
 * genre_highlight にpopの系譜データを投入するだけで /genres/{popのid} がそのまま
 * POP HISTORYページとして機能する(ユーザー自身が既存7ジャンルと同じコンポーネント
 * 再利用を明示しているため、独自UIの要否検討は不要)。
 *
 * 「メディア/テクノロジーの進化ライン」(Tin Pan Alley→Radio→TV→MTV→CD→Digital→
 * Streaming→TikTok)は専用UIを作らず、各era genreのbackground_noteに文章として
 * 織り込む(techno投入時のTechnology Timelineと同じ判断)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-pop-genre-history.ts
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
    name: 'Tin Pan Alley',
    originYear: 1920,
    originYearLabel: '1920年代〜1940s',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote:
      'ティン・パン・アレイとポピュラー歌謡。ニューヨークの音楽出版社街「ティン・パン・アレイ」を中心に、大衆が口ずさみやすいメロディとオーケストラ伴奏を持つ楽曲が大量に制作される。楽譜出版・レコード・ラジオ・映画などのマスメディアが結びつき、「ヒット曲」という概念が形成されていった。',
    parents: [parent('pop')],
  },
  {
    name: '昭和歌謡',
    originYear: 1930,
    originYearLabel: '1920年代〜1940s',
    originCountry: '日本',
    backgroundNote: '日本でも蓄音機やラジオの普及によって流行歌が大衆文化として定着。古賀政男、藤山一郎、笠置シヅ子、服部良一らが昭和歌謡の礎を築いた。',
    parents: [parent('Tin Pan Alley')],
  },
  {
    name: 'teen pop',
    originYear: 1955,
    originYearLabel: '1950s〜1960s前半',
    originCountry: 'アメリカ',
    backgroundNote:
      'ティーンポップの誕生とモータウン。戦後の経済成長とともに「ティーンエイジャー」という巨大な消費者層が誕生。ラジオ、テレビ、シングル盤を中心に、若者向けのキャッチーなポップソングが市場の中心になった。',
    parents: [parent('Tin Pan Alley')],
  },
  {
    name: 'Motown Pop',
    originYear: 1961,
    originYearLabel: '1950s〜1960s前半',
    originCountry: 'アメリカ(デトロイト)',
    backgroundNote: 'デトロイトのMotownは、ソウル／R&Bの要素を洗練されたポップスへ変換し、黒人音楽をアメリカのメインストリームへ押し上げた。',
    parents: [parent('teen pop'), parent('r&b', 'crossover')],
  },
  {
    name: 'Brill Building Pop',
    originYear: 1958,
    originYearLabel: '1950s〜1960s前半',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote: 'ニューヨークのブリル・ビルディングを拠点とした専業ソングライターたちが量産した、精緻なティーンポップ。',
    parents: [parent('teen pop')],
  },
  {
    name: '和製ポップス',
    originYear: 1959,
    originYearLabel: '1950s〜1960s前半',
    originCountry: '日本',
    backgroundNote: '海外のロカビリー／ポップスが日本へ伝わり、日本語詞による独自のポップスとして吸収・翻訳されていった時代。',
    parents: [parent('昭和歌謡'), parent('日本のロカビリー', 'crossover')],
  },
  {
    name: 'baroque pop',
    originYear: 1966,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'アメリカ / イギリス',
    backgroundNote:
      'アルバム時代とアーティスト・ポップ。The Beatlesをはじめとするアーティストの登場によって、ポップスは単純なシングル中心の大衆音楽から、アルバム全体で世界観を表現する音楽へと進化。スタジオ技術、マルチトラック録音、オーケストレーションなどがポップスの表現力を大きく拡張した。',
    parents: [parent('pop')],
  },
  {
    name: 'soft rock',
    originYear: 1970,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'アメリカ',
    backgroundNote: 'アルバム時代のポップスの中でも、親しみやすいメロディと穏やかなアレンジを特徴とするスタイル。',
    parents: [parent('pop')],
  },
  {
    name: 'psychedelic pop',
    originYear: 1967,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'イギリス',
    backgroundNote: 'サイケデリック・カルチャーの影響を受けた実験的なポップス。',
    parents: [parent('pop')],
  },
  {
    name: 'art pop',
    originYear: 1972,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'イギリス',
    backgroundNote: 'アートやコンセプトを重視した、より知的なポップス表現。',
    parents: [parent('pop')],
  },
  {
    name: 'synth-pop',
    originYear: 1980,
    originYearLabel: '1980s',
    originCountry: 'アメリカ / イギリス',
    backgroundNote:
      'MTV革命とメガ・ポップ。MTVの登場によって、ポップスターは「音楽を作る人」から音楽・映像・ファッションを統合したスターへ変化。シンセサイザーやドラムマシンなど電子楽器も普及し、ポップスのサウンドが大きく変化した。',
    parents: [parent('pop', 'crossover')],
  },
  {
    name: 'dance-pop',
    originYear: 1983,
    originYearLabel: '1980s',
    originCountry: 'アメリカ',
    backgroundNote: 'ミュージックビデオとダンスパフォーマンスを前提にした、MTV時代を象徴するポップス。',
    parents: [parent('pop')],
  },
  {
    name: 'R&B Pop',
    originYear: 1993,
    originYearLabel: '1990s',
    originCountry: 'アメリカ',
    backgroundNote:
      'CDバブルとグローバル・ポップ。CD市場の拡大によって音楽産業が巨大化。アメリカではMariah Carey、Whitney Houstonなどの圧倒的な歌唱力を持つディーヴァが世界的なスターとなった。',
    parents: [parent('pop'), parent('r&b', 'crossover')],
  },
  {
    name: 'Teen Pop Revival',
    originYear: 1996,
    originYearLabel: '1990s',
    originCountry: 'アメリカ',
    backgroundNote: '90年代後半、Spice Girls、Britney Spearsなどのティーン・ポップが再び巨大化した時代。',
    parents: [parent('teen pop')],
  },
  {
    name: 'K-Pop',
    originYear: 2008,
    originYearLabel: '2000s〜2010s',
    originCountry: '韓国',
    backgroundNote:
      'デジタル配信・EDMポップ・K-POP。アジアではK-POPが高度な音楽制作、ダンス、映像、SNS戦略を組み合わせ、世界的なポップ市場へ進出した。',
    parents: [parent('pop')],
  },
  {
    name: 'EDM Pop',
    originYear: 2010,
    originYearLabel: '2000s〜2010s',
    originCountry: '北米 / 欧州',
    backgroundNote: 'CDからデジタルダウンロード、さらにストリーミングへと音楽流通が大きく変化する中、電子音を中心としたEDMポップが世界的なチャートを席巻した。',
    parents: [parent('pop'), parent('edm', 'crossover')],
  },
  {
    name: 'Japanese Net/Vocaloid Culture',
    originYear: 2012,
    originYearLabel: '2000s〜2010s',
    originCountry: '日本',
    backgroundNote: '日本ではアイドル文化、ボーカロイド、ネット発アーティストなど独自のポップカルチャーが発展。初音ミク／VOCALOID文化を経て、米津玄師のようにネット発でメインストリームへ進出するアーティストが登場した。',
    parents: [parent('j-pop')],
  },
  {
    name: 'bedroom pop',
    originYear: 2018,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'ストリーミング・TikTok・ジャンルレス・ポップ。Spotify、YouTube、TikTokなどのプラットフォームがヒット曲の発見・拡散・消費方法を大きく変える。ベッドルームで制作した楽曲がSNSを通じて世界的ヒットになるなど、制作環境とスター誕生の構造そのものが変化している。',
    parents: [parent('pop')],
  },
  {
    name: 'hyperpop',
    originYear: 2019,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote: 'デジタル制作環境を極端に加工・誇張したサウンドを特徴とする、インターネット発のポップス。',
    parents: [parent('bedroom pop')],
  },
  {
    name: 'alternative pop',
    originYear: 2020,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote: '特定のジャンルに所属することよりも「どんな音楽的要素を組み合わせるか」が重要になった時代のポップス。',
    parents: [parent('pop')],
  },
  {
    name: 'Contemporary Pop',
    originYear: 2021,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'ヒップホップ、R&B、ロック、カントリー、エレクトロニカ、ハウス、ラテン、アフロビーツなどが自由に融合するボーダレス・ポップ。ポップは他ジャンルの終着点ではなく、常に他ジャンルを取り込み続けるハブである。',
    parents: [parent('pop')],
  },
]

// preExisting(pop, r&b, edm, 日本のロカビリー, j-pop, city pop, Japanese Dance Pop等)
// 以外に、他ジャンルのGenre History投入時に既に作成済みのジャンルへ
// 追加でエッジを張る(Cross-Genre Connection)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'Japanese Dance Pop', parentName: '和製ポップス', relationType: 'crossover' },
  { childName: 'j-pop', parentName: 'Japanese Dance Pop', relationType: 'derivation' },
  { childName: 'ニューミュージック', parentName: '和製ポップス', relationType: 'crossover' },
  { childName: 'indie pop', parentName: 'pop', relationType: 'influence' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'Tin Pan Alley', artistName: 'Bing Crosby', workTitle: 'White Christmas' },
  { genreName: 'Tin Pan Alley', artistName: 'Frank Sinatra' },
  { genreName: 'Tin Pan Alley', artistName: 'George Gershwin' },
  { genreName: 'Tin Pan Alley', artistName: 'Cole Porter' },
  { genreName: '昭和歌謡', artistName: '古賀政男', note: '[JAPAN]' },
  { genreName: '昭和歌謡', artistName: '藤山一郎', note: '[JAPAN]' },
  { genreName: '昭和歌謡', artistName: '笠置シヅ子', note: '[JAPAN]' },
  { genreName: '昭和歌謡', artistName: '服部良一', note: '[JAPAN]' },

  // ERA02
  { genreName: 'Motown Pop', artistName: 'The Supremes', workTitle: 'Stop! In the Name of Love' },
  { genreName: 'Motown Pop', artistName: 'Marvin Gaye' },
  { genreName: 'Motown Pop', artistName: 'Stevie Wonder' },
  { genreName: 'Brill Building Pop', artistName: 'The Ronettes', workTitle: 'Be My Baby' },
  { genreName: 'teen pop', artistName: 'The Beach Boys', workTitle: 'Pet Sounds' },
  { genreName: '和製ポップス', artistName: '坂本九', workTitle: '上を向いて歩こう', note: '[JAPAN]' },
  { genreName: '和製ポップス', artistName: '弘田三枝子', note: '[JAPAN]' },
  { genreName: '和製ポップス', artistName: '中尾ミエ', note: '[JAPAN]' },
  { genreName: '和製ポップス', artistName: '伊東ゆかり', note: '[JAPAN]' },

  // ERA03
  { genreName: 'psychedelic pop', artistName: 'The Beatles', workTitle: "Sgt. Pepper's Lonely Hearts Club Band" },
  { genreName: 'soft rock', artistName: 'The Carpenters', workTitle: 'Close to You' },
  { genreName: 'baroque pop', artistName: 'ABBA', workTitle: 'Dancing Queen' },
  { genreName: 'baroque pop', artistName: 'Elton John' },
  { genreName: 'art pop', artistName: 'David Bowie' },
  { genreName: 'ニューミュージック', artistName: '荒井由実', workTitle: 'ひこうき雲', note: '[JAPAN]' },
  { genreName: 'ニューミュージック', artistName: '井上陽水', note: '[JAPAN]' },
  { genreName: 'ニューミュージック', artistName: '大瀧詠一', note: '[JAPAN]' },

  // ERA04
  { genreName: 'dance-pop', artistName: 'Michael Jackson', workTitle: 'Thriller' },
  { genreName: 'dance-pop', artistName: 'Madonna', workTitle: 'Like a Virgin' },
  { genreName: 'Minneapolis Sound', artistName: 'Prince', workTitle: 'Purple Rain', classification: 'influence' },
  { genreName: 'synth-pop', artistName: 'Wham!', workTitle: 'Wake Me Up Before You Go-Go' },
  { genreName: 'synth-pop', artistName: 'Cyndi Lauper' },
  { genreName: 'Japanese Dance Pop', artistName: '松田聖子', note: '[JAPAN]' },
  { genreName: 'Japanese Dance Pop', artistName: '中森明菜', note: '[JAPAN]' },
  { genreName: 'Japanese Dance Pop', artistName: '竹内まりや', note: '[JAPAN]' },
  { genreName: 'Japanese Dance Pop', artistName: '小泉今日子', note: '[JAPAN]' },

  // ERA05
  { genreName: 'R&B Pop', artistName: 'Mariah Carey', workTitle: 'Daydream' },
  { genreName: 'R&B Pop', artistName: 'Whitney Houston' },
  { genreName: 'Teen Pop Revival', artistName: 'Spice Girls', workTitle: 'Spice' },
  { genreName: 'Teen Pop Revival', artistName: 'Britney Spears' },
  { genreName: 'Teen Pop Revival', artistName: 'Backstreet Boys' },
  { genreName: 'j-pop', artistName: '宇多田ヒカル', workTitle: 'First Love', note: '[JAPAN]' },
  { genreName: 'j-pop', artistName: '安室奈美恵', note: '[JAPAN]' },
  { genreName: 'j-pop', artistName: 'B\'z', note: '[JAPAN]' },
  { genreName: 'j-pop', artistName: 'Mr.Children', note: '[JAPAN]' },
  { genreName: 'j-pop', artistName: 'globe', note: '[JAPAN]' },
  { genreName: 'j-pop', artistName: '浜崎あゆみ', note: '[JAPAN]' },

  // ERA06
  { genreName: 'EDM Pop', artistName: 'Lady Gaga', workTitle: 'The Fame' },
  { genreName: 'EDM Pop', artistName: 'Katy Perry' },
  { genreName: 'dance-pop', artistName: 'Taylor Swift', workTitle: '1989' },
  { genreName: 'R&B Pop', artistName: 'Rihanna', classification: 'influence' },
  { genreName: 'dance-pop', artistName: 'Justin Bieber' },
  { genreName: 'K-Pop', artistName: 'BTS' },
  { genreName: 'K-Pop', artistName: 'BLACKPINK' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'AKB48', note: '[JAPAN]' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: '米津玄師', note: 'ボーカロイドPとしての活動を経てメインストリームへ進出。[JAPAN]' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'Perfume', note: '[JAPAN]' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'きゃりーぱみゅぱみゅ', note: '[JAPAN]' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'Official髭男dism', note: '[JAPAN]' },

  // ERA07
  { genreName: 'bedroom pop', artistName: 'Billie Eilish', workTitle: 'Happier Than Ever' },
  { genreName: 'bedroom pop', artistName: 'Olivia Rodrigo', workTitle: 'SOUR' },
  { genreName: 'Contemporary Pop', artistName: 'The Weeknd', workTitle: 'After Hours' },
  { genreName: 'Contemporary Pop', artistName: 'Dua Lipa' },
  { genreName: 'alternative pop', artistName: 'Charli XCX' },
  { genreName: 'alternative pop', artistName: 'Chappell Roan' },
  { genreName: 'Contemporary Pop', artistName: '藤井風', note: '[JAPAN]' },
  { genreName: 'Contemporary Pop', artistName: 'YOASOBI', note: '[JAPAN]' },
  { genreName: 'Contemporary Pop', artistName: 'Ado', note: '[JAPAN]' },
  { genreName: 'Contemporary Pop', artistName: 'Vaundy', note: '[JAPAN]' },
  { genreName: 'Contemporary Pop', artistName: 'Mrs. GREEN APPLE', note: '[JAPAN]' },
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

  const { data: popRow } = await supabase.from('genre').select('id').ilike('name', 'pop').limit(1).maybeSingle()
  if (!popRow) throw new Error('genreテーブルに"pop"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('pop', popRow.id)

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['r&b', 'edm', '日本のロカビリー', 'j-pop', 'Japanese Dance Pop', 'city pop', 'Minneapolis Sound', 'indie pop', 'ニューミュージック']
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

  console.log('完了。popのgenre id:', popRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
