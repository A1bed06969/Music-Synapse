/**
 * REGGAE GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock/funk/techno/
 * hiphop/pop/soul-genre-history.tsと同じ方針: 新規UIコードは書かず、genre /
 * genre_lineage / genre_highlight にreggaeの系譜データを投入するだけで
 * /genres/{reggaeのid} がそのままREGGAE HISTORYページとして機能する。
 * データ内容はユーザーが事前にレビュー・承認したMarkdown年表ドラフトに基づく。
 *
 * 設計判断: スカ→ロックステディ→レゲエは仕様上「最も重視するポイント」だったが、
 * この順序を素直にgenre_lineageへ落とすと reggae(子)←ska(親) という、
 * reggaeルート自身が「子」になる逆方向エッジが必要になってしまう
 * (jazz投入時のRagtime、techno投入時のKraftwerkと同じ問題だが、今回は
 * 前史がページの中心的な語りそのものなので、単なる脚注扱いにはしなかった)。
 * そこで、reggaeルート自身の発祥年を1959年(スカの誕生年)まで繰り上げ、
 * スカ／ロックステディの代表アーティストをreggaeルートの highlight
 * (classification: influence)として直接ぶら下げる形にした。これにより
 * 逆方向エッジを作らずに、スカ/ロックステディの物語をページの最初の
 * カードで丁寧に扱いつつ、以降は全て時系列が正しい前向きのエッジのみで
 * 構成できる。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-reggae-genre-history.ts
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
    name: 'reggae',
    originYear: 1959,
    originYearLabel: '1950s後半〜1970s',
    originCountry: 'ジャマイカ(キングストン)',
    backgroundNote:
      'ジャマイカン・ルーツ：スカとロックステディからレゲエの誕生へ。1962年のジャマイカ独立を背景に、ラジオ経由で流入したアメリカのR&B/ジャズを地元ミュージシャンが独自のオフビート・リズムで再解釈しスカが誕生。移動式大音量PAとDJ/セレクターによる「サウンドシステム」文化が既に確立しており、後のダブ/ダンスホールの土台となる。60年代半ば、テンポが落ち感情表現豊かなロックステディへ移行。1968年頃、さらにゆったりした「レゲエ」という言葉が定着(Toots and the Maytals "Do the Reggay" が語の初出とされる)。ラスタファリ運動と結びつき、アフリカ回帰・社会正義をテーマにしたルーツ・レゲエへと発展していく。',
  },
  {
    name: 'roots reggae',
    originYear: 1968,
    originYearLabel: '1960s後半〜1970s',
    originCountry: 'ジャマイカ',
    backgroundNote: 'ラスタファリ運動と結びつき、アフリカ回帰・社会正義をテーマにしたレゲエ。Bob Marleyが世界的普及の中心となった。',
    parents: [parent('reggae')],
  },
  {
    name: 'dub',
    originYear: 1973,
    originYearLabel: '1960s後半〜1970s',
    originCountry: 'ジャマイカ',
    backgroundNote:
      'King Tubby、Lee "Scratch" Perryがミキシングコンソールを楽器として用い、ボーカルやリズムを解体・再構築する「ダブ」を確立(リミックス文化の源流ともされる)。ウィンドラッシュ世代の移民によりイギリスでもUKレゲエ／ダブが形成され、パンク／ポストパンクとの交流も生まれた。',
    parents: [parent('reggae'), parent('roots reggae', 'crossover')],
  },
  {
    name: 'dancehall',
    originYear: 1979,
    originYearLabel: '1980年代',
    originCountry: 'ジャマイカ',
    backgroundNote:
      'ダンスホール・レゲエの台頭とデジタル化。1981年のBob Marley死去後、サウンドシステム／DJ主導のダンスホールが台頭。1985年、Wayne Smith「Under Mi Sleng Teng」(King Jammy制作、Casio内蔵リズム使用)が全編打ち込みリディムの先駆けとなり「デジタル・レゲエ」時代へ。U-Royらが発展させたトースティング(DJがリズムに乗せて語る様式)は後のヒップホップにも影響を与えた。',
    parents: [parent('reggae')],
  },
  {
    name: '日本のレゲエ受容/ダブ',
    originYear: 1983,
    originYearLabel: '1980年代',
    originCountry: '日本',
    backgroundNote:
      '1970年代、輸入盤やFM放送を通じ一部の音楽ファンにレゲエが浸透。1979年のBob Marley来日公演が大きな転機となる。80年代にはレゲエ専門クラブが登場し始め、サウンドシステム文化が輸入される。1983年結成のMUTE BEATが、日本語詞に頼らないダブ／インストゥルメンタル・レゲエで国内シーンの基礎を築いた。',
    parents: [parent('dub'), parent('dancehall', 'crossover')],
  },
  {
    name: 'Modern Dancehall',
    originYear: 1991,
    originYearLabel: '1990年代',
    originCountry: 'ジャマイカ / アメリカ',
    backgroundNote:
      'ダンスホールの世界化とヒップホップ／R&Bとの融合。Shabba Ranksの91-92年グラミー受賞などでダンスホールが世界的認知を獲得。Shaggy「Boombastic」(1995)がポップチャートに進出し、ヒップホップ／R&Bとのクロスオーバーが加速。サウンドシステム同士が競う「サウンドクラッシュ」文化も国際的に注目される。2000年代にはSean Paul「Get Busy」(2002)が世界的ヒットとなりダンスホールが完全にメインストリーム化、プロデューサー主導の「リディム」(一つのトラックに複数のアーティストが乗る制作様式)がシーンの中心的な様式として定着した。',
    parents: [parent('dancehall')],
  },
  {
    name: '日本のサウンドシステム/ダンスホール',
    originYear: 1999,
    originYearLabel: '1990年代',
    originCountry: '日本',
    backgroundNote:
      'サウンドシステム文化が本格定着。横浜拠点のMIGHTY CROWNが1999年World Clash優勝など国際的評価を得て、日本のシーンを世界水準へ押し上げる。PUSHIM、MINMIが日本語ダンスホール表現を確立し、独自シーンとして成熟した。',
    parents: [parent('日本のレゲエ受容/ダブ'), parent('Modern Dancehall', 'crossover')],
  },
  {
    name: '日本語ダンスホール大衆化',
    originYear: 2000,
    originYearLabel: '2000年代',
    originCountry: '日本',
    backgroundNote:
      '日本のレゲエシーンの拡大とリディム文化。日本語レゲエ／ダンスホールが一気に大衆化した時代。2000年結成の湘南乃風が「純恋歌」でお茶の間レベルの認知を獲得し、湘南・横須賀のシーンが可視化。横浜レゲエ祭など、クラブ／レコード店／フェスを通じたインフラが確立した。',
    parents: [parent('日本のサウンドシステム/ダンスホール')],
  },
  {
    name: 'Modern Roots',
    originYear: 2013,
    originYearLabel: '2010年代',
    originCountry: 'ジャマイカ',
    backgroundNote:
      'モダン・ルーツとレゲエの再解釈。Chronixx、Protoje、Kabaka Pyramidら若手世代が、デジタル偏重だったサウンドから再びオーガニックな生演奏ルーツ・レゲエへ回帰する「レゲエ・リバイバル」を牽引。同時期のUKではダブステップ／グライムがダブの系譜を独自に発展させた。',
    parents: [parent('roots reggae')],
  },
  {
    name: '日本のインディーレゲエ/ダブ',
    originYear: 2015,
    originYearLabel: '2010年代〜現代',
    originCountry: '日本',
    backgroundNote:
      'インディーレーベル／自主制作を軸にしたレゲエ／ダブシーンが多様化。既存のメジャーなダンスホール勢と並行し、より実験的なダブ／ベースミュージック方向への接続も進んでいる。',
    parents: [parent('日本語ダンスホール大衆化'), parent('Modern Roots', 'crossover')],
  },
  {
    name: 'Global Dancehall Fusion',
    originYear: 2020,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'アフロビーツ、レゲトン、ポップとの融合とボーダレス化。ダンスホール由来のリディムは、プエルトリコ経由で独自進化したレゲトンや西アフリカのアフロビーツにも深く影響を与え続け、両者は2020年代のグローバルポップの主要言語となっている。ジャマイカ発の音楽語法が「レゲエ」という括りを超えて世界のポップスの基盤リズムの一つとして機能している。',
    parents: [parent('reggae'), parent('Modern Dancehall', 'crossover')],
  },
]

// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
// (Cross-Genre Connection: UKベースミュージックとの接続)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'dubstep', parentName: 'dub', relationType: 'influence' },
  { childName: 'grime', parentName: 'dub', relationType: 'influence' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01(reggaeルートに直接付与: スカ/ロックステディの先行世代)
  { genreName: 'reggae', artistName: 'The Skatalites', classification: 'influence', note: 'スカを代表するインストゥルメンタル・バンド。' },
  { genreName: 'reggae', artistName: 'Prince Buster', classification: 'influence' },
  { genreName: 'reggae', artistName: 'Desmond Dekker', workTitle: '007 (Shanty Town)', classification: 'influence' },
  { genreName: 'reggae', artistName: 'Alton Ellis', classification: 'influence', note: '「ロックステディの父」と呼ばれる。' },

  // ERA02
  { genreName: 'roots reggae', artistName: 'Bob Marley & The Wailers', workTitle: 'Catch a Fire', eventYear: 1973 },
  { genreName: 'roots reggae', artistName: 'Bob Marley & The Wailers', workTitle: 'Exodus', eventYear: 1977 },
  { genreName: 'roots reggae', artistName: 'Burning Spear', workTitle: 'Marcus Garvey' },
  { genreName: 'dub', artistName: 'Lee "Scratch" Perry & The Upsetters', workTitle: 'Super Ape', eventYear: 1976 },
  { genreName: 'dub', artistName: 'King Tubby', workTitle: 'Dub from the Roots' },

  // ERA03
  { genreName: 'dancehall', artistName: 'Yellowman' },
  { genreName: 'dancehall', artistName: 'Wayne Smith', workTitle: 'Under Mi Sleng Teng', eventYear: 1985 },
  { genreName: 'dancehall', artistName: 'U-Roy', note: 'トースティング(DJスタイル)の先駆者。' },
  { genreName: 'dancehall', artistName: 'Eek-A-Mouse' },
  { genreName: '日本のレゲエ受容/ダブ', artistName: 'MUTE BEAT', note: '日本語詞に頼らないダブ/インストゥルメンタル・レゲエで国内シーンの基礎を築いた。[JAPAN]' },

  // ERA04
  { genreName: 'Modern Dancehall', artistName: 'Shabba Ranks' },
  { genreName: 'Modern Dancehall', artistName: 'Shaggy', workTitle: 'Boombastic', eventYear: 1995 },
  { genreName: 'Modern Dancehall', artistName: 'Buju Banton', workTitle: "'Til Shiloh", eventYear: 1995 },
  { genreName: '日本のサウンドシステム/ダンスホール', artistName: 'MIGHTY CROWN', note: '1999年World Clash優勝など、国際的評価を得た横浜拠点のサウンドシステム。[JAPAN]' },
  { genreName: '日本のサウンドシステム/ダンスホール', artistName: 'PUSHIM', note: '[JAPAN]' },
  { genreName: '日本のサウンドシステム/ダンスホール', artistName: 'MINMI', note: '[JAPAN]' },

  // ERA05
  { genreName: 'Modern Dancehall', artistName: 'Sean Paul', workTitle: 'Get Busy', eventYear: 2002 },
  { genreName: 'Modern Dancehall', artistName: 'Damian Marley', workTitle: 'Welcome to Jamrock', eventYear: 2005 },
  { genreName: '日本語ダンスホール大衆化', artistName: '湘南乃風', workTitle: '純恋歌', note: '[JAPAN]' },
  { genreName: '日本語ダンスホール大衆化', artistName: 'MINMI', workTitle: 'The Perfect Vision', note: '[JAPAN]' },

  // ERA06
  { genreName: 'Modern Roots', artistName: 'Chronixx', workTitle: 'Chrome Nation' },
  { genreName: 'Modern Roots', artistName: 'Protoje' },
  { genreName: 'Modern Roots', artistName: 'Kabaka Pyramid' },

  // ERA07
  { genreName: 'Global Dancehall Fusion', artistName: 'Koffee', workTitle: 'Gifted', eventYear: 2019 },
  { genreName: 'Global Dancehall Fusion', artistName: 'Popcaan' },
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

  const { data: reggaeRow } = await supabase.from('genre').select('id').ilike('name', 'reggae').limit(1).maybeSingle()
  if (!reggaeRow) throw new Error('genreテーブルに"reggae"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('reggae', reggaeRow.id)

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['dubstep', 'grime']
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

  console.log('完了。reggaeのgenre id:', reggaeRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
