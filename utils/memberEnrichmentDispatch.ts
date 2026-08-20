// バンドメンバーのスタブ作成直後の肉付け(SNS/ジャンル/出身地+iTunesカタログ照合)を、
// 呼び出し元(utils/artistProfileImport.tsのメンバーシップループ)とは別のサーバー関数
// 呼び出しへ切り離してディスパッチする(utils/albumSyncDispatch.ts・
// utils/musicbrainzImportDispatch.tsと同じ理由)。メンバーの多いバンドで
// メンバーごとの肉付けを直列にawaitすると、Vercelの60秒タイムアウトに
// 引っかかって誰も肉付けされないまま関数ごと強制終了される不具合を確認したため。
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

export async function dispatchMemberEnrichment(artistId: string, artistName: string, mbid: string): Promise<void> {
  const baseUrl = internalApiBaseUrl()
  const authHeader =
    'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

  try {
    const res = await fetch(`${baseUrl}/api/admin/enrich-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ artistId, artistName, mbid }),
    })
    if (!res.ok) {
      console.error(`メンバー肉付けのディスパッチに失敗しました(${artistName}): HTTP ${res.status}`)
    }
  } catch (err) {
    console.error(`メンバー肉付けのディスパッチに失敗しました(${artistName}):`, err)
  }
}
