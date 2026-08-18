import type { ItunesAlbum } from '@/utils/itunes'
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

// アルバム・トラック同期を、呼び出し元のafter()ブロックとは別のサーバー関数呼び出しへ
// 切り離してディスパッチする(utils/musicbrainzImportDispatch.tsと同じ理由)。
// さらにアルバム数が多いアーティスト(数十〜100件超)は1回の関数呼び出しの実行時間
// 予算内に収まらないため、専用ルート側で時間切れになったら続きを自分自身に
// 再ディスパッチするチャンク方式にしている(実例: L'Arc-en-Cielの85アルバムは
// 1枚ずつのトラック取得+クレジット照合で合計10分近くかかり、1回の呼び出しでは
// 1枚目しか終わらないままVercel側に強制終了されていた)。
export async function dispatchAlbumSync(
  artistId: string,
  artistName: string,
  appleMusicArtistId: string,
  albums: ItunesAlbum[],
  startIndex = 0
): Promise<void> {
  const baseUrl = internalApiBaseUrl()
  const authHeader =
    'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

  try {
    const res = await fetch(`${baseUrl}/api/admin/album-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ artistId, artistName, appleMusicArtistId, albums, startIndex }),
    })
    if (!res.ok) {
      console.error(`アルバム同期のディスパッチに失敗しました(${artistName}, startIndex=${startIndex}): HTTP ${res.status}`)
    }
  } catch (err) {
    console.error(`アルバム同期のディスパッチに失敗しました(${artistName}, startIndex=${startIndex}):`, err)
  }
}
