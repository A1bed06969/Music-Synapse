#!/bin/bash
# launchd(com.musicsynapse.artist-images)から毎日0:30に呼ばれる。画像の無いアーティストに
# Apple Musicのアーティスト画像を付ける(1日3,000人まで。止められないよう1件ごとに2〜3秒空ける)。
# launchdはfnmの初期化を経由しないため、nodeの絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/bin:/bin"
cd "$PROJECT_DIR"

# Apple Musicへのアクセスが短時間に集中しないよう、前回の開始から20時間たっていなければ今回は飛ばす
# (手動で日中に流した日の深夜分など)
STAMP="/Users/th/Library/Logs/music-synapse/artist-images.last-start"
NOW=$(date +%s)
if [ -f "$STAMP" ] && [ $((NOW - $(cat "$STAMP"))) -lt 72000 ]; then
  echo "$(date) 前回の開始から20時間たっていないため今回は飛ばします"
  exit 0
fi
echo "$NOW" > "$STAMP"

exec /usr/bin/caffeinate -i "$NODE_BIN_DIR/npx" tsx --env-file=.env.local scripts/backfill-artist-images.ts --limit=3000
