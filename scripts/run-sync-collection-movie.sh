#!/bin/bash
# タイアップ(映画の主題歌・挿入歌)を、年ごとに集める連続実行。run-sync-collection.sh の映画版。
#   bash scripts/run-sync-collection-movie.sh <開始の年> <終了の年>     例: bash scripts/run-sync-collection-movie.sh 2026 2020
# 年ごとに: 映画を集める → 曲への紐付け → iTunesで未登録を登録 → もう一度紐付け。
# LLMの無料枠が尽きたら(終了コード75)、30分待って、同じ年を続きから再開する。iTunesは他の処理と同時に流さないこと。
cd "$(dirname "$0")/.."
FROM=${1:?開始の年}
TO=${2:?終了の年}
LOG=${SYNC_COLLECT_LOG:-/private/tmp/sync-collection-movie.log}
RUN="npx tsx --env-file=.env.local"
say() { echo "=== $1 $(date +%m/%d\ %H:%M:%S)" | tee -a "$LOG"; }
for ((year=FROM; year>=TO; year--)); do
  say "START collect movie $year"
  while true; do
    $RUN scripts/collect-sync-candidates.ts --kind=movie --year=$year >> "$LOG" 2>&1
    code=$?
    if [ $code -eq 75 ]; then say "LLMの無料枠切れ。30分待って再開(movie $year)"; sleep 1800; continue; fi
    break
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
