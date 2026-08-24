/**
 * JAZZ GENRE HISTORYのデータ投入スクリプト。
 *
 * 既存のBLUES GENRE HISTORY UI(app/genres/[id]/配下)は完全に汎用実装(コード内に
 * ジャンル固有のハードコードなし)のため、新しいUIコードは一切書かず、genre /
 * genre_lineage / genre_highlight にjazzの系譜データを投入するだけで
 * /genres/{jazzのid} がそのままJAZZ HISTORYページとして機能する。
 *
 * データ内容はユーザー提供の「JAZZ GENRE HISTORY UI構築」仕様書に基づく。
 * アーティスト/アルバムはまずDB内を名前で検索し、無ければiTunes Search API
 * (JPストア)で検索して新規登録する(app/admin/import/actions.tsの
 * upsertArtistFromItunesと同じ方式)。iTunesで見つからない場合は正直に
 * スキップするか、実在の録音が無いことが史実として確定している人物
 * (Buddy Bolden)に限り名前のみの手動スタブを作成する(捏造はしない)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-jazz-genre-history.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, searchAlbums, fetchTracksForAlbum, millisToSeconds } from '@/utils/itunes'
import { upsertArtistFromItunes, fillMissingArtistImage } from '@/app/admin/import/actions'
import { classifyAlbumType } from '@/utils/albumType'

type RelationType = 'derivation' | 'influence' | 'crossover'

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
}

// ─── ジャンル階層(親を先に処理する順序で並べる) ───────────────────────────

const GENRES: GenreDef[] = [
  {
    name: 'New Orleans Jazz',
    originYear: 1900,
    originYearLabel: '1900s〜1910s',
    originCountry: 'アメリカ合衆国(ニューオーリンズ)',
    backgroundNote:
      '真の発祥期。西アフリカの音楽的伝統を受け継いだ黒人霊歌やワーク・ソング、ラグタイムと、ヨーロッパのブラスバンド音楽がニューオーリンズで融合してジャズが生まれた。Buddy Boldenは録音を一切残していないが、「幻の創始者」として語り継がれている。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'Dixieland Jazz',
    originYear: 1917,
    originYearLabel: '1900s〜1910s',
    originCountry: 'アメリカ合衆国(ニューオーリンズ)',
    backgroundNote:
      'ニューオーリンズ・ジャズが白人ミュージシャンにも広がる中で生まれたスタイル。Original Dixieland Jass Bandが1917年に残した「Livery Stable Blues」は史上初のジャズ録音とされる。',
    parent: { name: 'New Orleans Jazz', relationType: 'derivation' },
  },
  {
    name: 'Chicago Jazz',
    originYear: 1920,
    originYearLabel: '1920s',
    originCountry: 'アメリカ合衆国(シカゴ)',
    backgroundNote:
      '南部から北部都市への人口移動(Great Migration)により、ニューオーリンズのジャズがシカゴへ北上した。King Oliverのクレオール・ジャズ・バンドが拠点を構えた。',
    parent: { name: 'New Orleans Jazz', relationType: 'derivation' },
  },
  {
    name: 'Hot Jazz',
    originYear: 1925,
    originYearLabel: '1920s',
    originCountry: 'シカゴ / ニューヨーク',
    backgroundNote:
      'ジャズ・エイジの中心スタイル。集団即興中心の演奏から、個々のプレイヤーによるソロ演奏を重視するスタイルへと発展した。',
    parent: { name: 'Chicago Jazz', relationType: 'derivation' },
  },
  {
    name: 'Swing Jazz',
    originYear: 1933,
    originYearLabel: '1930s〜1940s前半',
    originCountry: 'ニューヨーク / 全米',
    backgroundNote:
      'ビッグバンド全盛期。大編成のオーケストラが奏でるダンス音楽として全米で大ブームとなり、ジャズが一部の音楽家だけのものではなく社会全体を席巻するエンターテインメントへ発展した。',
    parent: { name: 'Hot Jazz', relationType: 'derivation' },
  },
  {
    name: 'big band',
    originYear: 1935,
    originYearLabel: '1930s〜1940s前半',
    originCountry: 'ニューヨーク / 全米',
    backgroundNote: 'Swing Jazzを大編成オーケストラで演奏するスタイル。ダンスホールを中心に全米で大ブームとなった。',
    parent: { name: 'Swing Jazz', relationType: 'derivation' },
  },
  {
    name: 'bebop',
    originYear: 1945,
    originYearLabel: '1940s後半〜1950s前半',
    originCountry: 'ニューヨーク',
    backgroundNote:
      'モダン・ジャズの誕生。大衆化されたSwing Jazzに対し、若手ミュージシャンがジャムセッションの場で高度な技巧、複雑なコード、自由度の高い即興演奏を追求した。',
    parent: { name: 'Swing Jazz', relationType: 'derivation' },
  },
  {
    name: 'cool jazz',
    originYear: 1950,
    originYearLabel: '1950s',
    originCountry: 'ニューヨーク',
    backgroundNote: 'Bebopの熱量に対し、抑制された響きとアレンジを重視したスタイル。Miles Davisの『Birth of the Cool』が起点となった。',
    parent: { name: 'bebop', relationType: 'derivation' },
  },
  {
    name: 'West Coast Jazz',
    originYear: 1953,
    originYearLabel: '1950s',
    originCountry: 'アメリカ西海岸',
    backgroundNote: 'Cool Jazzのカリフォルニアにおける展開。洗練されたアレンジとリラックスした演奏スタイルを特徴とする。',
    parent: { name: 'bebop', relationType: 'derivation' },
  },
  {
    name: 'modal jazz',
    originYear: 1958,
    originYearLabel: '1950s後半〜1960s',
    originCountry: 'ニューヨーク',
    backgroundNote:
      '黄金期と多様化。コード進行の制約を緩め、モード(旋法)を基盤にした即興演奏へと発展した。Miles Davisの『Kind of Blue』(1959)はこの時代を象徴する最重要作品。',
    parent: { name: 'West Coast Jazz', relationType: 'derivation' },
  },
  {
    name: 'hard bop',
    originYear: 1955,
    originYearLabel: '1950s後半〜1960s',
    originCountry: 'ニューヨーク',
    backgroundNote:
      'BluesやGospelの熱量をBebopに取り入れたスタイル。日本では渡辺貞夫が世界的に活動し、日本のモダン・ジャズを代表するプレイヤーとなった。',
    parent: { name: 'bebop', relationType: 'derivation' },
  },
  {
    name: 'free jazz',
    originYear: 1960,
    originYearLabel: '1950s後半〜1960s',
    originCountry: 'ニューヨーク / アメリカ',
    backgroundNote:
      '既存の調性や形式を打破する自由な即興演奏を追求した、ジャズ史における大規模な分岐点。この流れは日本にも波及し、独自のフリー・ジャズ/前衛ジャズのシーンが生まれた。',
    parent: { name: 'modal jazz', relationType: 'derivation' },
  },
  {
    name: 'Japanese Free Jazz',
    originYear: 1965,
    originYearLabel: '1960s〜',
    originCountry: '日本',
    backgroundNote:
      'アメリカで生まれたFree Jazzが日本で独自の表現へと展開したシーン。富樫雅彦・山下洋輔らが日本の前衛ジャズ・シーンを牽引した。単なる「輸入されたジャズ」ではなく、世界的なジャズの流れと接続する日本独自の重要な動きとして位置づける。',
    parent: { name: 'free jazz', relationType: 'derivation' },
  },
  {
    name: 'jazz fusion',
    originYear: 1970,
    originYearLabel: '1970s〜1980s',
    originCountry: 'グローバル(米国・欧州・日本)',
    backgroundNote:
      'クロスオーバー。Rock、Funk、Soulなどの強いビート、エレクトリック楽器、シンセサイザー、エレキベースを積極的に導入し、ジャズとRock/Funk/Soulの境界が大きく変化した時代。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'crossover jazz',
    originYear: 1975,
    originYearLabel: '1970s〜1980s',
    originCountry: 'グローバル',
    backgroundNote: 'Jazz FusionよりもさらにPops/R&Bへ接近した、ジャンル越境色の強いスタイル。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'smooth jazz',
    originYear: 1978,
    originYearLabel: '1970s〜1980s',
    originCountry: 'アメリカ',
    backgroundNote: 'Jazz Fusionから派生した、より聴きやすくラジオ向きにアレンジされたスタイル。',
    parent: { name: 'jazz fusion', relationType: 'derivation' },
  },
  {
    name: 'Japanese Fusion',
    originYear: 1976,
    originYearLabel: '1970s〜1980s',
    originCountry: '日本',
    backgroundNote:
      '日本のフュージョンシーン。CasiopeaやT-SQUAREが高い演奏技術と洗練されたサウンドで世界的にも評価される独自の発展を遂げた。',
    parent: { name: 'jazz fusion', relationType: 'derivation' },
  },
  {
    name: 'jazz rap',
    originYear: 1990,
    originYearLabel: '1990s〜現代',
    originCountry: 'グローバル',
    backgroundNote: 'Hip-Hopとの融合。ジャズのサンプリングやライブ演奏をHip-Hopのビートに取り入れたスタイル。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'Acid Jazz',
    originYear: 1988,
    originYearLabel: '1990s〜現代',
    originCountry: 'イギリス / グローバル',
    backgroundNote: 'Funk、Soul、Hip-Hop、Electronicaとジャズを融合させたクラブ発のムーブメント。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'nu jazz',
    originYear: 1998,
    originYearLabel: '1990s〜現代',
    originCountry: 'ヨーロッパ / グローバル',
    backgroundNote: 'Electronicaとジャズを融合させたスタイル。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    name: 'contemporary jazz',
    originYear: 1995,
    originYearLabel: '1990s〜現代',
    originCountry: 'グローバル',
    backgroundNote:
      'コンテンポラリー・融合。ジャズを一つのジャンルとして固定するのではなく「Jazz as a Language」として扱う潮流。Hip-Hop、R&B、Soul、Electronica、Rockなどとの融合が加速している。',
    parent: { name: 'jazz', relationType: 'derivation' },
  },
  {
    // 「Jazz Approach」のためのレイヤー。origin_yearを設定しないことで
    // ERAカードには出さず、GENRE EVOLUTIONの点線ノードとしてのみ現れるようにする
    // (millennium parade/君島大空をJazzの正式なサブジャンルに分類しないため)。
    name: 'Contemporary Music',
    originYear: null,
    originYearLabel: null,
    originCountry: null,
    backgroundNote:
      'ジャズを直接のジャンルとしないが、ジャズの和声・リズム・即興・アンサンブルなどを取り入れた、ジャンルを横断する現代的な音楽表現(Jazz Approach / Jazz-influenced)。',
    parent: { name: 'jazz', relationType: 'influence' },
  },
  {
    // r&b -> neo soulの既存関係とは別に、jazzのページからneo soulへ辿れるようにする
    name: 'neo soul',
    originYear: 1994,
    originYearLabel: '1990s〜現代',
    originCountry: 'アメリカ',
    backgroundNote: 'R&B/Soulにジャズ的な和声・即興を取り入れたスタイル。',
    parent: { name: 'jazz', relationType: 'influence' },
  },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01: New Orleans Jazz
  { genreName: 'New Orleans Jazz', artistName: 'Buddy Bolden', note: '幻の創始者。録音は一切現存しないが、ジャズの起源として語り継がれる。' },
  { genreName: 'New Orleans Jazz', artistName: 'Jelly Roll Morton', workTitle: 'King Porter Stomp' },
  { genreName: 'Chicago Jazz', artistName: 'King Oliver', workTitle: 'Dipper Mouth Blues', eventYear: 1923 },
  { genreName: 'Dixieland Jazz', artistName: 'Original Dixieland Jass Band', workTitle: 'Livery Stable Blues', eventYear: 1917 },

  // ERA02: Hot Jazz(ジャズ・エイジ)
  { genreName: 'Hot Jazz', artistName: 'Louis Armstrong', workTitle: 'Hot Fives and Hot Sevens', eventYear: 1926 },
  { genreName: 'Hot Jazz', artistName: 'Bix Beiderbecke', workTitle: 'In a Mist' },
  { genreName: 'Hot Jazz', artistName: 'Fletcher Henderson' },
  { genreName: 'Hot Jazz', artistName: 'Bessie Smith', note: 'ブルースとジャズの架け橋。' },

  // ERA03: Swing Jazz / big band(ビッグバンド全盛)
  { genreName: 'Swing Jazz', artistName: 'Benny Goodman', workTitle: 'Sing, Sing, Sing' },
  { genreName: 'big band', artistName: 'Benny Goodman', workTitle: 'Carnegie Hall Jazz Concert', eventYear: 1938 },
  { genreName: 'big band', artistName: 'Duke Ellington', workTitle: 'Mood Indigo' },
  { genreName: 'big band', artistName: 'Duke Ellington', workTitle: 'Take the A Train', eventYear: 1941 },
  { genreName: 'big band', artistName: 'Count Basie', workTitle: 'One O’Clock Jump' },
  { genreName: 'big band', artistName: 'Glenn Miller', workTitle: 'In the Mood' },

  // ERA04: bebop(モダン・ジャズの誕生)
  { genreName: 'bebop', artistName: 'Charlie Parker', workTitle: 'Groovin’ High' },
  { genreName: 'bebop', artistName: 'Dizzy Gillespie', workTitle: 'Salt Peanuts' },
  { genreName: 'bebop', artistName: 'Thelonious Monk', workTitle: 'Round Midnight' },
  { genreName: 'cool jazz', artistName: 'Miles Davis', workTitle: 'Birth of the Cool', eventYear: 1950 },
  { genreName: 'West Coast Jazz', artistName: 'Dave Brubeck', workTitle: 'Time Out', eventYear: 1959 },

  // ERA05: 黄金期と多様化(Hard Bop / Modal Jazz / Free Jazz)
  { genreName: 'modal jazz', artistName: 'Miles Davis', workTitle: 'Kind of Blue', eventYear: 1959, note: 'この時代を象徴する最重要作品。' },
  { genreName: 'modal jazz', artistName: 'John Coltrane', workTitle: 'Giant Steps' },
  { genreName: 'hard bop', artistName: 'Art Blakey & The Jazz Messengers', workTitle: 'Moanin’', eventYear: 1958 },
  { genreName: 'hard bop', artistName: 'Sonny Rollins', workTitle: 'Saxophone Colossus' },
  { genreName: 'hard bop', artistName: '渡辺貞夫', note: 'アルトサックス奏者。日本のモダン・ジャズを代表し、世界的に活動したプレイヤー。[JAPAN]' },
  { genreName: 'free jazz', artistName: 'John Coltrane', workTitle: 'A Love Supreme', eventYear: 1965 },
  { genreName: 'free jazz', artistName: 'Ornette Coleman', workTitle: 'Free Jazz', eventYear: 1961 },
  { genreName: 'Japanese Free Jazz', artistName: '富樫雅彦', note: '日本を代表するフリー・ジャズ/即興演奏家。日本の前衛ジャズ・シーンを牽引し、独自の即興表現を追求した。[JAPAN]' },
  { genreName: 'Japanese Free Jazz', artistName: '山下洋輔', note: '日本を代表するフリー・ジャズ・ピアニスト。1960年代以降の日本の前衛ジャズを象徴する存在。[JAPAN]' },

  // ERA06: クロスオーバー(Jazz Fusion)
  { genreName: 'jazz fusion', artistName: 'Weather Report', workTitle: 'Heavy Weather', eventYear: 1977 },
  { genreName: 'jazz fusion', artistName: 'Herbie Hancock', workTitle: 'Head Hunters', eventYear: 1973 },
  { genreName: 'crossover jazz', artistName: 'Return to Forever', workTitle: 'Romantic Warrior' },
  { genreName: 'Japanese Fusion', artistName: 'Casiopea', note: '[JAPAN]' },
  { genreName: 'Japanese Fusion', artistName: 'T-SQUARE', note: '[JAPAN]' },

  // ERA07: コンテンポラリー・融合
  { genreName: 'contemporary jazz', artistName: 'Robert Glasper' },
  { genreName: 'contemporary jazz', artistName: 'Kamasi Washington' },
  { genreName: 'contemporary jazz', artistName: 'Esperanza Spalding' },
  { genreName: 'contemporary jazz', artistName: 'Yussef Dayes' },
  { genreName: 'contemporary jazz', artistName: 'Nubya Garcia' },
  { genreName: 'contemporary jazz', artistName: 'Shabaka Hutchings' },
  { genreName: 'contemporary jazz', artistName: 'Alfa Mist' },
  { genreName: 'contemporary jazz', artistName: 'BADBADNOTGOOD' },
  {
    genreName: 'contemporary jazz',
    artistName: '上原ひろみ',
    note: '世界的に活動するピアニスト。Jazzを基盤にRock、Funk、Progressiveな要素を融合した独自の演奏スタイル。[JAPAN]',
  },

  // Jazz Approach(Contemporary Music、正式なJazzのサブジャンルとしては扱わない)
  {
    genreName: 'Contemporary Music',
    artistName: 'millennium parade',
    note: 'Jazz、Electronic、Hip-Hop、Rockなどを横断する現代的なサウンドアプローチ。Jazz Approach / Jazz-influenced。[JAPAN]',
  },
  {
    genreName: 'Contemporary Music',
    artistName: '君島大空',
    note: 'Jazz、Improvisation、Rock、Popなどの要素を横断し、現代的な和声やアンサンブルを取り入れた独自の音楽表現。Jazz Approach / Jazz-influenced。[JAPAN]',
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
  if (dup) return

  const { error } = await supabase.from('genre_highlight').insert({
    genre_id: genreId,
    artist_id: artistId,
    album_id: albumId,
    note: h.note ?? null,
    event_year: h.eventYear ?? null,
  })
  if (error) console.error(`highlight作成失敗(${h.genreName} / ${h.artistName}):`, error.message)
  else console.log(`highlight登録: ${h.genreName} / ${h.artistName}${h.workTitle ? ' / ' + h.workTitle : ''}`)
}

async function main() {
  const supabase = createAdminClient()

  const { data: jazzRow } = await supabase.from('genre').select('id').ilike('name', 'jazz').limit(1).maybeSingle()
  if (!jazzRow) throw new Error('genreテーブルに"jazz"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('jazz', jazzRow.id)

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

  console.log('完了。jazzのgenre id:', jazzRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
