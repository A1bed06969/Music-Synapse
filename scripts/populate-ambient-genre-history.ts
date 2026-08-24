/**
 * AMBIENT GENRE HISTORYのデータ投入スクリプト。populate-reggae-genre-history.ts
 * などと同じ方針: 新規UIコードは書かず、genre / genre_lineage / genre_highlight に
 * ambientの系譜データを投入するだけで /genres/{ambientのid} がそのまま
 * AMBIENT HISTORYページとして機能する。データ内容はユーザーが事前にレビュー・
 * 承認したMarkdown年表ドラフトに基づく。
 *
 * 設計判断: Erik Satie、John Cage、ミニマル・ミュージックの巨匠たちはAmbientという
 * 語が確立する(1975年 Brian Eno『Discreet Music』)より前の世代であり、reggae投入時の
 * スカ/ロックステディと同じ「前史がページの中心的な語りそのもの」というケース。
 * そのためambientルート自身の発祥年をEnoの活動開始(1975年)に設定し、Satie/Cage/
 * Reich/Riley/武満徹/Schaefferはルートのhighlight(classification: influence)として
 * 直接ぶら下げる形にした(逆方向エッジを作らないため)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-ambient-genre-history.ts
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
    name: 'ambient',
    originYear: 1975,
    originYearLabel: '1960年代以前〜1970年代後半',
    originCountry: 'イギリス / フランス / アメリカ',
    backgroundNote:
      '実験音楽・環境音楽・ミニマルの萌芽から「アンビエント」の誕生へ。Erik Satieが20世紀初頭に提示した「家具の音楽」(Musique d\'ameublement)――注意を引かず空間に存在する音楽という思想が最古の思想的ルーツ。1940年代末、Pierre Schaefferがミュジーク・コンクレートを確立。John Cageは偶然性や環境音そのものを作品化する実験音楽を展開。1960年代、La Monte Young、Terry Riley、Steve Reichらが反復パターンを軸としたミニマル・ミュージックを確立し、後のアンビエントの構造的基盤となった。Brian Enoは1975年、事故療養中に小音量のレコードが環境音と溶け合う体験から着想を得て『Discreet Music』を発表(アンビエント概念の実質的な先駆作)。1978年『Ambient 1: Music for Airports』のライナーノーツで「Ambient」という語と概念を明確に定義した。クラウトロックのCluster、Harold Buddとの協働も、アンビエントの音響的な幅を広げた。',
  },
  {
    name: '環境音楽',
    originYear: 1982,
    originYearLabel: '1980年代',
    originCountry: '日本',
    backgroundNote:
      '日本の環境音楽とアンビエントの多様化。バブル期の都市開発・商業空間の拡大とともに、日本では企業・店舗・美術館・家電製品などと結びついた「空間に存在する音楽」という独自の概念「環境音楽」が発展。吉村弘、芦川聡らが1980年代前半にサウンドデザイン／環境音楽の実践を展開し、宮下富実夫もヒーリング／環境音楽の分野で重要な作品を残した。日本コロムビアの環境音楽シリーズなど、レコード会社主導の企画としても展開された。',
    parents: [parent('ambient')],
  },
  {
    name: 'new age',
    originYear: 1980,
    originYearLabel: '1980年代',
    originCountry: 'アメリカ / イギリス',
    backgroundNote: '欧米ではアンビエントがニューエイジ・ミュージックと接近しつつ、独自の展開を続けた。',
    parents: [parent('ambient')],
  },
  {
    name: 'dark ambient',
    originYear: 1993,
    originYearLabel: '1990年代',
    originCountry: 'グローバル',
    backgroundNote:
      'アンビエント・テクノ／IDM／ダーク・アンビエントへの拡張。産業的・不穏な音響美学を特徴とするダーク・アンビエントが発展した。',
    parents: [parent('ambient')],
  },
  {
    name: 'drone',
    originYear: 2002,
    originYearLabel: '2000年代',
    originCountry: 'グローバル',
    backgroundNote:
      'ラップトップ・アンビエント／ドローン／エレクトロニカ。William Basinskiの『The Disintegration Loops』(2002、劣化するテープループを主題とし、9.11後のアメリカで大きな反響を呼んだ)などドローン・ミュージックが重要な潮流となった。',
    parents: [parent('ambient')],
  },
  {
    name: 'glitch',
    originYear: 2001,
    originYearLabel: '2000年代',
    originCountry: 'グローバル',
    backgroundNote: 'DAWの普及により、微細なノイズ／グリッチを美学として扱う「マイクロサウンド」やグリッチが発展した。',
    parents: [parent('ambient'), parent('idm', 'crossover')],
  },
  {
    name: 'microsound',
    originYear: 2003,
    originYearLabel: '2000年代',
    originCountry: 'グローバル',
    backgroundNote: 'グリッチをさらに突き詰めた、極めて微細な音の粒子を扱う音響美学。',
    parents: [parent('glitch')],
  },
  {
    name: '日本のデジタルサウンドアート',
    originYear: 2000,
    originYearLabel: '2000年代',
    originCountry: '日本',
    backgroundNote: '池田亮司(Ryoji Ikeda)がデジタル音響／データそのものを主題にした先鋭的な作品を発表し、美術館・ギャラリーでのインスタレーションにも接続する日本のデジタルサウンドアートの代表的存在となった。',
    parents: [parent('環境音楽'), parent('glitch', 'crossover')],
  },
  {
    name: 'Japanese Ambient Revival',
    originYear: 2019,
    originYearLabel: '2010年代',
    originCountry: 'グローバル / 日本',
    backgroundNote:
      '日本の環境音楽再評価とアンビエント・リバイバル。2010年代半ば以降、海外のレコードコレクター／再発レーベルを通じて1980年代の日本の環境音楽が「Japanese Ambient」として世界的に再発見される。特にLight in the Atticが2019年に編纂したコンピレーション『Kankyō Ongaku: Japanese Ambient, Environmental & New Age Music 1980–1990』が決定的な転換点となった。吉村弘の楽曲がストリーミングで数百万回再生されるなど、当時ほぼ無名だった作品が国際的な文脈で評価され直している。',
    parents: [parent('環境音楽')],
  },
  {
    name: 'Modern Ambient',
    originYear: 2018,
    originYearLabel: '2020年代〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'ストリーミング時代のアンビエントとボーダレス化。SpotifyやYouTubeのプレイリスト文化により、アンビエントは「作業用／睡眠用BGM」として日常的に消費される音楽となった。一方でモジュラーシンセサイザーやフィールドレコーディングを用いた作家性の強い作品も並行して発展している。日本でも配信時代のリスニング習慣の変化とともに環境音楽への関心が再び高まり、現代の作家たちが1980年代の環境音楽の思想を参照しながら新作を発表している。',
    parents: [parent('ambient'), parent('Japanese Ambient Revival', 'crossover')],
  },
]

// preExisting(ambient, idm等)以外に、他ジャンルのGenre History投入時に既に
// 作成済みのジャンルへ追加でエッジを張る(Cross-Genre Connection)
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'electronica', parentName: 'ambient', relationType: 'crossover' },
  // idmはtechno/experimental electronicのみを親に持ち、ambientから辿るエッジが
  // 無かったため、idmへのhighlight(Aphex Twin等)がambientのページから到達不能
  // になっていた。再実行時にも欠けないようここへ明記する。
  { childName: 'idm', parentName: 'ambient', relationType: 'crossover' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01+02(ambientルートに直接付与)
  { genreName: 'ambient', artistName: 'Erik Satie', classification: 'influence', note: '「家具の音楽」(Musique d\'ameublement)によりアンビエント最古の思想的ルーツを提示。' },
  { genreName: 'ambient', artistName: 'Pierre Schaeffer', classification: 'influence', note: 'ミュジーク・コンクレートの確立者。' },
  { genreName: 'ambient', artistName: 'John Cage', workTitle: "4'33\"", classification: 'influence' },
  { genreName: 'ambient', artistName: 'Terry Riley', workTitle: 'In C', eventYear: 1964, classification: 'influence' },
  { genreName: 'ambient', artistName: 'Steve Reich', classification: 'influence' },
  { genreName: 'ambient', artistName: '武満徹', classification: 'influence', note: '西洋現代音楽と日本の伝統的な音響思想を融合。[JAPAN]' },
  { genreName: 'ambient', artistName: 'Brian Eno', workTitle: 'Discreet Music', eventYear: 1975 },
  { genreName: 'ambient', artistName: 'Brian Eno', workTitle: 'Ambient 1: Music for Airports', eventYear: 1978 },
  { genreName: 'ambient', artistName: 'Harold Budd', note: 'Brian Enoとの共作『The Plateaux of Mirror』(1980)で知られる。' },
  { genreName: 'ambient', artistName: 'Cluster' },

  // ERA03
  { genreName: '環境音楽', artistName: '吉村弘', workTitle: 'Music for Nine Post Cards', eventYear: 1982, note: '[JAPAN]' },
  { genreName: '環境音楽', artistName: '芦川聡', workTitle: 'Still Way', eventYear: 1982, note: '[JAPAN]' },
  { genreName: '環境音楽', artistName: '宮下富実夫', note: '[JAPAN]' },

  // ERA04
  { genreName: 'Ambient Techno', artistName: 'The Orb', workTitle: "The Orb's Adventures Beyond the Ultraworld", eventYear: 1991 },
  { genreName: 'idm', artistName: 'Aphex Twin', workTitle: 'Selected Ambient Works Volume II', eventYear: 1994 },
  { genreName: 'dark ambient', artistName: 'Lustmord' },

  // ERA05
  { genreName: 'drone', artistName: 'William Basinski', workTitle: 'The Disintegration Loops', eventYear: 2002 },
  { genreName: 'drone', artistName: 'Stars of the Lid' },
  { genreName: 'glitch', artistName: 'Fennesz', workTitle: 'Endless Summer', eventYear: 2001 },
  { genreName: '日本のデジタルサウンドアート', artistName: '池田亮司', note: 'デジタル音響／データそのものを主題にした先鋭的な作品を、美術館・ギャラリーでのインスタレーションにも展開。[JAPAN]' },

  // ERA06
  { genreName: 'Japanese Ambient Revival', artistName: '吉村弘', note: '2019年のLight in the Atticのコンピレーション『Kankyō Ongaku』などを通じ、海外で再評価の中心人物となった。[JAPAN]' },

  // ERA07
  { genreName: 'Modern Ambient', artistName: 'Green-House', note: '1980年代の日本の環境音楽を明示的に参照する現代プロジェクト。' },
  { genreName: 'Modern Ambient', artistName: '畠山地平', workTitle: 'Mirror', eventYear: 2006, note: 'White Paddy Mountain主宰、ドローン/アンビエント・ギターの代表格。[JAPAN]' },
  { genreName: 'Modern Ambient', artistName: 'haruka nakamura', workTitle: 'Grace', eventYear: 2009, note: 'ネオクラシカル寄りのアンビエント。[JAPAN]' },
  {
    genreName: 'Modern Ambient',
    artistName: '冥丁',
    workTitle: 'Kwaidan',
    eventYear: 2018,
    note: '日本の昭和期の音・歌謡・怪談的モチーフをアンビエントに再構築。「Japanese Ambient」再評価の文脈と直接つながる現代作家。[JAPAN]',
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

  const { data: ambientRow } = await supabase.from('genre').select('id').ilike('name', 'ambient').limit(1).maybeSingle()
  if (!ambientRow) throw new Error('genreテーブルに"ambient"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('ambient', ambientRow.id)

  // GENRES/HIGHLIGHTSが参照する、他ジャンルのGenre History投入時に既に
  // 作成済みの既存ジャンルをあらかじめ解決しておく
  const preExisting = ['idm', 'Ambient Techno', 'electronica']
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

  console.log('完了。ambientのgenre id:', ambientRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
