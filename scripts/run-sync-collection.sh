#!/bin/bash
# タイアップ(アニメ・ドラマの主題歌)を、年ごとに新しい年から順にさかのぼって集める連続実行。
#   bash scripts/run-sync-collection.sh <開始の年> <終了の年>     例: bash scripts/run-sync-collection.sh 2025 2015
# 年ごとに: アニメ集め → ドラマ集め → 曲への紐付け → iTunesで未登録を登録 → もう一度紐付け。
# LLMの無料枠が尽きたら(終了コード75)、30分待って、同じ年・種別を続きから再開する。
# 使うもの: ローカルのサーバー(localhost:3000)。iTunesは他の処理と同時に流さないこと。
cd "$(dirname "$0")/.."
FROM=${1:?開始の年}
TO=${2:?終了の年}
LOG=${SYNC_COLLECT_LOG:-/private/tmp/sync-collection.log}
RUN="npx tsx --env-file=.env.local"

say() { echo "=== $1 $(date +%m/%d\ %H:%M:%S)" | tee -a "$LOG"; }

for ((year=FROM; year>=TO; year--)); do
  for kind in anime drama; do
    say "START collect $kind $year"
    while true; do
      $RUN scripts/collect-sync-candidates.ts --kind=$kind --year=$year >> "$LOG" 2>&1
      code=$?
      if [ $code -eq 75 ]; then say "LLMの無料枠切れ。30分待って再開($kind $year)"; sleep 1800; continue; fi
      break
    done
  done
  say "START match $year"
  $RUN scripts/match-sync-candidates.ts >> "$LOG" 2>&1
  say "START register-unmatched $year"
  $RUN scripts/register-sync-unmatched.ts >> "$LOG" 2>&1
  say "START match(2) $year"
  $RUN scripts/match-sync-candidates.ts --retry-unmatched >> "$LOG" 2>&1
  say "DONE $year"
done
say "ALL DONE"
