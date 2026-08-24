/**
 * SOUL GENRE HISTORYのデータ投入スクリプト。populate-jazz/folk/rock/funk/techno/
 * hiphop/pop-genre-history.tsと同じ方針: 新規UIコードは書かず、genre /
 * genre_lineage / genre_highlight にsoulの系譜データを投入するだけで
 * /genres/{soulのid} がそのままSOUL HISTORYページとして機能する。
 *
 * 仕様書にあった「日本への伝承ライン/サブジャンル派生ラインをON/OFF可能にする」
 * というトグルUIは追加しない。既存のGENRE EVOLUTIONツリー(ホバーでの系譜
 * ハイライト)とRegion Interaction(地域クリックでのハイライト)がすでに
 * 同じ目的を果たしており、ジャンルごとに専用のトグルスイッチを増やすと
 * 汎用コンポーネントの一貫性が崩れるため。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-soul-genre-history.ts
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
    name: 'soul',
    originYear: 1958,
    originYearLabel: '1950s後半〜1960s前半',
    originCountry: 'アメリカ(デトロイト / メンフィス)',
    backgroundNote:
      '誕生期・モータウンとメンフィス・ソウル。ゴスペルの熱い歌唱スタイルとリズム＆ブルース(R&B)が融合し、現代的なソウル・ミュージックが形成される。デトロイトではモータウン・レコードが洗練されたポップ性と黒人音楽のグルーヴを融合。一方、メンフィスを中心とする南部では、より泥臭く身体的でエモーショナルなサザン・ソウルが発展した。日本でも進駐軍や輸入盤、ラジオなどを通じて、一部の音楽ファンにソウル／R&Bが知られるようになる。',
  },
  {
    name: 'Southern Soul',
    originYear: 1965,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: 'アメリカ(メンフィス / アトランタ)',
    backgroundNote:
      '黄金期・サザンソウルとメンフィス・ソウル。Stax Recordsなどを中心に、ホーンセクションとタイトなリズム隊による力強くファンキーなソウルが発展。公民権運動とも結びつき、黒人の尊厳、社会問題、自由をテーマにした楽曲が増加。ソウルが単なるダンス音楽から、社会やアイデンティティを語る音楽へと広がっていった。',
    parents: [parent('soul')],
  },
  {
    name: 'Memphis Soul',
    originYear: 1965,
    originYearLabel: '1960s中盤〜1970s前半',
    originCountry: 'アメリカ(メンフィス)',
    backgroundNote: 'Stax Recordsを拠点とした、ホーンとタイトなリズム隊を特徴とするディープなソウル。',
    parents: [parent('Southern Soul')],
  },
  {
    name: 'New Soul',
    originYear: 1971,
    originYearLabel: '1970s中盤〜1970s後半',
    originCountry: 'アメリカ(フィラデルフィア / デトロイト / ニューヨーク)',
    backgroundNote:
      'ニュー・ソウルとフィリー・ソウル。60年代の社会運動を経て、ソウルはより内省的・社会的・アルバム志向へ進化。Marvin GayeやStevie Wonderらが、戦争、貧困、人種問題、愛、人生などをコンセプチュアルに描く「ニュー・ソウル」を確立した。日本でもラジオや輸入盤を通じてソウル／R&Bというジャンル名が定着し、ニューミュージックや歌謡曲のアレンジにも大きな影響を与えた。',
    parents: [parent('soul')],
  },
  {
    name: 'philly soul',
    originYear: 1973,
    originYearLabel: '1970s中盤〜1970s後半',
    originCountry: 'アメリカ(フィラデルフィア)',
    backgroundNote: '豪華なストリングスと洗練されたリズム、甘美なメロディを持つフィラデルフィア発のソウル。後のディスコやブラック・コンテンポラリーへ繋がる。',
    parents: [parent('New Soul')],
  },
  {
    name: 'quiet storm',
    originYear: 1980,
    originYearLabel: '1980年代',
    originCountry: 'アメリカ(ニューヨーク / ロサンゼルス)',
    backgroundNote:
      'Quiet Stormとブラック・コンテンポラリー。70年代までの生演奏主体のソウル／ファンクから、シンセサイザーや電子ドラムを取り入れた洗練された都会的サウンドへ移行。夜のラジオ番組から広がったQuiet Stormは、滑らかでメロウなバラードを中心に独自の市場を形成した。',
    parents: [parent('soul')],
  },
  {
    name: 'hip hop soul',
    originYear: 1991,
    originYearLabel: '1990s',
    originCountry: 'アメリカ',
    backgroundNote:
      'ヒップホップとの融合・ニュー・ジャック・スウィングとR&B。ヒップホップの重いビートとソウル／R&Bのボーカルを融合したニュー・ジャック・スウィングが登場。ソウルはさらにダンサブルになり、ヒップホップとの境界線が急速に薄くなった。',
    parents: [parent('new jack swing'), parent('soul', 'crossover')],
  },
  {
    name: 'contemporary r&b',
    originYear: 1996,
    originYearLabel: '1990s',
    originCountry: 'アメリカ',
    backgroundNote: '90年代後半、より洗練されたコンテンポラリーR&Bへ発展。日本でもJ-R&Bというシーンが形成された。',
    parents: [parent('hip hop soul')],
  },
  {
    name: 'Modern Soul',
    originYear: 2015,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'レトロ・ソウルとジャンルレス化。ソウルは特定ジャンルとして閉じるのではなく、ヒップホップ、ファンク、ポップ、ジャズ、エレクトロニカなどと自由に融合する音楽へ変化。Bruno MarsやSilk Sonicによって70〜80年代のファンク／ソウルのサウンドが現代のポップスとして大規模にリバイバルした。一方でインディーシーンでは、ローファイな質感や電子音、ジャズ的コード、ヒップホップのビートを組み合わせた新しいソウル表現が世界各地で生まれている。',
    parents: [parent('neo soul'), parent('alternative r&b', 'crossover')],
  },
  {
    name: '日本のソウル受容',
    originYear: 1960,
    originYearLabel: '1950s後半〜1960s前半',
    originCountry: '日本',
    backgroundNote: '進駐軍のクラブ、輸入盤、ラジオなどを通じて、日本でもソウル／R&Bが一部の音楽ファンに知られるようになっていった受容期。',
    parents: [parent('soul')],
  },
  {
    name: 'ブラコンブーム',
    originYear: 1982,
    originYearLabel: '1980年代',
    originCountry: '日本',
    backgroundNote: '日本では「ブラコン(ブラック・コンテンポラリー)」という呼称で大きなブームとなり、久保田利伸など日本人アーティストの音楽性にも強く影響した。',
    parents: [parent('日本のソウル受容'), parent('quiet storm', 'crossover')],
  },
  {
    name: 'J-R&B',
    originYear: 1995,
    originYearLabel: '1990s',
    originCountry: '日本',
    backgroundNote: '本格的なブラックミュージックの語法を持つアーティストがチャートの中心へ進出し、日本でJ-R&Bというシーンが形成された。',
    parents: [parent('ブラコンブーム'), parent('hip hop soul', 'crossover')],
  },
  {
    name: '日本のネオソウル/現代',
    originYear: 2015,
    originYearLabel: '2010s〜現代',
    originCountry: '日本',
    backgroundNote: '日本でも、ソウル／R&Bを直接的に継承するだけでなく、ポップ、ヒップホップ、エレクトロニカ、ジャズなどを横断するアーティストが増えている。',
    parents: [parent('J-R&B'), parent('Modern Soul', 'crossover')],
  },
]

// preExisting(soul, neo soul, new jack swing, alternative r&b等)以外に、
// 他ジャンルのGenre History投入時に既に作成済みのジャンルへ追加でエッジを張る
// (Cross-Genre Connection)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'Motown Pop', parentName: 'soul', relationType: 'crossover' },
  { childName: 'neo soul', parentName: 'soul', relationType: 'crossover' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'soul', artistName: 'Ray Charles', workTitle: "What'd I Say", eventYear: 1959 },
  { genreName: 'soul', artistName: 'Sam Cooke', workTitle: 'A Change Is Gonna Come', eventYear: 1964 },
  { genreName: 'soul', artistName: 'Marvin Gaye', workTitle: 'Stubborn Kind of Fellow' },

  // ERA02
  { genreName: 'Memphis Soul', artistName: 'Otis Redding', workTitle: "(Sittin' On) The Dock of the Bay", eventYear: 1968 },
  { genreName: 'Southern Soul', artistName: 'Aretha Franklin', workTitle: 'Respect', eventYear: 1967 },
  { genreName: 'Memphis Soul', artistName: 'Wilson Pickett', workTitle: 'In the Midnight Hour' },
  { genreName: 'Southern Soul', artistName: 'The Staple Singers', workTitle: "I'll Take You There" },

  // ERA03
  { genreName: 'New Soul', artistName: 'Marvin Gaye', workTitle: "What's Going On", eventYear: 1971 },
  { genreName: 'New Soul', artistName: 'Stevie Wonder', workTitle: 'Songs in the Key of Life', eventYear: 1976 },
  { genreName: 'philly soul', artistName: "The O'Jays", workTitle: 'For the Love of Money' },
  { genreName: 'philly soul', artistName: 'Harold Melvin & the Blue Notes', workTitle: "If You Don't Know Me by Now" },

  // ERA04
  { genreName: 'quiet storm', artistName: 'Luther Vandross', workTitle: 'Never Too Much', eventYear: 1981 },
  { genreName: 'quiet storm', artistName: 'Sade', workTitle: 'Diamond Life' },
  { genreName: 'quiet storm', artistName: 'Anita Baker', workTitle: 'Rapture' },
  { genreName: 'quiet storm', artistName: 'Lionel Richie' },
  { genreName: 'quiet storm', artistName: 'Whitney Houston' },
  { genreName: 'ブラコンブーム', artistName: '久保田利伸', workTitle: 'SHAKE IT PARADISE', note: '[JAPAN]' },

  // ERA05
  { genreName: 'hip hop soul', artistName: 'Guy', workTitle: 'Groove Me' },
  { genreName: 'contemporary r&b', artistName: 'Boyz II Men', workTitle: 'End of the Road', eventYear: 1992 },
  { genreName: 'contemporary r&b', artistName: 'TLC' },
  { genreName: 'contemporary r&b', artistName: 'Janet Jackson', workTitle: 'janet.' },
  { genreName: 'J-R&B', artistName: 'MISIA', workTitle: 'Mother Father Brother Sister', note: '[JAPAN]' },
  { genreName: 'J-R&B', artistName: 'UA', note: '[JAPAN]' },

  // ERA06
  { genreName: 'neo soul', artistName: "D'Angelo", workTitle: 'Voodoo', eventYear: 2000 },
  { genreName: 'neo soul', artistName: 'Erykah Badu', workTitle: "Mama's Gun" },
  { genreName: 'neo soul', artistName: 'Amy Winehouse', workTitle: 'Back to Black', eventYear: 2006 },
  { genreName: 'neo soul', artistName: 'Leon Bridges', workTitle: 'Coming Home' },
  { genreName: 'neo soul', artistName: 'Jill Scott' },

  // ERA07
  { genreName: 'Modern Soul', artistName: 'Silk Sonic', workTitle: 'An Evening with Silk Sonic', eventYear: 2021 },
  { genreName: 'Modern Soul', artistName: 'Bruno Mars', workTitle: '24K Magic' },
  { genreName: 'Modern Soul', artistName: 'Anderson .Paak', workTitle: 'Malibu' },
  { genreName: 'Modern Soul', artistName: 'Thundercat' },
  { genreName: 'Modern Soul', artistName: 'Cleo Sol' },
  { genreName: 'Modern Soul', artistName: 'Steve Lacy', workTitle: 'Gemini Rights' },
  { genreName: '日本のネオソウル/現代', artistName: 'iri', note: '[JAPAN]' },
  { genreName: '日本のネオソウル/現代', artistName: 'SIRUP', note: '[JAPAN]' },
  { genreName: '日本のネオソウル/現代', artistName: '藤井風', workTitle: 'LOVE ALL SERVE ALL', note: '[JAPAN]' },
  { genreName: '日本のネオソウル/現代', artistName: 'Nulbarich', note: '[JAPAN]' },
  { genreName: '日本のネオソウル/現代', artistName: 'Chara', note: '[JAPAN]' },
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

  const { data: soulRow } = await supabase.from('genre').select('id').ilike('name', 'soul').limit(1).maybeSingle()
  if (!soulRow) throw new Error('genreテーブルに"soul"が見つかりません。')

  const genreIdByName = new Map<string, string>()

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['soul', 'neo soul', 'new jack swing', 'alternative r&b']
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

  console.log('完了。soulのgenre id:', soulRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
