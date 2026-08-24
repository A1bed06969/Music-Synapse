/**
 * HIP HOP GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock/funk/techno-
 * genre-history.tsと同じ方針: 新規UIコードは書かず、genre / genre_lineage /
 * genre_highlight にhip hopの系譜データを投入するだけで /genres/{hip hopのid} が
 * そのままHIP HOP HISTORYページとして機能する(ユーザー自身が今回、既存6ジャンルと
 * 完全に同じUIの再利用を明示的に指定しているため、独自UIの要否を検討する必要はない)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-hiphop-genre-history.ts
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
    name: 'hip hop',
    originYear: 1973,
    originYearLabel: '1970年代後半',
    originCountry: 'アメリカ(ニューヨーク・ブロンクス)',
    backgroundNote:
      '誕生期・ブロックパーティ。1970年代のニューヨーク・ブロンクスで、ブロックパーティを中心にヒップホップ文化が形成される。DJ Kool Hercが2台のターンテーブルを使い、ファンクやソウルのレコードからドラムブレイク部分を繰り返し再生する「ブレイク」を生み出したことが重要な起点となる。そこからDJ・MC・ブレイクダンス・グラフィティというヒップホップの主要な文化要素が形成されていく。',
  },
  {
    name: 'Old School Hip Hop',
    originYear: 1980,
    originYearLabel: '1980年代',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote:
      'オールドスクールから黄金期へ。サンプラーやドラムマシンなどの電子機材が普及し、ヒップホップの音楽制作が急速に進化。Run-D.M.C.はロックとの融合によってヒップホップをメインストリームへ押し上げ、Public Enemyは社会・政治的メッセージを強く打ち出した。Beastie Boysなどの登場により、ヒップホップはニューヨークのローカルカルチャーから世界的な若者文化へ拡大した。',
    parents: [parent('hip hop')],
  },
  {
    name: '日本語ラップ黎明期',
    originYear: 1986,
    originYearLabel: '1980年代',
    originCountry: '日本(東京・原宿・渋谷)',
    backgroundNote:
      '日本でも原宿・渋谷を中心にブレイクダンス、DJ、ラップなどが紹介され、日本のヒップホップ文化の基礎が形成される。いとうせいこう、TINNIE PUNX、吉幾三らによって日本語によるラップ表現の萌芽が見られた。',
    parents: [parent('Old School Hip Hop')],
  },
  {
    name: 'Golden Era',
    originYear: 1993,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: 'アメリカ(ニューヨーク / ロサンゼルス)',
    backgroundNote:
      'ゴールデン・エラ／東西の多様化。1990年代に入り、ヒップホップは東海岸と西海岸で異なる音楽的進化を遂げる。西海岸ではDr. DreらがP-Funkなどを大胆にサンプリングしたGファンクを確立。一方、ニューヨークではNas、The Notorious B.I.G.らがサンプル主体の緻密なビートと高度なライミングを発展させ、ヒップホップ史上最も重要な作品が集中する時代を形成した。',
    parents: [parent('Old School Hip Hop')],
  },
  {
    name: 'east coast hip hop',
    originYear: 1993,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote: 'サンプル主体の緻密なビートと高度なライミングを特徴とする、ニューヨーク発のヒップホップ。',
    parents: [parent('Golden Era')],
  },
  {
    name: 'Boom Bap',
    originYear: 1993,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote: 'east coast hip hopを象徴する、力強いドラムサウンドを特徴とするビート・スタイル。',
    parents: [parent('east coast hip hop')],
  },
  {
    name: 'west coast hip hop',
    originYear: 1992,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: 'アメリカ(ロサンゼルス)',
    backgroundNote: 'ロサンゼルスを中心に発展した、Gファンクなどを特徴とするヒップホップ。',
    parents: [parent('Golden Era')],
  },
  {
    name: 'gangsta rap',
    originYear: 1988,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: 'アメリカ(ロサンゼルス)',
    backgroundNote: 'ストリートの現実をリアルに描写するギャングスタ・ラップ。',
    parents: [parent('west coast hip hop')],
  },
  {
    name: '日本語ラップの成立',
    originYear: 1994,
    originYearLabel: '1990年代前半〜中盤',
    originCountry: '日本',
    backgroundNote: '日本でも日本語によるラップ表現が本格的に成立。スチャダラパー『今夜はブギー・バック』のヒットを筆頭に、ECD、BUDDHA BRAND、RHYMESTER、キングギドラらが独自のシーンを形成した。',
    parents: [parent('日本語ラップ黎明期')],
  },
  {
    name: 'Southern Rap',
    originYear: 1995,
    originYearLabel: '1990年代後半〜2000年代',
    originCountry: 'アメリカ南部(アトランタ / ヒューストン)',
    backgroundNote:
      'メインストリーム化とサウスの台頭。ヒップホップが世界的なポップミュージックの中心へ進出。アトランタやヒューストンなどアメリカ南部から、重低音と独特のリズムを持つサザン・ラップが台頭した。',
    parents: [parent('hip hop')],
  },
  {
    name: 'Crunk',
    originYear: 2000,
    originYearLabel: '1990年代後半〜2000年代',
    originCountry: 'アメリカ南部',
    backgroundNote: 'Southern Rapから派生した、クラブ向けの高エネルギーなスタイル。',
    parents: [parent('Southern Rap')],
  },
  {
    name: 'pop rap',
    originYear: 2001,
    originYearLabel: '1990年代後半〜2000年代',
    originCountry: 'グローバル',
    backgroundNote: 'Eminem、50 Cent、Jay-Z、Kanye Westなどが世界規模の成功を収め、ヒップホップが世界的なポップミュージックへ進出した時代を象徴するスタイル。',
    parents: [parent('hip hop')],
  },
  {
    name: '日本語ラップの拡大',
    originYear: 2001,
    originYearLabel: '1990年代後半〜2000年代',
    originCountry: '日本',
    backgroundNote:
      '日本ではB-BOY PARKなどのイベントや日本語ラップシーンが拡大。RIP SLYME、KICK THE CAN CREWなどがチャートを席巻し、日本語ラップが一般層にも広く浸透した。',
    parents: [parent('日本語ラップの成立')],
  },
  {
    name: 'trap',
    originYear: 2010,
    originYearLabel: '2010年代',
    originCountry: 'アメリカ(アトランタ)',
    backgroundNote:
      'トラップの世界的席巻とネット時代。アトランタを中心に発展したトラップが世界的なスタンダードへ成長。高速ハイハット、808系の重低音、細分化されたリズムがヒップホップのみならずポップミュージック全体へ影響を与えた。SoundCloud、YouTube、SNSなどの普及により、従来のレコード会社を経由せずに作品を発表するDIY型アーティストが急増した。',
    parents: [parent('Southern Rap')],
  },
  {
    name: 'Cloud Rap',
    originYear: 2012,
    originYearLabel: '2010年代',
    originCountry: 'アメリカ',
    backgroundNote: 'ドリーミーで浮遊感のあるビートを特徴とする、SoundCloud発のスタイル。',
    parents: [parent('trap')],
  },
  {
    name: 'Drill',
    originYear: 2012,
    originYearLabel: '2010年代',
    originCountry: 'アメリカ(シカゴ)',
    backgroundNote: 'シカゴで生まれた、暗く緊迫感のあるドリルサウンド。後にUKやニューヨークへ広がっていく。',
    parents: [parent('trap')],
  },
  {
    name: 'UK Drill',
    originYear: 2015,
    originYearLabel: '2010年代',
    originCountry: 'イギリス(ロンドン)',
    backgroundNote: 'シカゴ発のDrillがイギリスへ渡り、UK独自の音響とスラングで再解釈されたスタイル。NY Drillなど、各地域独自の派生形をさらに生み出した。',
    parents: [parent('Drill')],
  },
  {
    name: '日本のフリースタイル/現代ラップ',
    originYear: 2015,
    originYearLabel: '2010年代',
    originCountry: '日本',
    backgroundNote: '日本では「フリースタイルダンジョン」などをきっかけにフリースタイル・ラップが大衆的な注目を集める。BAD HOP、PUNPEEらが新しい世代のシーンを形成した。',
    parents: [parent('日本語ラップの拡大')],
  },
  {
    name: 'alternative hip hop',
    originYear: 2011,
    originYearLabel: '2010年代',
    originCountry: 'アメリカ',
    backgroundNote: '従来のヒップホップの型にとらわれない、実験的・内省的な表現を特徴とするスタイル。',
    parents: [parent('hip hop', 'influence')],
  },
  {
    name: 'Contemporary Hip Hop',
    originYear: 2020,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'グローバル化・ジャンル融合・ボーダレス化。ヒップホップは単独のジャンルではなく、現代ポップミュージックそのものの基盤へ変化。アフロビーツ、ダンスホール、エレクトロニカ、ロック、ジャズ、R&Bなどとの融合も加速している。TikTok、YouTube、ストリーミングなどのアルゴリズム型プラットフォームがヒット形成に大きな影響を与える。',
    parents: [parent('hip hop')],
  },
  {
    name: 'Jersey Club',
    originYear: 2018,
    originYearLabel: '2020年代〜現代',
    originCountry: 'アメリカ(ニュージャージー)',
    backgroundNote: 'ニュージャージー発の、細かく刻まれたキックとサンプルの反復を特徴とするクラブ・ミュージック。',
    parents: [parent('Contemporary Hip Hop')],
  },
  {
    name: 'Rage',
    originYear: 2020,
    originYearLabel: '2020年代〜現代',
    originCountry: 'アメリカ',
    backgroundNote: '歪んだシンセと激しいエネルギーを特徴とする、Trap由来の現代スタイル。',
    parents: [parent('trap')],
  },
  {
    name: '現代日本語ラップ',
    originYear: 2021,
    originYearLabel: '2020年代〜現代',
    originCountry: '日本',
    backgroundNote:
      '日本でも海外のビート・サウンドを取り入れながら、日本語特有のリズムや言語感覚を生かした独自のヒップホップが発展している。「海外から輸入された文化→日本語ラップの成立→日本独自のシーン形成→世界との直接接続」という独自の歴史をたどってきた。',
    parents: [parent('日本のフリースタイル/現代ラップ')],
  },
]

// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
// (Cross-Genre Connection)。electroは元々techno側から作成済み(Electro-Hip Hop)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'electro', parentName: 'hip hop', relationType: 'crossover' },
  { childName: 'jazz rap', parentName: 'Golden Era', relationType: 'crossover' },
  { childName: 'G-Funk', parentName: 'gangsta rap', relationType: 'crossover' },
  { childName: 'hardcore hip hop', parentName: 'gangsta rap', relationType: 'crossover' },
  { childName: 'underground hip hop', parentName: 'hip hop', relationType: 'influence' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'hip hop', artistName: 'DJ Kool Herc' },
  { genreName: 'electro', artistName: 'Afrika Bambaataa', workTitle: 'Planet Rock', classification: 'influence' },
  { genreName: 'hip hop', artistName: 'Grandmaster Flash' },
  { genreName: 'hip hop', artistName: 'The Sugarhill Gang', workTitle: "Rapper's Delight" },
  { genreName: 'hip hop', artistName: 'Grandmaster Flash and the Furious Five', workTitle: 'The Message' },

  // ERA02
  { genreName: 'Old School Hip Hop', artistName: 'Run-D.M.C.', workTitle: 'Run-D.M.C.' },
  { genreName: 'Old School Hip Hop', artistName: 'Run-D.M.C.', workTitle: 'Walk This Way' },
  { genreName: 'Old School Hip Hop', artistName: 'Public Enemy', workTitle: 'It Takes a Nation of Millions to Hold Us Back' },
  { genreName: 'Old School Hip Hop', artistName: 'Beastie Boys', workTitle: 'Licensed to Ill' },
  { genreName: '日本語ラップ黎明期', artistName: 'いとうせいこう', note: '日本語によるラップ表現の萌芽。[JAPAN]' },
  { genreName: '日本語ラップ黎明期', artistName: 'TINNIE PUNX', note: '[JAPAN]' },
  { genreName: '日本語ラップ黎明期', artistName: '吉幾三', note: '早期の日本語ラップ表現の一例。[JAPAN]' },

  // ERA03
  { genreName: 'west coast hip hop', artistName: 'Dr. Dre', workTitle: 'The Chronic' },
  { genreName: 'west coast hip hop', artistName: 'Snoop Dogg', workTitle: 'Doggystyle' },
  { genreName: 'east coast hip hop', artistName: 'Nas', workTitle: 'Illmatic' },
  { genreName: 'east coast hip hop', artistName: 'The Notorious B.I.G.', workTitle: 'Ready to Die' },
  { genreName: 'east coast hip hop', artistName: 'Wu-Tang Clan', workTitle: 'Enter the Wu-Tang' },
  { genreName: 'jazz rap', artistName: 'A Tribe Called Quest', workTitle: 'The Low End Theory' },
  { genreName: '日本語ラップの成立', artistName: 'スチャダラパー', workTitle: '今夜はブギー・バック', note: '[JAPAN]' },
  { genreName: '日本語ラップの成立', artistName: 'ECD', note: '[JAPAN]' },
  { genreName: '日本語ラップの成立', artistName: 'BUDDHA BRAND', note: '[JAPAN]' },
  { genreName: '日本語ラップの成立', artistName: 'RHYMESTER', note: '[JAPAN]' },
  { genreName: '日本語ラップの成立', artistName: 'キングギドラ', note: '[JAPAN]' },

  // ERA04
  { genreName: 'pop rap', artistName: 'Eminem', workTitle: 'The Marshall Mathers LP' },
  { genreName: 'pop rap', artistName: 'Jay-Z', workTitle: 'The Blueprint' },
  { genreName: 'pop rap', artistName: 'Kanye West', workTitle: 'The College Dropout' },
  { genreName: 'Southern Rap', artistName: 'Outkast', workTitle: 'Speakerboxxx/The Love Below' },
  { genreName: 'Southern Rap', artistName: '50 Cent', workTitle: "Get Rich or Die Tryin'" },
  { genreName: '日本語ラップの拡大', artistName: 'Zeebra', note: '[JAPAN]' },
  { genreName: '日本語ラップの拡大', artistName: 'K DUB SHINE', note: '[JAPAN]' },
  { genreName: '日本語ラップの拡大', artistName: 'RIP SLYME', note: '[JAPAN]' },
  { genreName: '日本語ラップの拡大', artistName: 'KICK THE CAN CREW', note: '[JAPAN]' },

  // ERA05
  { genreName: 'alternative hip hop', artistName: 'Kendrick Lamar', workTitle: 'good kid, m.A.A.d city' },
  { genreName: 'alternative hip hop', artistName: 'Kendrick Lamar', workTitle: 'To Pimp a Butterfly' },
  { genreName: 'trap', artistName: 'Drake', workTitle: 'Take Care' },
  { genreName: 'trap', artistName: 'Future', workTitle: 'DS2' },
  { genreName: 'trap', artistName: 'Travis Scott', workTitle: 'Rodeo' },
  { genreName: 'trap', artistName: 'Migos', workTitle: 'Culture' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'BAD HOP', note: '[JAPAN]' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'PUNPEE', note: '[JAPAN]' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'JP THE WAVY', note: '[JAPAN]' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'Awich', note: '[JAPAN]' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'Creepy Nuts', note: '[JAPAN]' },
  { genreName: '日本のフリースタイル/現代ラップ', artistName: 'KOHH', note: '[JAPAN]' },

  // ERA06
  { genreName: 'Contemporary Hip Hop', artistName: 'Kendrick Lamar', workTitle: 'Mr. Morale & the Big Steppers' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Central Cee' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Little Simz' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Dave' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Travis Scott' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Tyler, The Creator' },
  { genreName: 'Contemporary Hip Hop', artistName: 'Doja Cat', classification: 'influence' },
  { genreName: '現代日本語ラップ', artistName: 'CreativeDrugStore', note: '[JAPAN]' },
  { genreName: '現代日本語ラップ', artistName: 'BIM', note: '[JAPAN]' },
  { genreName: '現代日本語ラップ', artistName: 'ZORN', note: '[JAPAN]' },
  { genreName: '現代日本語ラップ', artistName: 'Watson', note: '[JAPAN]' },
  { genreName: '現代日本語ラップ', artistName: '¥ellow Bucks', note: '[JAPAN]' },
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

  const { data: hiphopRow } = await supabase.from('genre').select('id').ilike('name', 'hip hop').limit(1).maybeSingle()
  if (!hiphopRow) throw new Error('genreテーブルに"hip hop"が見つかりません。')

  const genreIdByName = new Map<string, string>()

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = [
    'hip hop',
    'electro',
    'jazz rap',
    'g-funk',
    'east coast hip hop',
    'west coast hip hop',
    'gangsta rap',
    'hardcore hip hop',
    'underground hip hop',
    'pop rap',
    'trap',
    'alternative hip hop',
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

  console.log('完了。hip hopのgenre id:', hiphopRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
