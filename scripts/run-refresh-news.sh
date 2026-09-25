#!/bin/bash
# launchd(com.musicsynapse.refresh-news)から30分おきに呼ばれる薄いラッパー。
# launchdはログインシェルのPATH/fnmの初期化を経由しないため、node/npxの
# 絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:$PATH"
cd "$PROJECT_DIR"

exec "$NODE_BIN_DIR/npx" tsx --env-file=.env.local scripts/refresh-news.ts
