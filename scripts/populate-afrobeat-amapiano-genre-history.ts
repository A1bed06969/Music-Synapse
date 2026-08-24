/**
 * AFROBEAT / AMAPIANO GENRE HISTORYのデータ投入スクリプト。他ジャンルと異なり
 * DB内に既存の骨組みが一切無いため、完全新規のジャンルツリーとして構築する。
 *
 * 設計判断: 「Afrobeat」(Fela Kuti起源の固有ジャンル)と「Afrobeats」(2000年代後半〜の
 * 西アフリカ発ポップ音楽全般の呼称)を別ノードとして分離し、名称の類似による混同を
 * ドキュメント同様に明示する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-afrobeat-amapiano-genre-history.ts
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
    name: 'afrobeat',
    originYear: 1969,
    originYearLabel: '1960年代末〜70年代初頭',
    originCountry: 'ナイジェリア(ラゴス)',
    backgroundNote:
      'Fela Kutiが確立。母体はWest African Music(伝統リズム)＋Highlife＋Yoruba Music＋Jazz＋Funk——特に1969年の米国滞在時、James Brownやブラックパワー運動から強い影響を受けたことが決定的だった。ナイジェリア独立(1960)後の政治的混乱、軍事政権への抵抗、汎アフリカ主義の高揚を背景に持つ。',
    parents: [parent('jazz', 'influence'), parent('funk', 'influence')],
  },
  {
    name: 'political afrobeat',
    originYear: 1976,
    originYearLabel: '1970年代',
    originCountry: 'ナイジェリア',
    backgroundNote: '軍事政権への痛烈な風刺を音楽で表現した時代。『Zombie』(1976)が金字塔。Felaへの弾圧激化と国際的知名度の同時上昇を招いた。',
    parents: [parent('afrobeat')],
  },
  {
    name: 'afrobeat revival',
    originYear: 2002,
    originYearLabel: '2000年代',
    originCountry: 'アメリカ / グローバル',
    backgroundNote: '欧米でのFela再評価。Antibalas等のリバイバルバンドが牽引した。',
    parents: [parent('political afrobeat')],
  },
  {
    name: 'afrobeats',
    originYear: 2005,
    originYearLabel: '2000年代後半〜',
    originCountry: 'ナイジェリア / ガーナ',
    backgroundNote:
      '「Afrobeat」(語尾sなし、Fela Kuti起源の固有ジャンル)とは別物。西アフリカの若い世代がHip-Hop/Dancehallと自国のリズムを融合させた現代的ポップ/ダンス音楽全般を指す包括的な商業カテゴリーで、音楽的にはFelaのアフロビートとの直接の連続性は薄い。名称の類似による混同に注意。Afro-Pop/Afro-R&B/Afro-Dancehallとの融合を経て、2020年代のグローバルポップの主要言語の一つとなった。',
    parents: [parent('afrobeat', 'influence')],
  },
  {
    name: 'amapiano',
    originYear: 2012,
    originYearLabel: '2012年頃〜',
    originCountry: '南アフリカ(プレトリア / ヨハネスブルグ)',
    backgroundNote:
      '複数のプロデューサーによる同時多発的発展として誕生。母体はKwaito(90年代南ア独自のハウス変種)＋South African House＋Deep House＋Jazz。南アフリカのタウンシップのクラブ文化、SNS普及によるビート共有文化が土壌となった。2018-19年頃、Kabza De Small／DJ Maphorisaにより特徴的な「ログドラム」ベースサウンドが様式的に確立し、2020-21年にはTikTokチャレンジ経由で世界的にバイラルヒットした。',
    parents: [parent('house', 'influence')],
  },
]

const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = [
  { childName: 'amapiano', parentName: 'afrobeats', relationType: 'crossover' },
]

const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = []

const HIGHLIGHTS: HighlightDef[] = [
  { genreName: 'afrobeat', artistName: 'Fela Kuti' },
  { genreName: 'afrobeat', artistName: 'Tony Allen', note: 'ドラマー、Afrobeatのリズムの立役者。', classification: 'influence' },
  { genreName: 'political afrobeat', artistName: 'Fela Kuti', workTitle: 'Zombie', eventYear: 1976 },
  { genreName: 'afrobeat revival', artistName: 'Antibalas' },
  { genreName: 'afrobeats', artistName: 'Wizkid' },
  { genreName: 'afrobeats', artistName: 'Burna Boy', workTitle: 'African Giant', eventYear: 2019 },
  { genreName: 'afrobeats', artistName: 'Davido' },
  { genreName: 'amapiano', artistName: 'Kabza De Small' },
  { genreName: 'amapiano', artistName: 'DJ Maphorisa' },
  { genreName: 'amapiano', artistName: 'Uncle Waffles' },
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

  const preExisting = ['jazz', 'funk', 'house']
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
