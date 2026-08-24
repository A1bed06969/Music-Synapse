/**
 * FUSION / BOSSA NOVA / VAPORWAVE / BALEARIC / UK GARAGE / NEW AGE / AOR / RAVE /
 * BLUEGRASS / SHOEGAZE / TROPICÁLIA / DRUM AND BASS のデータ投入スクリプト。
 * populate-punk-emo-metal / populate-house-jungle-ska と同じ方針。
 *
 * このバッチでは12ジャンルのうち半分(Fusion=jazz fusion, New Age, Bluegrass,
 * Drum and Bass, 及びcity pop/americana/indie folk等の関連ノード)が既に十分な
 * background_noteとhighlightを持つ既存ノードだったため、GENRESには含めず
 * (上書き事故を避けるため)、EXTRA_LINEAGE/HIGHLIGHTSのみで加筆した。
 * 残り(Bossa Nova, Vaporwave, Balearic, UK Garage, AOR, Rave, Shoegaze,
 * Tropicália, MPB等)は完全新規、またはUK Garage/Shoegazeのように空stubを
 * 土台に新規構築した。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-fusion-bossanova-vaporwave-genre-history.ts
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

const GENRES: GenreDef[] = [
  // ---- BOSSA NOVA / MPB / TROPICÁLIA ----
  {
    name: 'bossa nova',
    originYear: 1958,
    originYearLabel: '1950年代後半',
    originCountry: 'ブラジル(リオデジャネイロ・コパカバーナ)',
    backgroundNote:
      'サンバの複雑な打楽器リズムをギター1本でも演奏できるようシンプルに削ぎ落とし、クール・ジャズの洗練されたコード感を掛け合わせて誕生。João Gilberto、Antônio Carlos Jobimらにより世界的なブームを起こし、アメリカのジャズメンとの共演も盛んに行われた。',
    parents: [parent('jazz', 'influence')],
  },
  {
    name: 'tropicalia',
    originYear: 1967,
    originYearLabel: '1960年代末',
    originCountry: 'ブラジル(サルヴァドール / サンパウロ)',
    backgroundNote:
      '軍事政権下における検閲や保守的な芸術への反発として、Bossa Novaの洗練さにロックのエレキギター、サイケデリック、前衛芸術を混ぜ合わせて誕生した文化的・音楽的反体制運動。中心人物のCaetano Velosoらは政権からの弾圧で亡命を余儀なくされたが、ブラジル音楽の表現のタブーを打ち破った。',
    parents: [parent('bossa nova', 'influence'), parent('psychedelic rock', 'influence')],
  },
  {
    name: 'mpb',
    originYear: 1968,
    originYearLabel: '1960年代末〜',
    originCountry: 'ブラジル',
    backgroundNote: 'Música Popular Brasileira。Bossa Novaの洗練さを継承しつつ、より政治的・前衛的なメッセージを持つブラジルのポピュラー音楽として発展。',
    parents: [parent('bossa nova'), parent('tropicalia', 'crossover')],
  },
  // ---- VAPORWAVE ----
  {
    name: 'vaporwave',
    originYear: 2010,
    originYearLabel: '2010年頃',
    originCountry: 'インターネット上(Tumblr, Bandcamp, Reddit等)',
    backgroundNote:
      '1980〜90年代のバブル期に消費された商業音楽(スムース・ジャズ、エレベーター音楽、シティポップ等)をサンプリングし、ピッチを下げて気怠く引き延ばす手法で登場。資本主義へのノスタルジーとアイロニーを内包したネットアートとして世界中に拡散した。',
    parents: [parent('city pop', 'influence'), parent('smooth jazz', 'influence')],
  },
  {
    name: 'future funk',
    originYear: 2015,
    originYearLabel: '2010年代',
    originCountry: 'インターネット上',
    backgroundNote: 'Vaporwaveのサンプリング手法を、ファンクのグルーヴでよりダンサブルに加速させたサブジャンル。',
    parents: [parent('vaporwave')],
  },
  {
    name: 'mallsoft',
    originYear: 2015,
    originYearLabel: '2010年代',
    originCountry: 'インターネット上',
    backgroundNote: 'ショッピングモールのBGMに特化したVaporwaveのサブジャンル。',
    parents: [parent('vaporwave')],
  },
  // ---- BALEARIC ----
  {
    name: 'balearic',
    originYear: 1983,
    originYearLabel: '1980年代中盤',
    originCountry: 'スペイン(イビサ島)',
    backgroundNote:
      'イビサ島の伝説的クラブ(Amnesia等)のDJたちが、House、Ambient、Folk、Reggaeなどジャンルを問わず、島の「サンセット/日の出」の雰囲気に合わせて自由な感性でミックスしたことから始まる。特定の単一ジャンルではなく「開放的でチルアウトな精神性」そのものを指す言葉として定着した。',
    parents: [parent('house', 'influence'), parent('ambient', 'influence')],
  },
  {
    name: 'balearic house',
    originYear: 1991,
    originYearLabel: '1990年代',
    originCountry: 'スペイン / イギリス',
    backgroundNote: 'Balearicの精神性をHouseの形式に落とし込んだサブジャンル。',
    parents: [parent('balearic')],
  },
  // ---- UK GARAGE ----
  {
    name: 'uk garage',
    originYear: 1995,
    originYearLabel: '1990年代中盤〜後半',
    originCountry: 'イギリス(ロンドン)',
    backgroundNote:
      'アメリカのHouse Music(NYパラダイス・ガレージ系)がUKに渡り、ロンドンのクラブシーンで独自に変異。ドラムの拍をあえてジャストからずらして跳ねさせる独特の「2ステップ」ビートと、UKソウル的ボーカル・サンプリングを特徴とする。その低音とビートの変形が、後のGrime、Dubstepといった現代のUKベース・ミュージックの直接的な母体となった。',
    parents: [parent('house', 'influence')],
  },
  // ---- AOR ----
  {
    name: 'aor',
    originYear: 1977,
    originYearLabel: '1970年代後半〜1980年代',
    originCountry: 'アメリカ(ロサンゼルス)',
    backgroundNote:
      '米国のFMラジオ局の放送フォーマット(大人のリスナー向けのアルバム中心の選曲)から言葉が定着。ロックの骨組みにジャズやソウル、一流スタジオ・ミュージシャンによる極上のコーラスワークと緻密なアレンジを施した「大人のための高級ポップス」。1980年代の日本のシティポップのサウンドメイクに決定的な影響を与えたほか、現代のローファイ・ヒップホップやインディーR&Bのサンプリングソースとしても再評価されている。',
    parents: [parent('soft rock', 'influence')],
  },
  // ---- RAVE ----
  {
    name: 'rave',
    originYear: 1988,
    originYearLabel: '1980年代末〜1990年代初頭',
    originCountry: 'イギリス(ロンドン / マンチェスター)',
    backgroundNote:
      'シカゴから伝わったAcid HouseやTechnoの爆音とエクスタシー等の薬物カルチャーが結びつき、ウェアハウスや野外で夜通し踊る巨大なユース・ムーブメント(セカンド・サマー・オブ・ラブ)として勃発。単なる音楽ジャンルを超えたアンダーグラウンドの巨大なパーティー文化・カウンターカルチャーとして拡大した。',
    parents: [parent('acid house', 'influence'), parent('techno', 'influence')],
  },
  {
    name: 'hardcore rave',
    originYear: 1991,
    originYearLabel: '1990年代初頭',
    originCountry: 'イギリス',
    backgroundNote: 'Raveの中でより過激・高速に発展した一派。のちのJungle/Drum and Bass/EDMフェス文化へ直結する。',
    parents: [parent('rave')],
  },
  // ---- BLUEGRASS派生 ----
  {
    name: 'newgrass',
    originYear: 1972,
    originYearLabel: '1970年代',
    originCountry: 'アメリカ',
    backgroundNote: '伝統を厳格に守るBluegrassのスタイルに、JazzやRockの要素を取り入れた進化形。Béla Fleckが代表格。',
    parents: [parent('bluegrass')],
  },
  // ---- SHOEGAZE / DREAM POP ----
  {
    name: 'dream pop',
    originYear: 1984,
    originYearLabel: '1980年代',
    originCountry: 'イギリス',
    backgroundNote: '幻想的で夢見心地なサウンドスケープを特徴とする。Post-Punkの音響実験とポップの融合。Cocteau Twinsが代表格。',
    parents: [parent('post-punk', 'influence')],
  },
  {
    name: 'shoegaze',
    originYear: 1988,
    originYearLabel: '1980年代末〜1990年代前半',
    originCountry: 'イギリス(ロンドン / レディング)',
    backgroundNote:
      'My Bloody Valentineらを中心に、ギターの歪みと空間系エフェクターを極限まで踏み鳴らし、歌詞が聞き取れないほどの巨大な「ノイズの壁」を作るスタイルとして誕生(演奏中に足元のエフェクターばかり見るため「シューゲイザー」と揶揄された)。1990年代半ばに一度ブリットポップの台頭で下火になるが、2000年代以降に世界中のインディー・バンドによって再評価された。',
    parents: [parent('dream pop', 'crossover')],
  },
  {
    name: 'blackgaze',
    originYear: 2005,
    originYearLabel: '2000年代',
    originCountry: 'ヨーロッパ / アメリカ',
    backgroundNote: 'Black Metalの音響美学とShoegazeの「ノイズの壁」が融合したサブジャンル。Alcestが代表格。',
    parents: [parent('shoegaze'), parent('black metal', 'crossover')],
  },
  // ---- DRUM AND BASS派生 ----
  {
    name: 'neurofunk',
    originYear: 1998,
    originYearLabel: '1990年代末',
    originCountry: 'イギリス / オランダ',
    backgroundNote: '攻撃的で機械的なサブベースを特徴とするDrum and Bassのサブジャンル。Noisiaが代表格。',
    parents: [parent('drum and bass')],
  },
]

const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'grime', parentName: 'uk garage', relationType: 'derivation' },
  { childName: 'dubstep', parentName: 'uk garage', relationType: 'derivation' },
  { childName: 'city pop', parentName: 'aor', relationType: 'influence' },
  { childName: 'americana', parentName: 'bluegrass', relationType: 'influence' },
  { childName: 'jungle', parentName: 'rave', relationType: 'influence' },
]

const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = []

const HIGHLIGHTS: HighlightDef[] = [
  // Fusion系(既存jazz fusionへの加筆)
  { genreName: 'jazz fusion', artistName: 'Miles Davis', workTitle: 'Bitches Brew', eventYear: 1970, classification: 'influence', note: 'エレクトリック楽器とロックのビートをジャズに持ち込み、Fusionの萌芽となった。' },
  { genreName: 'Japanese Fusion', artistName: 'カシオペア' },

  // New Age(既存ノードへの加筆)
  { genreName: 'new age', artistName: 'Kitarō' },
  { genreName: 'new age', artistName: 'William Ackerman' },

  // Bossa Nova / MPB / Tropicália
  { genreName: 'bossa nova', artistName: 'João Gilberto' },
  { genreName: 'bossa nova', artistName: 'Antônio Carlos Jobim', note: 'Tom Jobim名義でも知られる。' },
  { genreName: 'mpb', artistName: 'Caetano Veloso' },
  { genreName: 'tropicalia', artistName: 'Caetano Veloso' },
  { genreName: 'tropicalia', artistName: 'Gilberto Gil' },

  // Vaporwave
  { genreName: 'vaporwave', artistName: 'Macintosh Plus' },
  { genreName: 'future funk', artistName: 'Saint Pepsi' },

  // Balearic
  { genreName: 'balearic', artistName: 'Alfredo Fiorito', classification: 'influence', note: 'Amnesiaの伝説的DJ。「バレアリック」という感性の生みの親とされる。' },

  // UK Garage
  { genreName: 'uk garage', artistName: 'Artful Dodger' },

  // AOR
  { genreName: 'aor', artistName: 'Toto' },
  { genreName: 'aor', artistName: 'Christopher Cross' },

  // Rave
  { genreName: 'rave', artistName: '808 State' },
  { genreName: 'hardcore rave', artistName: 'The Prodigy' },

  // Bluegrass派生
  { genreName: 'newgrass', artistName: 'Béla Fleck' },

  // Shoegaze / Dream Pop
  { genreName: 'dream pop', artistName: 'Cocteau Twins' },
  { genreName: 'shoegaze', artistName: 'My Bloody Valentine', workTitle: 'Loveless', eventYear: 1991 },
  { genreName: 'shoegaze', artistName: 'Slowdive' },
  { genreName: 'blackgaze', artistName: 'Alcest' },

  // Drum and Bass派生
  { genreName: 'neurofunk', artistName: 'Noisia' },
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

  const genreIdByName = new Map<string, string>()

  const preExisting = [
    'jazz', 'psychedelic rock', 'jazz fusion', 'Japanese Fusion', 'new age', 'ambient',
    'city pop', 'smooth jazz', 'house', 'acid house', 'techno', 'soft rock', 'bluegrass',
    'americana', 'post-punk', 'black metal', 'drum and bass', 'grime', 'dubstep', 'jungle',
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
