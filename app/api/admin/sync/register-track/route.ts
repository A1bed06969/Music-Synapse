// app/api/admin/sync/register-track/route.ts
//
// タイアップ候補(sync_candidate)の曲を、Apple Musicで探して、カタログにアルバムごと登録する。
// registerAlbumFromSearch は内部で after() を使うため、スクリプトから直接は呼べず、このRoute Handlerの中で呼ぶ
// (ranking/register-album と同じ理由)。
//
// 誤った別人・別曲を登録しないため、LLMは使わず、決定的な判定だけで採用する:
//  - 歌い手: Apple Musicの表記を正規化して、Wikipediaの表記(「A feat. B」なら先頭のAも)と一致
//  - 曲名: TV size・feat.などの付記だけ外して一致(English ver. / Live / Remix などの別バージョン表記は外さない)
//  - 一致が複数あれば、ライブ・カラオケ・インスト盤を避ける
// 日本のストアで一致しなければ、米国のストアも探す。どちらにも一致しなければ登録せず、「一致なし」として返す。
import { NextRequest, NextResponse } from 'next/server'
import { ItunesUnavailableError, searchTracks } from '@/utils/itunes'
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions'
import { artistVariants, BAD_VERSION, norm, normTitle } from '@/utils/syncMatching'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { artistName, songTitle } = (await req.json()) as { artistName?: string; songTitle?: string }
  if (!artistName || !songTitle) {
    return NextResponse.json({ success: false, message: 'artistName と songTitle が必要です。' }, { status: 400 })
  }

  const wantArtists = artistVariants(artistName).map(norm)
  const wantTitle = normTitle(songTitle)
  const artistOk = (apple: string) => {
    const first = apple.split(/\s*(?:feat\.?|featuring|with|×|＆|&|、|,)\s*/i)[0]
    return wantArtists.includes(norm(apple)) || wantArtists.includes(norm(first))
  }
  // 日本のストアで見つからなければ、米国のストアも探す(海外の作品は日本で配信されていないことがある)
  let best: Awaited<ReturnType<typeof searchTracks>>[number] | null = null
  let country = 'JP'
  let candidateCount = 0
  for (const c of ['JP', 'US']) {
    let results: Awaited<ReturnType<typeof searchTracks>>
    try {
      results = await searchTracks(`${artistName} ${songTitle}`, 10, c)
    } catch (err) {
      if (err instanceof ItunesUnavailableError) {
        return NextResponse.json({ success: false, retry: true, cooldownSec: err.cooldownSec, message: 'iTunesが一時的に使えません' })
      }
      throw err
    }
    candidateCount += results.length
    const passing = results.filter((r) => artistOk(r.artistName) && normTitle(r.trackName) === wantTitle)
    if (passing.length > 0) {
      best = passing.find((r) => !BAD_VERSION.test(r.collectionName) && !BAD_VERSION.test(r.trackName)) ?? passing[0]
      country = c
      break
    }
  }
  if (!best) {
    return NextResponse.json({ success: false, noMatch: true, message: `Apple Musicに「${artistName}」の「${songTitle}」の一致なし(候補${candidateCount}件)` })
  }

  const result = await registerAlbumFromSearch(best.collectionId, country)
  if (!result.success) {
    return NextResponse.json({ success: false, message: `登録に失敗: ${result.message}` })
  }
  return NextResponse.json({ success: true, artistName: best.artistName, trackName: best.trackName, collectionName: best.collectionName })
}
