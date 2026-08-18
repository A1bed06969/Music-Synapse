// MusicBrainzプロフィール取込(自動照合・SNS/ジャンル/メンバーシップ取込)を、呼び出し元の
// after()ブロックとは別のサーバー関数呼び出しとして切り離して実行するためのディスパッチャ。
//
// after()はレスポンス後に"追加の実行時間"をもらえるわけではなく、リクエスト全体の
// maxDuration予算を共有する。アルバム・トラック同期(iTunes取得+DB書き込み)と同じ
// after()内でMusicBrainz取込(1req/秒のレート制限あり)まで直列に実行すると、
// 前段の処理で予算を使い切ってVercelに関数を強制終了され、MusicBrainz取込だけが
// 例外も出さずに静かに中断される事例が確認された。
// 専用のAPIルートへ自己fetchすることで、MusicBrainz取込に独立したmaxDuration予算を持たせる。
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

export async function dispatchMusicBrainzImport(artistId: string): Promise<void> {
  const baseUrl = internalApiBaseUrl()
  const authHeader =
    'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

  try {
    const res = await fetch(`${baseUrl}/api/admin/musicbrainz-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ artistId }),
    })
    if (!res.ok) {
      console.error(`MusicBrainzプロフィール取込のディスパッチに失敗しました(${artistId}): HTTP ${res.status}`)
    }
  } catch (err) {
    console.error(`MusicBrainzプロフィール取込のディスパッチに失敗しました(${artistId}):`, err)
  }
}
