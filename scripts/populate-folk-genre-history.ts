/**
 * FOLK GENRE HISTORYのデータ投入スクリプト。populate-jazz-genre-history.tsと同じ方針:
 * app/genres/[id]/は完全に汎用実装なので新規UIコードは書かず、genre / genre_lineage /
 * genre_highlight にfolkの系譜データを投入するだけで /genres/{folkのid} が
 * そのままFOLK HISTORYページとして機能する。
 *
 * データ内容はユーザー提供の「FOLK Genre History」仕様書に基づく。仕様書内で
 * 系譜図が2箇所で食い違っていた点(例: 日本フォークの枝がERA04では兄弟関係、
 * 「日本フォーク系譜」独立セクションでは一本のチェーンとして描かれている)は、
 * より詳細で明示的な「独立した系譜」セクション側を正とした。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-folk-genre-history.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, searchAlbums, fetchTracksForAlbum, millisToSeconds } from '@/utils/itunes'
import { upsertArtistFromItunes, fillMissingArtistImage } from '@/app/admin/import/actions'
import { classifyAlbumType } from '@/utils/albumType'

type RelationType = 'derivation' | 'influence' | 'crossover'
type Classification = 'core' | 'influence'

type GenreDef = {
  name: string
  originYear: number | null
  originYearLabel: string | null
  originCountry: string | null
  backgroundNote: string | null
  parent?: { name: string; relationType: RelationType }
}

type HighlightDef = {
  genreName: string
  artistName: string
  workTitle?: string
  note?: string
  eventYear?: number
  classification?: Classification
}

// ─── ジャンル階層(親を先に処理する順序で並べる) ───────────────────────────

const GENRES: GenreDef[] = [
  {
    name: 'Traditional Folk',
    originYear: 1800,
    originYearLabel: '19世紀以前〜1930s',
    originCountry: 'イギリス / アイルランド / アメリカ',
    backgroundNote:
      '伝統民謡・ルーツ期。ヨーロッパ、とりわけイギリスやアイルランドからの移民が持ち込んだバラッドや伝承歌が、アメリカのアパラチア地域などに定着した。口承によって歌が受け継がれ、生活・宗教・労働・戦争・恋愛などを題材とする地域固有の音楽文化が形成される。アフリカ系音楽やブルース、ゴスペルとの接触によって、後のアメリカン・ルーツ・ミュージックへつながる土壌も形成された。',
    parent: { name: 'folk', relationType: 'derivation' },
  },
  {
    name: 'British / Irish Folk',
    originYear: 1850,
    originYearLabel: '19世紀以前〜1930s',
    originCountry: 'イギリス / アイルランド',
    backgroundNote: 'イギリス・アイルランドに伝わるバラッド伝統。Traditional Folkの中核をなす源流のひとつ。',
    parent: { name: 'Traditional Folk', relationType: 'derivation' },
  },
  {
    name: 'Appalachian / Old-Time',
    originYear: 1900,
    originYearLabel: '19世紀以前〜1930s',
    originCountry: 'アメリカ(アパラチア)',
    backgroundNote: 'イギリス・アイルランド系移民の伝承歌がアメリカのアパラチア地域に定着し、独自のOld-Time Musicへ発展した。',
    parent: { name: 'Traditional Folk', relationType: 'derivation' },
  },
  {
    name: 'Roots Music',
    originYear: 1920,
    originYearLabel: '19世紀以前〜1930s',
    originCountry: 'アメリカ',
    backgroundNote: 'The Carter Family、Lead Belly、Woody Guthrieらが体現した、アメリカン・ルーツ・ミュージックの土台。ここからFolk Revivalへ発展する。',
    parent: { name: 'Traditional Folk', relationType: 'derivation' },
  },
  {
    name: 'Folk Revival',
    originYear: 1945,
    originYearLabel: '1940s〜1950s後半',
    originCountry: 'アメリカ',
    backgroundNote:
      'フォーク・リバイバル前夜。失われつつあった伝統的なフォークソングを発掘・記録・再評価する動きが活発化。Pete Seegerらを中心に、労働運動や社会運動とフォークが結びつき、単なる伝承音楽ではなく社会について語るための音楽として再定義されていく。',
    parent: { name: 'Roots Music', relationType: 'derivation' },
  },
  {
    name: 'Protest Folk',
    originYear: 1948,
    originYearLabel: '1940s〜1950s後半',
    originCountry: 'アメリカ',
    backgroundNote: '労働運動・公民権運動・反戦運動と結びついた政治的フォーク。',
    parent: { name: 'Folk Revival', relationType: 'derivation' },
  },
  {
    name: 'contemporary folk',
    originYear: 1961,
    originYearLabel: '1960s前半',
    originCountry: 'アメリカ',
    backgroundNote:
      '都市型フォークの黄金期。ニューヨークのGreenwich Villageを中心に若いミュージシャンが集まり、伝統的なフォークをベースに自作曲をアコースティック・ギターで歌うスタイルが急速に発展。公民権運動や反戦運動とも結びつき、フォークが若者文化の中心的な表現となる。',
    parent: { name: 'Folk Revival', relationType: 'derivation' },
  },
  {
    name: 'folk rock',
    originYear: 1965,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'アメリカ',
    backgroundNote: 'Bob Dylanらがエレクトリック楽器を取り入れ、フォークとロックの境界を大きく変えた。フォーク・ロックと世界各地への拡散が進む時代。',
    parent: { name: 'contemporary folk', relationType: 'derivation' },
  },
  {
    name: 'British Folk Rock',
    originYear: 1967,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: 'イギリス',
    backgroundNote: 'イギリスでは伝統音楽の再解釈が進み、Fairport Conventionらを中心にBritish Folk Rockへ発展した。',
    parent: { name: 'folk rock', relationType: 'derivation' },
  },
  {
    name: 'Japanese Folk',
    originYear: 1967,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: '日本',
    backgroundNote:
      '日本では1960年代後半からフォーク・ソングが若者文化と結びつき、関西を中心に社会的・政治的なメッセージを持った独自のフォーク・シーンが形成される。単なる「輸入されたフォーク」ではなく、世界的なフォークの流れと接続する日本独自の重要な動きとして位置づける。',
    parent: { name: 'folk rock', relationType: 'derivation' },
  },
  {
    name: '関西フォーク',
    originYear: 1968,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: '日本(関西)',
    backgroundNote: '関西を中心に形成された、社会的・政治的なメッセージを持つ日本独自のフォーク・シーン。フォーク・クルセダーズ、岡林信康、高田渡らが牽引した。',
    parent: { name: 'Japanese Folk', relationType: 'derivation' },
  },
  {
    name: '日本のSinger-Songwriter',
    originYear: 1971,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: '日本',
    backgroundNote: '吉田拓郎、かぐや姫、五つの赤い風船らを中心に発展した、日本独自のシンガーソングwriter文化。',
    parent: { name: '関西フォーク', relationType: 'derivation' },
  },
  {
    name: 'ニューミュージック',
    originYear: 1975,
    originYearLabel: '1960s中盤〜1970s',
    originCountry: '日本',
    backgroundNote: '日本のフォーク/シンガーソングライター文化がよりポップス寄りに洗練され、「ニューミュージック」と呼ばれるムーブメントへ発展した。',
    parent: { name: '日本のSinger-Songwriter', relationType: 'derivation' },
  },
  {
    name: 'neo-acoustic',
    originYear: 1983,
    originYearLabel: '1980s〜1990s',
    originCountry: 'イギリス',
    backgroundNote:
      'ポスト・パンクとネオ・アコースティック。Punk / Post-Punk以降のDIY精神と、アコースティックな音楽表現が接近。フォークそのものを直接継承するだけでなく、インディー・ポップ、オルタナティブ、ネオアコースティックの中にフォーク由来のメロディやアコースティック・サウンドが現れる。The SmithsやR.E.M.はフォークそのものではなく、Folkからの影響(Folk-influenced / Acoustic lineage)として位置づける。',
    parent: { name: 'folk', relationType: 'influence' },
  },
  {
    name: '日本のIndie/Acoustic',
    originYear: 1985,
    originYearLabel: '1980s〜1990s',
    originCountry: '日本',
    backgroundNote: '70年代フォークの影響を受けた日本のシンガーソングライター文化が、より個人的・文学的な表現へ展開した時代。尾崎豊、佐野元春、中島みゆき、浜田省吾、たまなど。',
    parent: { name: 'ニューミュージック', relationType: 'derivation' },
  },
  {
    name: 'indie folk',
    originYear: 2006,
    originYearLabel: '2000s〜2010s',
    originCountry: 'アメリカ / イギリス / 欧州',
    backgroundNote:
      'インディー・フォークの大爆発。デジタル制作環境とインディー・レーベルの発展によって、アコースティック楽器を中心とした個人的な音楽表現が世界的に拡大。フォーク本来の素朴な歌とギターに加え、ストリングス・コーラス・電子音・フィールド・レコーディング・実験的なサウンドデザインなどを組み合わせた新しいフォークが登場した。',
    parent: { name: 'neo-acoustic', relationType: 'derivation' },
  },
  {
    name: 'chamber folk',
    originYear: 2007,
    originYearLabel: '2000s〜2010s',
    originCountry: 'アメリカ / イギリス',
    backgroundNote: 'ストリングスやコーラスを重視した、室内楽的なアレンジのフォーク。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    name: 'freak folk',
    originYear: 2004,
    originYearLabel: '2000s〜2010s',
    originCountry: 'アメリカ',
    backgroundNote: 'サイケデリックで実験的なサウンドデザインを取り入れたフォーク。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    name: 'americana',
    originYear: 2008,
    originYearLabel: '2000s〜2010s',
    originCountry: 'アメリカ',
    backgroundNote: 'ルーツ・ミュージックを現代的に再解釈するスタイル。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    name: '日本のContemporary Folk',
    originYear: 2015,
    originYearLabel: '2010s〜現代',
    originCountry: '日本',
    backgroundNote:
      '日本フォークの独自の系譜の到達点。カネコアヤノ、折坂悠太らが、個人的な語り・生活感・自然な演奏感といったフォークの精神を受け継ぎながら、現代的な音楽表現へ展開している。',
    parent: { name: '日本のIndie/Acoustic', relationType: 'derivation' },
  },
  {
    name: 'folk pop',
    originYear: 2012,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: 'ボーダレス化と現代フォーク。フォークの語法とポップスが融合したスタイル。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    name: 'Ambient Folk',
    originYear: 2015,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル / 日本',
    backgroundNote: 'アンビエント・エレクトロニカとフォークの融合。フォークらしい楽器そのものより、素朴なメロディや自然な演奏感といったフォークの精神を受け継ぐ音楽。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    name: 'Experimental Folk',
    originYear: 2014,
    originYearLabel: '2010s〜現代',
    originCountry: 'グローバル',
    backgroundNote: '実験音楽とフォークの融合。フォークの境界がさらに曖昧になった現代の潮流。',
    parent: { name: 'indie folk', relationType: 'derivation' },
  },
  {
    // 「Folk Approach」のためのレイヤー。jazzのGenre History投入時に作成済みの
    // 汎用的な"Contemporary Music"ノードをそのまま再利用する(origin_year無しなので
    // ERAカードには出ず、GENRE EVOLUTIONの点線ノードとしてのみ現れる)。
    name: 'Contemporary Music',
    originYear: null,
    originYearLabel: null,
    originCountry: null,
    backgroundNote: null,
    parent: { name: 'folk', relationType: 'influence' },
  },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'Roots Music', artistName: 'The Carter Family', workTitle: 'Wildwood Flower' },
  { genreName: 'Roots Music', artistName: 'Lead Belly', workTitle: 'Goodnight, Irene' },
  {
    genreName: 'Roots Music',
    artistName: 'Woody Guthrie',
    workTitle: 'This Land Is Your Land',
    note: 'この曲自体は1940年の録音だが、フォーク・ルーツの系譜を示す代表作品としてここに関連表示する。',
  },

  // ERA02
  { genreName: 'Folk Revival', artistName: 'Pete Seeger', workTitle: 'If I Had a Hammer' },
  { genreName: 'Folk Revival', artistName: 'The Weavers', workTitle: 'Goodnight, Irene' },
  { genreName: 'Folk Revival', artistName: 'Harry Belafonte', workTitle: 'The Banana Boat Song' },

  // ERA03
  { genreName: 'contemporary folk', artistName: 'Bob Dylan', workTitle: 'The Freewheelin\' Bob Dylan', eventYear: 1963 },
  { genreName: 'contemporary folk', artistName: 'Joan Baez', workTitle: 'Joan Baez' },
  { genreName: 'contemporary folk', artistName: 'Peter, Paul and Mary', workTitle: 'Blowin\' in the Wind' },
  { genreName: 'Protest Folk', artistName: 'Phil Ochs' },
  { genreName: 'Protest Folk', artistName: 'Tom Paxton' },

  // ERA04
  { genreName: 'folk rock', artistName: 'Bob Dylan', workTitle: 'Bringing It All Back Home' },
  { genreName: 'folk rock', artistName: 'Bob Dylan', workTitle: 'Highway 61 Revisited' },
  { genreName: 'folk rock', artistName: 'Simon & Garfunkel', workTitle: 'The Sound of Silence' },
  { genreName: 'folk rock', artistName: 'Joni Mitchell', workTitle: 'Blue' },
  { genreName: 'British Folk Rock', artistName: 'Fairport Convention' },
  { genreName: 'British Folk Rock', artistName: 'Nick Drake' },
  { genreName: '関西フォーク', artistName: 'フォーク・クルセダーズ', workTitle: '帰って来たヨッパライ', eventYear: 1967 },
  { genreName: '関西フォーク', artistName: '岡林信康', workTitle: '私たちの望むものは' },
  { genreName: '関西フォーク', artistName: '高田渡' },
  { genreName: '日本のSinger-Songwriter', artistName: '吉田拓郎', workTitle: '人間なんて' },
  { genreName: '日本のSinger-Songwriter', artistName: 'かぐや姫' },
  { genreName: '日本のSinger-Songwriter', artistName: '五つの赤い風船' },

  // ERA05
  { genreName: 'neo-acoustic', artistName: 'The Smiths', classification: 'influence', note: 'Folk-influenced / Acoustic lineage。フォークそのものではなく、フォークからの影響として位置づける。' },
  { genreName: 'neo-acoustic', artistName: 'R.E.M.', classification: 'influence', note: 'Folk-influenced / Acoustic lineage。' },
  { genreName: 'neo-acoustic', artistName: 'Suzanne Vega' },
  { genreName: 'neo-acoustic', artistName: 'Nick Cave', classification: 'influence' },
  { genreName: '日本のIndie/Acoustic', artistName: '尾崎豊' },
  { genreName: '日本のIndie/Acoustic', artistName: '佐野元春' },
  { genreName: '日本のIndie/Acoustic', artistName: '中島みゆき' },
  { genreName: '日本のIndie/Acoustic', artistName: '浜田省吾' },
  { genreName: '日本のIndie/Acoustic', artistName: 'たま' },

  // ERA06
  { genreName: 'indie folk', artistName: 'Bon Iver', workTitle: 'For Emma, Forever Ago' },
  { genreName: 'indie folk', artistName: 'Fleet Foxes', workTitle: 'Fleet Foxes' },
  { genreName: 'indie folk', artistName: 'Iron & Wine' },
  { genreName: 'chamber folk', artistName: 'Sufjan Stevens', workTitle: 'Illinois' },
  { genreName: 'chamber folk', artistName: 'The Decemberists' },
  { genreName: 'freak folk', artistName: 'Devendra Banhart' },
  { genreName: 'freak folk', artistName: 'Joanna Newsom', workTitle: 'Ys' },

  // ERA07
  { genreName: 'indie folk', artistName: 'Big Thief' },
  { genreName: 'indie folk', artistName: 'Adrianne Lenker' },
  { genreName: 'indie folk', artistName: 'The Tallest Man on Earth' },
  { genreName: 'folk pop', artistName: 'Mumford & Sons' },
  { genreName: 'Ambient Folk', artistName: '青葉市子', classification: 'influence', note: 'Ambient Folk / Experimental Folk。フォーク的な歌とギターを基盤に、独自の音響世界を展開する。[JAPAN]' },
  { genreName: 'Experimental Folk', artistName: '君島大空', classification: 'influence', note: 'Folk Approach / Experimental Singer-Songwriter。フォーク的な歌とギターを基盤に、Jazz / Rock / Ambient / Experimentalを横断する。[JAPAN]' },
  { genreName: 'americana', artistName: '細野晴臣', classification: 'influence', note: 'Folk / Roots / Americanaの再解釈。[JAPAN]' },
  { genreName: '日本のContemporary Folk', artistName: 'カネコアヤノ', note: 'Contemporary Japanese Folk / Singer-Songwriter。[JAPAN]' },
  { genreName: '日本のContemporary Folk', artistName: '折坂悠太', note: 'Contemporary Japanese Folk / Singer-Songwriter。[JAPAN]' },

  // Folk Approach(Contemporary Music、正式なFolkのサブジャンルとしては扱わない)
  {
    genreName: 'Contemporary Music',
    artistName: '細野晴臣',
    classification: 'influence',
    note: 'Folk / Roots / Americanaの再解釈。Folk Approach。[JAPAN]',
  },
]

// ─── 実行本体(populate-jazz-genre-history.tsと同じ) ─────────────────────

async function findOrCreateGenre(supabase: SupabaseClient, def: GenreDef): Promise<string> {
  const { data: existing } = await supabase.from('genre').select('id').ilike('name', def.name).limit(1).maybeSingle()

  if (existing) {
    // origin_year等がnullの項目は上書きしない(既存の値を消さないため)。
    // "Contemporary Music"のように意図的に全項目nullの定義はそもそも更新しない。
    if (def.originYear !== null || def.originYearLabel !== null || def.originCountry !== null || def.backgroundNote !== null) {
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
    }
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

  const { data: folkRow } = await supabase.from('genre').select('id').ilike('name', 'folk').limit(1).maybeSingle()
  if (!folkRow) throw new Error('genreテーブルに"folk"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('folk', folkRow.id)

  console.log('=== ジャンル階層を投入 ===')
  for (const def of GENRES) {
    const id = await findOrCreateGenre(supabase, def)
    genreIdByName.set(def.name.toLowerCase(), id)
    console.log(`genre: ${def.name} -> ${id}`)

    if (def.parent) {
      const parentId = genreIdByName.get(def.parent.name.toLowerCase())
      if (!parentId) {
        console.error(`親ジャンルが未解決です: ${def.parent.name} (子: ${def.name})`)
        continue
      }
      await upsertLineage(supabase, parentId, id, def.parent.relationType)
    }
  }

  console.log('=== 代表アーティスト/作品を投入 ===')
  for (const h of HIGHLIGHTS) {
    await insertHighlight(supabase, h, genreIdByName)
  }

  console.log('完了。folkのgenre id:', folkRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
