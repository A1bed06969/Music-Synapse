#!/bin/bash
# launchd(com.musicsynapse.artist-resync)から毎日3:00に呼ばれる。全アーティストを60日で一巡する(全カタログ取込が済むまでの暫定周期)。
# launchdはfnmの初期化を経由しないため、nodeの絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/bin:/bin"
cd "$PROJECT_DIR"

exec /usr/bin/caffeinate -i "$NODE_BIN_DIR/npx" tsx --env-file=.env.local scripts/resync-all-artists.ts --cycle-days=60 --max-minutes=1200
