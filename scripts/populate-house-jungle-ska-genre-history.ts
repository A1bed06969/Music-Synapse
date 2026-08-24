/**
 * HOUSE / JUNGLE / SKA のデータ投入スクリプト。populate-punk-emo-metal-genre-history.ts
 * と同じ方針: 既存の薄い骨組み(house, jungle, ska, breakbeat, acid house, dub 等)を
 * 土台に、ユーザーがレビュー済みの「ジャンル系譜大全」ドキュメント相当の深さまで
 * 肉付けする。
 *
 * 設計判断:
 * - House: 既存の "Detroit Techno[crossover]->house" エッジは残しつつ、
 *   disco/funkからの真に前向き(chronologically forward)な influence エッジを追加する
 *   (disco 1977 -> house 1985、funk 1965 -> house 1985で逆行エッジにならない)。
 * - Ska: ジャマイカ系譜(Ska->Rocksteady->Reggae)は reggae 投入時の設計判断を踏襲し、
 *   Rocksteadyを独立ノードにせずska自身のnote内で語る。ただしSka->Reggaeへの
 *   derivationエッジは追加する(ska 1959 -> reggae 1959、同年だが史実として前向き)。
 *   UK/US再解釈系譜(Ska->2 Tone->Ska Punk->Third Wave Ska)は独立ノードとして構築。
 * - Jungle: dub(1973)/hip hop(1973)からのinfluenceエッジを追加(jungle 1991なので
 *   前向き)。Drum & Bassは既存stubを土台に、Techstep/Liquid Funkを新規追加。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-house-jungle-ska-genre-history.ts
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
  // ---- HOUSE ----
  {
    name: 'house',
    originYear: 1984,
    originYearLabel: '1980年代前半',
    originCountry: 'アメリカ(シカゴ)',
    backgroundNote:
      'シカゴのクラブ「The Warehouse」(ジャンル名の由来)でDJを務めたFrankie Knucklesが、ディスコのミキシングを発展させたのが起点。1979年の「ディスコ・デモリッション・ナイト」に象徴されるディスコへの反発とアンダーグラウンド化を背景に、ゲイ・アフリカ系コミュニティのクラブ文化の中で確立された。TR-909/TB-303等の廉価な機材普及が音響的発明を後押しした。',
    parents: [parent('r&b', 'influence')],
  },
  {
    name: 'deep house',
    originYear: 1985,
    originYearLabel: '1985年頃',
    originCountry: 'アメリカ(シカゴ)',
    backgroundNote: 'ソウルフルなヴォーカルとジャジーなコードを特徴とする。Larry Heard(Mr. Fingers)が代表的。',
    parents: [parent('house')],
  },
  {
    name: 'french house',
    originYear: 1996,
    originYearLabel: '1990年代後半',
    originCountry: 'フランス',
    backgroundNote: 'ディスコサンプリングとフィルタースウィープを特徴とする独自の欧州House路線。Daft Punk「Da Funk」(1997)が代表的。',
    parents: [parent('house')],
  },
  // ---- SKA ----
  {
    name: 'ska',
    originYear: 1959,
    originYearLabel: '1959年頃〜',
    originCountry: 'ジャマイカ(キングストン)',
    backgroundNote:
      'ジャマイカン・メント(伝統音楽)とアメリカのR&B/ジャズが融合して誕生。オフビートのギターカッティングを特徴とする。60年代半ばにテンポが落ち感情表現豊かなロックステディへ移行し、68年頃にはさらにゆったりした「レゲエ」が定着した(ジャマイカ系譜)。一方、1979年にはイギリスでThe SpecialsらによるUK 2-Toneが、パンクとスカを融合させ人種融和のメッセージとともに再興(UK/US再解釈系譜)。この2つの系譜は同じ「Ska」という語源を共有しながら、まったく異なる方向へ発展した。',
  },
  {
    name: '2 tone',
    originYear: 1979,
    originYearLabel: '1979年頃',
    originCountry: 'イギリス(コヴェントリー)',
    backgroundNote: 'パンクの荒々しさとスカを融合させたムーブメント。人種融和のメッセージを掲げたThe Specials、Madnessが代表的。',
    parents: [parent('ska'), parent('punk rock', 'crossover')],
  },
  {
    name: 'ska punk',
    originYear: 1988,
    originYearLabel: '1980年代末〜1990年代',
    originCountry: 'アメリカ',
    backgroundNote: '2-Toneが米国西海岸のパンクシーンで発展。Operation Ivyが先駆けとなった。',
    parents: [parent('2 tone')],
  },
  {
    name: 'third wave ska',
    originYear: 1995,
    originYearLabel: '1990年代',
    originCountry: 'アメリカ',
    backgroundNote: 'よりポップでホーンセクションを重視した様式。No Doubt『Tragic Kingdom』(1995)がメインストリーム進出の頂点となった。',
    parents: [parent('ska punk')],
  },
  // ---- JUNGLE ----
  {
    name: 'jungle',
    originYear: 1991,
    originYearLabel: '1991–93年',
    originCountry: 'イギリス(ロンドン)',
    backgroundNote:
      'BreakbeatのBPMが上昇し、レゲエ由来のサブベースが導入されて分化。多民族的ロンドン(カリブ系移民コミュニティ)のサウンドシステム文化とレイヴ文化が融合して生まれた。1994年のクリミナル・ジャスティス法によるレイヴ規制強化も背景の一つ。',
    parents: [parent('breakbeat'), parent('dub', 'influence'), parent('hip hop', 'influence')],
  },
  {
    name: 'drum and bass',
    originYear: 1995,
    originYearLabel: '1994年〜',
    originCountry: 'イギリス',
    backgroundNote: 'Goldie『Timeless』(1995)による芸術的正当化を経て確立された、Jungleのより洗練された呼称。Roni Size『New Forms』(1997)がマーキュリー賞を受賞し芸術的評価を確立した。',
    parents: [parent('jungle')],
  },
  {
    name: 'techstep',
    originYear: 1996,
    originYearLabel: '1996–99年',
    originCountry: 'イギリス',
    backgroundNote: '機械的・インダストリアルな質感を追求したサブジャンル。Ed Rush & Opticalが代表的。',
    parents: [parent('drum and bass')],
  },
  {
    name: 'liquid funk',
    originYear: 2001,
    originYearLabel: '2000年代',
    originCountry: 'イギリス',
    backgroundNote: 'ソウルフルでメロディックな路線への回帰。High Contrastが代表的。',
    parents: [parent('drum and bass')],
  },
]

const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'house', parentName: 'disco', relationType: 'influence' },
  { childName: 'house', parentName: 'funk', relationType: 'influence' },
  { childName: 'acid house', parentName: 'house', relationType: 'derivation' },
  { childName: 'ska', parentName: 'reggae', relationType: 'derivation' },
]

const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = []

const HIGHLIGHTS: HighlightDef[] = [
  // house
  { genreName: 'house', artistName: 'Frankie Knuckles', note: 'The Warehouseの伝説的DJ。ジャンル名の由来となった。' },
  { genreName: 'house', artistName: 'Jesse Saunders', workTitle: 'On and On', note: '最初期のHouseレコードとされる。' },
  { genreName: 'deep house', artistName: 'Larry Heard', note: 'Mr. Fingers名義でも活動。「Can You Feel It」で知られる。' },
  { genreName: 'acid house', artistName: 'Phuture', workTitle: 'Acid Tracks', note: 'TB-303を用いたAcid Houseの原点。' },
  { genreName: 'french house', artistName: 'Daft Punk', workTitle: 'Homework', eventYear: 1997 },

  // ska
  { genreName: 'ska', artistName: 'The Skatalites' },
  { genreName: 'ska', artistName: 'Prince Buster' },
  { genreName: '2 tone', artistName: 'The Specials', workTitle: 'The Specials', eventYear: 1979 },
  { genreName: '2 tone', artistName: 'Madness' },
  { genreName: 'ska punk', artistName: 'Operation Ivy' },
  { genreName: 'ska punk', artistName: 'Sublime' },
  { genreName: 'third wave ska', artistName: 'No Doubt', workTitle: 'Tragic Kingdom', eventYear: 1995 },
  { genreName: 'third wave ska', artistName: 'Reel Big Fish' },

  // jungle
  { genreName: 'jungle', artistName: 'Goldie', workTitle: 'Timeless', eventYear: 1995 },
  { genreName: 'jungle', artistName: 'LTJ Bukem' },
  { genreName: 'drum and bass', artistName: 'Roni Size', workTitle: 'New Forms', eventYear: 1997 },
  { genreName: 'techstep', artistName: 'Ed Rush & Optical' },
  { genreName: 'liquid funk', artistName: 'High Contrast' },
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

  const preExisting = ['acid house', 'breakbeat', 'dub', 'hip hop', 'disco', 'funk', 'reggae', 'punk rock', 'r&b']
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
