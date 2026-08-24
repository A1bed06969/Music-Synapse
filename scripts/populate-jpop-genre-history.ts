/**
 * J-POP GENRE HISTORYのデータ投入スクリプト。populate-jazz/.../rnb-genre-history.ts
 * と同じ方針。DBには既に "J-POP" というノードが存在していたが、Pop/Soul等の投入時に
 * 経由地点として作られた空コンテナ(origin_year無し)で、Japanese Dance Pop(親)と
 * Japanese Net/Vocaloid Culture(子)だけが繋がっていた。今回はJ-POP自身にorigin_year/
 * 背景ノートを与え、TK系・Being系・オルタナティブ・アイドルポップ・J-Rockの各枝を
 * 新規追加。J-R&Bは既存の充実したノードを持つため、J-POPからのcrossoverエッジのみ追加。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-jpop-genre-history.ts
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
  {
    name: 'J-POP',
    originYear: 1988,
    originYearLabel: '1988–89年頃',
    originCountry: '日本',
    backgroundNote:
      '1988年開局のFM局J-WAVEが、番組編成上の分類として「J-POP」という呼称を使い始めたのが直接の起点とされる。母体は昭和歌謡＋ニューミュージック＋シティポップ＋洋楽ポップ/ロックの融合。80年代バブル経済下での音楽産業拡大とCD普及を背景に、洋楽と邦楽の境界を横断する「都会的で洗練された邦楽」というカテゴリーへの需要が高まった。以後、あらゆる先行ジャンル(ロック・ソウル・ファンク・ヒップホップ・エレクトロニカ)を吸収する「合流点」として機能してきた。',
  },
  {
    name: 'TK系',
    originYear: 1993,
    originYearLabel: '1993–99年',
    originCountry: '日本',
    backgroundNote: '小室哲哉プロデュースによるユーロビート的ダンスサウンド。TRF、globe、安室奈美恵らを手がけ、90年代CDバブルの中心となった。',
    parents: [parent('J-POP')],
  },
  {
    name: 'Being系',
    originYear: 1988,
    originYearLabel: '1990年代',
    originCountry: '日本',
    backgroundNote: 'ドラマ・CMとのタイアップ戦略でチャートを席巻したBeingレーベル系のアーティスト群。B\'z、ZARD、WANDSが代表格。',
    parents: [parent('J-POP')],
  },
  {
    name: 'jpop alternative',
    originYear: 1992,
    originYearLabel: '1990年代',
    originCountry: '日本',
    backgroundNote: 'TK系/Being系のダンス/タイアップ路線と一線を画す、バンド編成によるオルタナティブ志向。Mr.Children、スピッツが代表格。',
    parents: [parent('J-POP')],
  },
]

const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'idol kayō', parentName: 'J-POP', relationType: 'derivation' },
  { childName: 'j-rock', parentName: 'J-POP', relationType: 'derivation' },
  { childName: 'J-R&B', parentName: 'J-POP', relationType: 'crossover' },
]

const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = []

const HIGHLIGHTS: HighlightDef[] = [
  { genreName: 'TK系', artistName: '安室奈美恵', workTitle: 'SWEET 19 BLUES', eventYear: 1996 },
  { genreName: 'TK系', artistName: 'globe' },
  { genreName: 'TK系', artistName: 'TRF' },
  { genreName: 'Being系', artistName: "B'z" },
  { genreName: 'Being系', artistName: 'ZARD' },
  { genreName: 'jpop alternative', artistName: 'Mr.Children' },
  { genreName: 'jpop alternative', artistName: 'スピッツ' },
  { genreName: 'idol kayō', artistName: 'モーニング娘。' },
  { genreName: 'idol kayō', artistName: 'AKB48' },
  { genreName: 'j-rock', artistName: "L'Arc~en~Ciel" },
  { genreName: 'j-rock', artistName: 'GLAY' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'YOASOBI', workTitle: '夜に駆ける', eventYear: 2020, note: 'ネット小説発、ストリーミング時代の代表作。' },
  { genreName: 'Japanese Net/Vocaloid Culture', artistName: 'Ado' },
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

  const preExisting = ['idol kayō', 'j-rock', 'J-R&B', 'Japanese Net/Vocaloid Culture', 'Japanese Dance Pop']
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
