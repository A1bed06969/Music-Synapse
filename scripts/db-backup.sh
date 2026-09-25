#!/usr/bin/env bash
# ローカルSupabase(supabase start)のデータをバックアップする。
# スキーマはsupabase/migrationsが正なので、ここではデータのみをダンプする
# (--data-only)。リストアはdb-restore.shで、マイグレーションからスキーマを
# 再構築したうえでこのファイルを流し込む想定。
set -euo pipefail

cd "$(dirname "$0")/.."

if ! supabase status >/dev/null 2>&1; then
  echo "ローカルSupabaseが起動していません。先に 'supabase start' を実行してください。" >&2
  exit 1
fi

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"
file="backups/${timestamp}.sql"

supabase db dump --local --data-only -f "$file"

echo "バックアップを保存しました: $file"
