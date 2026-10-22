#!/bin/bash
# launchd(com.musicsynapse.web)から常駐起動される。Colima→Supabase→next start(本番モード)の順に立ち上げる。
# 開発サーバー(next dev)は数日動かすとメモリが膨らみ続けてMac全体が重くなったため、常駐は本番ビルドにした。
# コードを変えたら `npm run deploy:local`(ビルド+再起動)で反映する。開発中は `npm run dev`(ポート3001)を使う。
# launchdはfnmの初期化を経由しないため、nodeの絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_OPTIONS="--max-old-space-size=2048"
cd "$PROJECT_DIR"

colima status >/dev/null 2>&1 || colima start
supabase status >/dev/null 2>&1 || supabase start

# 重要: 本番モードのNext.jsは .env.production.local(以前の本番Supabase向け・容量超過で停止中)を .env.local より優先して
# 読んでしまう。ローカルDBを使うため、必ず .env.local を先にシェルの環境変数へ読み込む(既に設定済みの値はNext.jsが上書きしない)。
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

# ビルドが無いと起動できない(初回やcleanの直後)ので、その場合だけ先にビルドする
[ -f .next/BUILD_ID ] || "$NODE_BIN_DIR/node" node_modules/next/dist/bin/next build

exec "$NODE_BIN_DIR/node" node_modules/next/dist/bin/next start -p 3000
