#!/bin/bash
# 常駐している本番サーバー(com.musicsynapse.web)を、今のコードでビルドし直して再起動する。
#   npm run deploy:local
# ビルドに失敗したときは再起動しない(今動いているサーバーをそのまま残す)。
set -euo pipefail
cd "$(dirname "$0")/.."
# .env.production.local(以前の本番Supabase向け)ではなく、ローカルDBの .env.local を使ってビルドする
# (NEXT_PUBLIC_* はビルド時に埋め込まれるため、ここで取り違えるとブラウザ側も別のDBを見てしまう)
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
node node_modules/next/dist/bin/next build
launchctl kickstart -k "gui/$(id -u)/com.musicsynapse.web"
echo "再起動しました。数秒後に http://localhost:3000 で反映されます。"
