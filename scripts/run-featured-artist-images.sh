#!/bin/bash
# launchd(com.musicsynapse.featured-artist-images)から毎日10:00に呼ばれる。feat.から名前だけで
# 登録されたアーティストのうち、本人を確かめられた人にだけ画像を付ける(1日1,500人まで)。
# launchdはfnmの初期化を経由しないため、nodeの絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/bin:/bin"
cd "$PROJECT_DIR"

exec /usr/bin/caffeinate -i "$NODE_BIN_DIR/npx" tsx --env-file=.env.local scripts/backfill-featured-artist-images.ts --limit=1500
