// サーバー関数から自分自身のAPIルートへ自己fetchする際のベースURLを解決する。
// process.env.VERCEL_URLはデプロイごとに変わる一意なURL(例:
// music-synapse-xxxxx.vercel.app)で、Vercelのデプロイ保護がかかっていると
// アプリ側のBasic認証を通過する前に401で弾かれる。本番では固定の
// VERCEL_PROJECT_PRODUCTION_URL(カスタムドメイン/エイリアス)を優先する。
export function internalApiBaseUrl(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}
