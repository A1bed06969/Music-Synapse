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
import { applyEditionGrouping } from '@/utils/applyEditionGrouping'
import type { ItunesAlbum } from '@/utils/itunes'

export const maxDuration = 60
// クレジット取込(MusicBrainz/Discogs、1曲あたり最大5秒×2)はここでは省略する
// (registerSingleAlbumのskipCreditImport=true、下記呼び出し参照)。理由:
// 大量アルバムを持つアーティストの一括同期で1曲ごとにクレジット取込を挟むと、
// 45秒のチャンク予算内で4〜5枚程度しか処理できず、自己ディスパッチの回数
// (ホップ数)が増えすぎてVercelのループ検知(508 Loop Detected)に引っかかり、
// カタログの取り込みが静かに止まる不具合を実際のアーティスト(71枚のカタログ)で
// 確認した。クレジット省略後は1曲あたり1〜2秒程度で済むため、同じ45秒予算でも
// 十分な枚数を処理でき、ホップ数を大きく減らせる。省略したクレジットは
// scripts/backfill-album-credits.tsが別途拾う(月次cron)
const TIME_BUDGET_MS = 40_000

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { artistId, artistName, appleMusicArtistId, albums, startIndex, country } = body as {
    artistId: string
    artistName: string
    appleMusicArtistId: string
    albums: ItunesAlbum[]
    startIndex: number
    country?: string
  }

  if (!artistId || !Array.isArray(albums)) {
    return NextResponse.json({ error: 'artistId and albums are required' }, { status: 400 })
  }

  after(async () => {
    try {
      const supabase = createAdminClient()

      if (startIndex === 0) {
        await fillMissingArtistImage(supabase, artistId, appleMusicArtistId, country ?? 'JP')
      }

      const startedAt = Date.now()
      let i = startIndex
      for (; i < albums.length; i++) {
        // 1件は必ず処理してから時間切れ判定する(判定を先にすると空振りのまま
        // 自己ディスパッチを繰り返し無限ループになりうるため)
        if (i > startIndex && Date.now() - startedAt > TIME_BUDGET_MS) break
        try {
          await registerSingleAlbum(supabase, artistId, artistName, albums[i], true, country ?? 'JP')
        } catch (err) {
          console.error(`アルバム同期に失敗しました(${artistName}, ${albums[i].collectionName}):`, err)
        }
      }

      if (i < albums.length) {
        // 自己ディスパッチ(同じURLへの短時間の連続呼び出し)がVercelのループ検知
        // (508 Loop Detected)に引っかかることを実際のアーティストで確認したため、
        // 次のチャンクへのディスパッチ前に少し間を空ける(45秒予算消費後でも
        // maxDuration=60秒に対してまだ余裕がある)
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        await dispatchAlbumSync(artistId, artistName, appleMusicArtistId, albums, i, country ?? 'JP')
      } else {
        console.log(`アルバム同期完了(${artistName}): ${albums.length}件`)
        await flagDelistedAlbums(supabase, artistId, albums)
        // このアーティストの全アルバムが揃ったので、版違い(デラックス版・地域別版等)の
        // 統合をこのタイミングで1回だけ実行する(チャンク途中では実行しない)
        const groupingResult = await applyEditionGrouping(supabase, { artistId })
        if (groupingResult.groupsDetected > 0) {
          console.log(
            `アルバム版統合(${artistName}): ${groupingResult.groupsDetected}件のグループを検出、${groupingResult.updated}件を適用`
          )
        }
        await dispatchMusicBrainzImport(artistId)
        revalidatePath(`/artists/${artistId}`)
      }
    } catch (err) {
      console.error(`アルバム同期で予期しないエラーが発生しました(${artistName}):`, err)
    }
  })

  return NextResponse.json({ dispatched: true })
}
