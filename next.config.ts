import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflareクイックトンネル経由でスマホから開発サーバーにアクセスすると、
  // devサーバーが既定でクロスオリジンのdev用アセット/エンドポイント(HMR用
  // WebSocket含む)へのリクエストをブロックするため、hydrate処理自体が
  // 完了しない(WebSocketハンドシェイクがCloudflare側で502になる)という
  // 事象が発生した(2026-09-21)。trycloudflare.comのサブドメインを許可する。
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
