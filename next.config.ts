import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflareクイックトンネル経由でスマホから開発サーバーにアクセスすると、
  // devサーバーが既定でクロスオリジンのdev用アセット/エンドポイント(HMR用
  // WebSocket含む)へのリクエストをブロックするため、hydrate処理自体が
  // 完了しない(WebSocketハンドシェイクがCloudflare側で502になる)という
  // 事象が発生した(2026-09-21)。trycloudflare.comのサブドメインを許可する。
  allowedDevOrigins: ["*.trycloudflare.com"],
  // 開発中のみ表示されるルートインジケーター(「N」バッジ)。スマホでの
  // 確認時にヘッダーのハンバーガーメニューと重なって押せなくなる事例が
  // あったため無効化する(本番ビルドには元々出ない)
  devIndicators: false,
};

export default nextConfig;
