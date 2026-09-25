#!/usr/bin/env bash
# db-backup.shで取ったデータダンプをローカルSupabaseへリストアする。
# 1. supabase db reset でマイグレーション定義からスキーマを再構築(既存データは消える)
# 2. psqlでダンプファイル(INSERT文)を流し込む
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -ne 1 ]; then
  echo "使い方: $0 <backups/YYYYMMDD-HHMMSS.sql>" >&2
  exit 1
fi

file="$1"
if [ ! -f "$file" ]; then
  echo "ファイルが見つかりません: $file" >&2
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "ローカルSupabaseが起動していません。先に 'supabase start' を実行してください。" >&2
  exit 1
fi

echo "警告: ローカルDBの現在のデータはすべて失われ、$file の内容で置き換わります。"
read -r -p "続行しますか? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "中止しました。"
  exit 1
fi

echo "マイグレーションからスキーマを再構築しています..."
supabase db reset

# ホストにpsqlクライアントが入っている保証がないため、Supabase CLIが起動した
# Postgresコンテナの中のpsqlをdocker exec経由で使う。
db_container="$(docker ps --filter "name=supabase_db_" --format "{{.Names}}" | head -1)"
if [ -z "$db_container" ]; then
  echo "ローカルDBのDockerコンテナが見つかりません。'supabase status' で状態を確認してください。" >&2
  exit 1
fi

echo "バックアップを流し込んでいます: $file"
docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$file" >/dev/null

echo "リストア完了: $file"
