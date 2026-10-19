// utils/gameData.ts
/**
 * ジャケット神経衰弱ゲーム(/game)のデータ取得。テーマ=ディスクガイド1冊、掲載アルバムが盤面の材料になる。
 * 盤面に使えるのは、ジャケット画像とアーティストが揃っているアルバムだけ。
 */
import type { createClient } from '@/utils/Supabase/server'
import type { createAdminClient } from '@/utils/Supabase/admin'

type Supabase = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>

export type GameTheme = {
  id: string
  title: string
  publisher: string | null
  year: number | null
}

export type ThemeAlbum = {
  albumId: string
  title: string
  jacketUrl: string
  artistName: string
}

export type BoardPair = {
  albumId: string
  albumTitle: string
  jacketUrl: string
  artistName: string
  /** 1枚目をめくったときに流す試聴(30秒)。無いアルバムもある */
  previewUrl: string | null
}

export type BoardCard = { key: string; albumId: string }

export type Board = {
  themeId: string
  pairs: BoardPair[]
  /** シャッフル済み(サーバーで並べて渡す。クライアントで並べるとハイドレーションがずれる) */
  cards: BoardCard[]
}

export const BOARD_PAIRS = 8
/** 制限時間(最初のカードをめくってから) */
export const GAME_SECONDS = 30
/** 残り時間で星を決める(クリア時): この秒数以上で3つ・2つ、それ未満は1つ */
export const STAR3_SECONDS_LEFT = 10
export const STAR2_SECONDS_LEFT = 5

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function fetchThemes(supabase: Supabase): Promise<GameTheme[]> {
  const { data } = await supabase
    .from('disc_guide')
    .select('id, title, publisher, published_year')
    .order('title', { ascending: true })
  return (data ?? []).map((g) => ({ id: g.id, title: g.title, publisher: g.publisher, year: g.published_year }))
}

/** そのテーマ(ディスクガイド)の、盤面に使えるアルバム全件 */
export async function fetchThemeAlbums(supabase: Supabase, themeId: string): Promise<ThemeAlbum[]> {
  const rows: ThemeAlbum[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('disc_guide_selection')
      .select('album:album_id(id, title, jacket_url, artist:artist_id(name))')
      .eq('disc_guide_id', themeId)
      .order('id', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const album = firstOf(r.album)
      const artist = album ? firstOf(album.artist) : null
      if (album?.jacket_url && artist?.name) {
        rows.push({ albumId: album.id, title: album.title, jacketUrl: album.jacket_url, artistName: artist.name })
      }
    }
    if ((data ?? []).length < 1000) break
  }
  return rows
}

/** アルバムごとの試聴URL。代表曲に試聴があればそれ、無ければ収録順で最初に試聴のある曲 */
async function fetchPreviewUrls(supabase: Supabase, albumIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (albumIds.length === 0) return result
  const { data: albums } = await supabase.from('album').select('id, representative_track_id').in('id', albumIds)
  const representative = new Map((albums ?? []).map((a) => [a.id, a.representative_track_id as string | null]))
  const { data: tracks } = await supabase
    .from('track')
    .select('id, album_id, track_no, preview_url')
    .in('album_id', albumIds)
    .not('preview_url', 'is', null)
    .order('track_no', { ascending: true })
  const byAlbum = new Map<string, { id: string; preview_url: string }[]>()
  for (const t of tracks ?? []) {
    if (!t.preview_url) continue
    byAlbum.set(t.album_id, [...(byAlbum.get(t.album_id) ?? []), { id: t.id, preview_url: t.preview_url }])
  }
  for (const [albumId, list] of byAlbum) {
    const rep = list.find((t) => t.id === representative.get(albumId))
    result.set(albumId, (rep ?? list[0]).preview_url)
  }
  return result
}

/** 盤面を作る。同じジャケット2枚が1ペア。同じアーティストの別作品が並ぶと紛らわしいので、アーティストは1組ずつにする */
export async function buildBoard(supabase: Supabase, themeId: string): Promise<Board | null> {
  const albums = await fetchThemeAlbums(supabase, themeId)
  const picked: ThemeAlbum[] = []
  const usedArtists = new Set<string>()
  for (const a of shuffle(albums)) {
    if (usedArtists.has(a.artistName)) continue
    usedArtists.add(a.artistName)
    picked.push(a)
    if (picked.length === BOARD_PAIRS) break
  }
  if (picked.length < BOARD_PAIRS) return null

  const previews = await fetchPreviewUrls(supabase, picked.map((p) => p.albumId))
  const pairs: BoardPair[] = picked.map((p) => ({
    albumId: p.albumId,
    albumTitle: p.title,
    jacketUrl: p.jacketUrl,
    artistName: p.artistName,
    previewUrl: previews.get(p.albumId) ?? null,
  }))
  const cards: BoardCard[] = shuffle(
    pairs.flatMap((p) => [
      { key: `${p.albumId}:a`, albumId: p.albumId },
      { key: `${p.albumId}:b`, albumId: p.albumId },
    ])
  )
  return { themeId, pairs, cards }
}
