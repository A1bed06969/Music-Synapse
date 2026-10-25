#!/bin/bash
# launchd(com.musicsynapse.origin-places)から1日1回呼ばれる。Music Planet Tour の地球儀に、新しく出身地の座標が
# 入ったアーティストを反映する: 新しい地点だけを逆引き(取得済みの地点は .cache から再利用) → 都市(place)に紐づけ。
# launchdはログインシェルのPATHを経由しないため、docker・python3の場所を足しておく。
set -euo pipefail

PROJECT_DIR="/Users/th/dev/music-synapse"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$PROJECT_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 開始"
/usr/bin/python3 scripts/collect-origin-reverse-geocode.py
/usr/bin/python3 scripts/build-origin-places.py
echo "=== $(date '+%Y-%m-%d %H:%M:%S') 終了"
