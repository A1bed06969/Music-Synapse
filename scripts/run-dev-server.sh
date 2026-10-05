#!/bin/bash
# launchd(com.musicsynapse.dev)から常駐起動される。Colima→Supabase→next devの順に立ち上げる。
# launchdはfnmの初期化を経由しないため、nodeの絶対パスを直接指定する。
set -euo pipefail

NODE_BIN_DIR="/Users/th/.local/share/fnm/node-versions/v24.18.1/installation/bin"
PROJECT_DIR="/Users/th/dev/music-synapse"

export PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJECT_DIR"

colima status >/dev/null 2>&1 || colima start
supabase status >/dev/null 2>&1 || supabase start

exec "$NODE_BIN_DIR/node" scripts/dev.mjs
