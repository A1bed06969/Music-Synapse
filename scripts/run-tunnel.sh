#!/bin/bash
# launchd(com.musicsynapse.tunnel)から常駐起動される。trycloudflareのURLは起動ごとに変わるため、
# 取得したURLをtunnel-url.txtに書き出して通知する。caffeinateでトンネル稼働中のアイドルスリープを防ぐ。
set -uo pipefail

LOG_DIR="/Users/th/Library/Logs/music-synapse"
URL_FILE="$LOG_DIR/tunnel-url.txt"
mkdir -p "$LOG_DIR"

/usr/bin/caffeinate -is /opt/homebrew/bin/cloudflared tunnel --no-autoupdate --url http://localhost:3000 2>&1 |
  while IFS= read -r line; do
    echo "$line"
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" || true)
    if [ -n "$url" ]; then
      echo "$url" >"$URL_FILE"
      /usr/bin/osascript -e "display notification \"$url\" with title \"Music Synapse トンネル\"" || true
    fi
  done
