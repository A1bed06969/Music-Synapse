// utils/albumSyncDispatch.tsからのみ叩かれる内部専用エンドポイント。
// アルバムを1件ずつ同期しつつ経過時間を計測し、maxDurationの安全マージン内で
// 打ち切ったら続きを自分自身に再ディスパッチする(理由はutils/albumSyncDispatch.tsのコメント参照)。
// 全アルバムを処理し終えたら配信停止検知とMusicBrainzプロフィール取込を行う。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fillMissingArtistImage, registerSingleAlbum, flagDelistedAlbums } from '@/app/admin/import/actions'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch'
import type { ItunesAlbum } from '@/utils/itunes'

export const maxDuration = 60
// 1アルバムの処理はMusicBrainz/Discogsクレジット取込のタイムアウト(8秒×2、
// app/admin/import/actions.tsのwithTimeout参照)を含めても最大20秒程度で収まる。
// この予算を超えたらチェックせず打ち切る(maxDurationの60秒に対して十分な余裕を残す)
const TIME_BUDGET_MS = 25_000

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { artistId, artistName, appleMusicArtistId, albums, startIndex } = body as {
    artistId: string
    artistName: string
    appleMusicArtistId: string
    albums: ItunesAlbum[]
    startIndex: number
  }

  if (!artistId || !Array.isArray(albums)) {
    return NextResponse.json({ error: 'artistId and albums are required' }, { status: 400 })
  }

  after(async () => {
    try {
      const supabase = createAdminClient()

      if (startIndex === 0) {
        await fillMissingArtistImage(supabase, artistId, appleMusicArtistId)
      }

      const startedAt = Date.now()
      let i = startIndex
      for (; i < albums.length; i++) {
        // 1件は必ず処理してから時間切れ判定する(判定を先にすると空振りのまま
        // 自己ディスパッチを繰り返し無限ループになりうるため)
        if (i > startIndex && Date.now() - startedAt > TIME_BUDGET_MS) break
        try {
          await registerSingleAlbum(supabase, artistId, artistName, albums[i])
        } catch (err) {
          console.error(`アルバム同期に失敗しました(${artistName}, ${albums[i].collectionName}):`, err)
        }
      }

      if (i < albums.length) {
        await dispatchAlbumSync(artistId, artistName, appleMusicArtistId, albums, i)
      } else {
        console.log(`アルバム同期完了(${artistName}): ${albums.length}件`)
        await flagDelistedAlbums(supabase, artistId, albums)
        await dispatchMusicBrainzImport(artistId)
        revalidatePath(`/artists/${artistId}`)
      }
    } catch (err) {
      console.error(`アルバム同期で予期しないエラーが発生しました(${artistName}):`, err)
    }
  })

  return NextResponse.json({ dispatched: true })
}
