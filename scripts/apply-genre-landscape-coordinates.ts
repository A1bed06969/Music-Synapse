// scripts/apply-genre-landscape-coordinates.ts
/**
 * compute-genre-landscape-coordinates.pyの出力(genre_id -> {x, y})を
 * genre.landscape_x/landscape_yへ書き込む。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/apply-genre-landscape-coordinates.ts <coords.jsonのパス>
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { readFileSync } from 'fs'

async function main() {
  const jsonPath = process.argv[2]
  if (!jsonPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/apply-genre-landscape-coordinates.ts <coords.jsonのパス>')
    process.exit(1)
  }

  const coords: Record<string, { name: string; x: number; y: number }> = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const entries = Object.entries(coords)
  console.log(`対象: ${entries.length}件`)

  const supabase = createAdminClient()
  let done = 0
  for (const [genreId, { x, y }] of entries) {
    const { error } = await supabase.from('genre').update({ landscape_x: x, landscape_y: y }).eq('id', genreId)
    done++
    if (error) {
      console.error(`[${done}/${entries.length}] ${genreId}: 更新失敗 - ${error.message}`)
    }
  }
  console.log(`完了: ${done}件更新。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
