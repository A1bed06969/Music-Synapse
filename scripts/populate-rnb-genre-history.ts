/**
 * R&B GENRE HISTORYのデータ投入スクリプト。populate-reggae/ambient-genre-history.ts
 * などと同じ方針: 新規UIコードは書かず、genre / genre_lineage / genre_highlight に
 * r&bの系譜データを投入するだけで /genres/{r&bのid} がそのままR&B HISTORY
 * ページとして機能する。データ内容はユーザーが事前にレビュー・承認したMarkdown
 * 年表ドラフトに基づく。
 *
 * このジャンルは他ジャンル投入時に既に作成済みのノードとの重なりが大きい
 * (Motown Pop/philly soul/quiet storm/ブラコンブーム/new jack swing/hip hop soul/
 * J-R&B/contemporary r&b/neo soul/alternative r&b)。それらのorigin_year等は
 * 上書きせず、r&bルートからのcrossoverエッジを追加するだけに留め、まだ
 * highlightが0件だった new jack swing・alternative r&b を中心にデータを補強する。
 * 新規に作るジャンルノードはR&B固有の誕生期(Jump Blues, Doo-Wop)のみ。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-rnb-genre-history.ts
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
    name: 'r&b',
    originYear: 1947,
    originYearLabel: '1940年代後半〜1950年代',
    originCountry: 'アメリカ(シカゴ / ニューヨーク)',
    backgroundNote:
      '誕生期・ジャンプ・ブルースとドゥーワップ。1949年、Billboard誌が黒人向け市場のレコードチャートの呼称を「Race Records」から「Rhythm and Blues」に変更したことが、この名称そのものの起点となった。ジャンプ・ブルースはビッグバンド・スウィングをコンパクトな編成に凝縮し、ホーンとシャッフルビートを特徴とするダンス音楽として発展。同時期、教会音楽的なハーモニーとポピュラーソングを融合したドゥーワップが都市部の若者グループの間で流行した。戦後の米軍基地放送(FEN)を通じ、日本でも一部の音楽ファンにR&Bが伝わり始める。',
  },
  {
    name: 'Jump Blues',
    originYear: 1945,
    originYearLabel: '1940年代後半〜1950年代',
    originCountry: 'アメリカ',
    backgroundNote: 'ビッグバンド・スウィングをコンパクトな編成に凝縮した、ホーンとシャッフルビートが特徴のダンス音楽。R&Bの直接の母体となった。',
    parents: [parent('r&b')],
  },
  {
    name: 'Doo-Wop',
    originYear: 1950,
    originYearLabel: '1940年代後半〜1950年代',
    originCountry: 'アメリカ(ニューヨーク)',
    backgroundNote: '教会音楽的なハーモニーとポピュラーソングを融合した、都市部の若者グループによるアカペラ〜バンド伴奏歌唱スタイル。',
    parents: [parent('r&b')],
  },
  {
    // rock/soul投入時にCross-Genre Connectionの対象として既にgenre行は存在していたが、
    // origin_year等が一度も設定されておらずERAカードに出ていなかった(highlightだけ
    // 先に付いていた自己発見バグ)。ここで正式にR&B側のフィールドを設定する。
    name: 'alternative r&b',
    originYear: 2011,
    originYearLabel: '2010年代〜現代',
    originCountry: 'ロサンゼルス / ニューヨーク / グローバル',
    backgroundNote:
      'オルタナティブR&Bとジャンルレス化。Frank Ocean、The Weeknd、Miguel、SZAらが、ヒップホップ・エレクトロニカ・インディーロックの語法をR&Bへ取り込み「オルタナティブR&B(俗称PBR&B)」を確立した。ジャンルの境界そのものが常に流動的であり続けている。',
    parents: [parent('r&b')],
  },
]

// 他ジャンルのGenre History投入時に既に作成済みのジャンル(Motown Pop等)へ
// r&bルートからのCross-Genre Connectionを追加する。これらのorigin_year/
// background_noteは既存のまま変更しない。
const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'Motown Pop', parentName: 'r&b', relationType: 'crossover' },
  { childName: 'philly soul', parentName: 'r&b', relationType: 'crossover' },
  { childName: 'quiet storm', parentName: 'r&b', relationType: 'crossover' },
  { childName: 'new jack swing', parentName: 'r&b', relationType: 'crossover' },
  { childName: 'hip hop soul', parentName: 'r&b', relationType: 'crossover' },
  { childName: 'contemporary r&b', parentName: 'r&b', relationType: 'derivation' },
  { childName: 'neo soul', parentName: 'r&b', relationType: 'crossover' },
]

// ─── 代表アーティスト/作品 ──────────────────────────────────────────────

const HIGHLIGHTS: HighlightDef[] = [
  // ERA01
  { genreName: 'Jump Blues', artistName: 'Louis Jordan', note: 'ジャンプ・ブルースの中心人物。' },
  { genreName: 'Doo-Wop', artistName: 'The Drifters' },
  { genreName: 'Doo-Wop', artistName: 'The Platters' },
  { genreName: 'r&b', artistName: 'Ruth Brown' },

  // ERA05: new jack swing / hip hop soulの補強
  { genreName: 'new jack swing', artistName: 'New Edition' },
  { genreName: 'new jack swing', artistName: 'Bobby Brown', workTitle: 'My Prerogative' },
  { genreName: 'new jack swing', artistName: 'Bell Biv DeVoe' },
  { genreName: 'hip hop soul', artistName: 'Mary J. Blige', workTitle: "What's the 411?", eventYear: 1992 },

  // ERA06: contemporary r&bの補強
  { genreName: 'contemporary r&b', artistName: 'Usher', workTitle: 'Confessions', eventYear: 2004 },
  { genreName: 'contemporary r&b', artistName: 'Alicia Keys', workTitle: 'Songs in A Minor', eventYear: 2001 },
  { genreName: 'contemporary r&b', artistName: 'Beyoncé' },
  {
    genreName: 'contemporary r&b',
    artistName: '宇多田ヒカル',
    note: 'デジタルR&Bの語法を日本語ポップスへ本格導入し大成功、以降J-POPの主流表現の一つとなった。[JAPAN]',
  },

  // ERA07: alternative r&bの補強(現在highlight 0件)
  { genreName: 'alternative r&b', artistName: 'Frank Ocean', workTitle: 'Channel Orange', eventYear: 2012 },
  { genreName: 'alternative r&b', artistName: 'The Weeknd', workTitle: 'House of Balloons', eventYear: 2011 },
  { genreName: 'alternative r&b', artistName: 'SZA', workTitle: 'Ctrl', eventYear: 2017 },
  { genreName: 'alternative r&b', artistName: 'Miguel' },
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

  const { data: rnbRow } = await supabase.from('genre').select('id').ilike('name', 'r&b').limit(1).maybeSingle()
  if (!rnbRow) throw new Error('genreテーブルに"r&b"が見つかりません。')

  const genreIdByName = new Map<string, string>()
  genreIdByName.set('r&b', rnbRow.id)

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
    genreIdByName.set(link.childName.toLowerCase(), childRow.id)
    console.log(`cross-genre: ${link.parentName} -> ${link.childName} [${link.relationType}]`)
  }

  console.log('=== 代表アーティスト/作品を投入 ===')
  for (const h of HIGHLIGHTS) {
    await insertHighlight(supabase, h, genreIdByName)
  }

  console.log('完了。r&bのgenre id:', rnbRow.id)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
