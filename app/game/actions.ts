'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/Supabase/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { buildBoard, fetchThemeAlbums, GAME_SECONDS, STAR2_SECONDS_LEFT, STAR3_SECONDS_LEFT, type Board } from '@/utils/gameData'

export async function newBoard(themeId: string): Promise<Board | null> {
  const supabase = await createClient()
  return buildBoard(supabase, themeId)
}

export type GameResult = {
  stars: number
  /** 今回新しく図鑑に入った枚数(ペア+レア枠) */
  newCount: number
  collected: number
  total: number
  rare: { albumId: string; title: string; jacketUrl: string; artistName: string } | null
}

/** ゲーム終了時に呼ぶ。揃えたペアのアルバムを図鑑に入れ、3つ星のクリアならレア枠を1枚足す。
 * 図鑑に入れるアルバムは、必ずそのテーマ(ディスクガイド)の掲載作品に限る(外から任意のIDを入れられないように)。 */
export async function completeGame(input: {
  themeId: string
  albumIds: string[]
  cleared: boolean
  misses: number
  moves: number
  /** クリア時の残り時間(ミリ秒)。時間切れなら0 */
  timeLeftMs: number
}): Promise<GameResult> {
  const supabase = createAdminClient()
  const themeAlbums = await fetchThemeAlbums(supabase, input.themeId)
  const themeById = new Map(themeAlbums.map((a) => [a.albumId, a]))

  const albumIds = Array.from(new Set(input.albumIds)).filter((id) => themeById.has(id))
  const misses = Math.max(0, Math.floor(input.misses))
  const secondsLeft = Math.max(0, Math.min(GAME_SECONDS, input.timeLeftMs / 1000))
  const stars = !input.cleared ? 0 : secondsLeft >= STAR3_SECONDS_LEFT ? 3 : secondsLeft >= STAR2_SECONDS_LEFT ? 2 : 1

  const { data: existingRows } = await supabase.from('game_collection').select('album_id')
  const collectedIds = new Set((existingRows ?? []).map((r) => r.album_id as string))

  const toInsert: { album_id: string; theme_id: string; source: 'pair' | 'rare' }[] = albumIds
    .filter((id) => !collectedIds.has(id))
    .map((id) => ({ album_id: id, theme_id: input.themeId, source: 'pair' }))

  // 3つ星(残り時間が十分あるクリア)の達成報酬: まだ持っていない、受賞・ランキング選出のあるアルバムを1枚
  let rare: GameResult['rare'] = null
  if (stars === 3) {
    const candidateIds = themeAlbums
      .map((a) => a.albumId)
      .filter((id) => !collectedIds.has(id) && !albumIds.includes(id))
    const notable = new Set<string>()
    for (let i = 0; i < candidateIds.length; i += 200) {
      const chunk = candidateIds.slice(i, i + 200)
      const [{ data: awards }, { data: rankings }] = await Promise.all([
        supabase.from('award_entry').select('album_id').in('album_id', chunk),
        supabase.from('ranking_entry').select('album_id').in('album_id', chunk),
      ])
      for (const r of [...(awards ?? []), ...(rankings ?? [])]) if (r.album_id) notable.add(r.album_id as string)
    }
    const pool = candidateIds.filter((id) => notable.has(id))
    if (pool.length > 0) {
      const id = pool[Math.floor(Math.random() * pool.length)]
      const a = themeById.get(id)!
      rare = { albumId: id, title: a.title, jacketUrl: a.jacketUrl, artistName: a.artistName }
      toInsert.push({ album_id: id, theme_id: input.themeId, source: 'rare' })
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('game_collection').upsert(toInsert, { onConflict: 'album_id', ignoreDuplicates: true })
    if (error) throw new Error(`図鑑への保存に失敗しました: ${error.message}`)
  }
  await supabase.from('game_play_log').insert({
    theme_id: input.themeId,
    cleared: input.cleared,
    stars,
    misses,
    moves: Math.max(0, Math.floor(input.moves)),
  })

  const themeIds = new Set(themeAlbums.map((a) => a.albumId))
  const collectedInTheme = [...collectedIds, ...toInsert.map((r) => r.album_id)].filter((id) => themeIds.has(id))
  revalidatePath('/game')
  revalidatePath(`/game/collection/${input.themeId}`)
  return { stars, newCount: toInsert.length, collected: new Set(collectedInTheme).size, total: themeAlbums.length, rare }
}
