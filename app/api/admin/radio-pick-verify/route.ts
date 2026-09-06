// scripts/verify-radio-pick-matches.tsからのみ叩かれる内部専用エンドポイント。
// runGeminiVerifyForOneMatch→registerPickIdToRotation→registerAlbumFromSearch/
// registerTrackFromSearchの経路はNext.jsのafter()(MusicBrainz取込・版統合・
// 新規アーティストの全カタログ同期のディスパッチに使用)を呼んでおり、
// リクエストコンテキスト外(CLIスクリプトからの直接呼び出し)では例外になる。
// utils/safeRevalidate.tsで対応したrevalidatePathと違い、after()の呼び出し先は
// 通常のWeb操作でも使われるバックグラウンド処理の起点そのものであり、握りつぶすと
// MusicBrainzプロフィール取込・版統合・新規アーティストの全カタログ取込が
// 静かに欠落してしまう。共有コードを変更する代わりに、実際のリクエストとして
// 処理できるようこのAPIルート経由でスクリプトから呼ぶ。
import { NextRequest, NextResponse } from 'next/server'
import { runGeminiVerifyForOneMatch } from '@/app/admin/data/media/radio-airplay-pick/geminiMatchActions'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { pickId } = await request.json()
  if (!pickId || typeof pickId !== 'string') {
    return NextResponse.json({ error: 'pickId is required' }, { status: 400 })
  }

  const result = await runGeminiVerifyForOneMatch(pickId)
  return NextResponse.json(result)
}
