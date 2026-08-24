/**
 * COUNTRY GENRE HISTORYのデータ投入スクリプト。populate-jazz/.../rnb-genre-history.ts
 * と同じ方針。DBには既に "country"(空stub) "country pop"(空stub) "country rock"
 * (空stub) が存在していたため、それらを土台に肉付けする。他は完全新規ノード。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/populate-country-genre-history.ts
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
    name: 'country',
    originYear: 1927,
    originYearLabel: '1920年代',
    originCountry: 'アメリカ南部アパラチア',
    backgroundNote:
      'アパラチア地方の口承音楽(Appalachian Folk / Old-Time Music)とBlues——特にJimmie Rodgersの「ブルーヨーデル」に見られる直接的影響——が、1920年代のレコード産業拡大とラジオ普及(1925年開始のGrand Ole Opry)を背景に商業音楽として結実した。1927年の「ブリストル・セッションズ」(Carter Family、Jimmie Rodgers参加)がジャンルとしての起点とされる。',
    parents: [parent('blues', 'influence')],
  },
  {
    name: 'honky tonk',
    originYear: 1940,
    originYearLabel: '1940年代',
    originCountry: 'アメリカ(テキサス)',
    backgroundNote: '米南部の酒場文化から生まれた様式。スティールギターと失恋・酒をテーマにした歌詞を特徴とする。Hank Williamsが代表格。',
    parents: [parent('country')],
  },
  {
    name: 'bluegrass',
    originYear: 1940,
    originYearLabel: '1940年代',
    originCountry: 'アメリカ(ケンタッキー)',
    backgroundNote: '高速のバンジョー／マンドリンと「ハイロンサム」ハーモニーを特徴とする。Bill Monroeが確立した。',
    parents: [parent('country')],
  },
  {
    name: 'nashville sound',
    originYear: 1957,
    originYearLabel: '1950年代後半',
    originCountry: 'アメリカ(ナッシュビル)',
    backgroundNote: 'ストリングス導入によりポップ寄りに洗練させた様式。Patsy Clineが代表的。ナッシュビルが業界の中心地として確立した時代。',
    parents: [parent('country')],
  },
  {
    name: 'outlaw country',
    originYear: 1973,
    originYearLabel: '1970年代',
    originCountry: 'アメリカ',
    backgroundNote: 'Nashville体制の産業化・商業主義への反発。より生々しく反抗的な表現を追求した。Willie Nelson、Waylon Jenningsが代表格。',
    parents: [parent('nashville sound')],
  },
  {
    name: 'southern rock',
    originYear: 1970,
    originYearLabel: '1970年代',
    originCountry: 'アメリカ南部',
    backgroundNote: 'Country、Blues Rock、Hard Rockが融合した米南部発のロック様式。Lynyrd Skynyrdが代表格。',
    parents: [parent('country', 'crossover'), parent('blues rock', 'crossover')],
  },
  {
    name: 'country rock',
    originYear: 1971,
    originYearLabel: '1970年代',
    originCountry: 'アメリカ(カリフォルニア)',
    backgroundNote: 'Southern Rockと並行して、カリフォルニアのシーンから生まれたCountryとRockの融合。Eaglesが代表格。',
    parents: [parent('southern rock', 'influence'), parent('country')],
  },
  {
    name: 'country pop',
    originYear: 1990,
    originYearLabel: '1990年代〜',
    originCountry: 'アメリカ',
    backgroundNote:
      'ポップ・プロダクションの本格導入によるクロスオーバーヒットの時代。Garth Brooks、Shania Twainが代表格。2010年代以降はBro-Countryを経てHip-Hopとの融合が進み、Lil Nas X「Old Town Road」(2019)がジャンル境界を巡る論争を呼んだ。',
    parents: [parent('country')],
  },
]

const EXTRA_LINEAGE: { childName: string; parentName: string; relationType: RelationType }[] = []

const BAD_HIGHLIGHT_FIXES: { genreName: string; artistName: string }[] = []

const HIGHLIGHTS: HighlightDef[] = [
  { genreName: 'country', artistName: 'Carter Family' },
  { genreName: 'country', artistName: 'Jimmie Rodgers', note: '「ブルーヨーデル」でBluesの影響を示した。' },
  { genreName: 'honky tonk', artistName: 'Hank Williams', workTitle: 'Lovesick Blues' },
  { genreName: 'bluegrass', artistName: 'Bill Monroe' },
  { genreName: 'nashville sound', artistName: 'Patsy Cline' },
  { genreName: 'outlaw country', artistName: 'Willie Nelson', workTitle: 'Red Headed Stranger', eventYear: 1975 },
  { genreName: 'outlaw country', artistName: 'Waylon Jennings' },
  { genreName: 'southern rock', artistName: 'Lynyrd Skynyrd' },
  { genreName: 'country rock', artistName: 'Eagles' },
  { genreName: 'country pop', artistName: 'Garth Brooks' },
  { genreName: 'country pop', artistName: 'Shania Twain' },
  { genreName: 'country pop', artistName: 'Kacey Musgraves' },
  { genreName: 'country pop', artistName: 'Lil Nas X', workTitle: 'Old Town Road', eventYear: 2019, classification: 'approach', note: 'Country/Hip-Hopのジャンル境界を巡る論争の象徴となった楽曲。' },
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

  const preExisting = ['blues', 'blues rock']
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
