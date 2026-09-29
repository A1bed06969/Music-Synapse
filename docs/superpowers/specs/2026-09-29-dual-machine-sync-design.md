# Windows/Mac 2台体制ローカル開発環境 冗長化・同期 設計

## 1. 目的・背景

現在Music SynapseはMacBookの完全ローカル環境(ローカルSupabase = Docker上のPostgres/Storage)で開発している。ハードウェア故障・不調への備えとして、**Windowsタワー(メイン)とMacBook(サブ)の2台体制**へ移行する。外部クラウド(本番Supabase/Vercel)には依存せず、すべてローカル完結のまま、2台間でコード・データ・設定を安全に行き来させる。

## 2. 前提・制約

- **同時稼働はしない**: 2台のPostgresを常時同期させる仕組み(レプリケーション等)は個人開発には過剰なため採用しない。常に「今使っている方が正」の状態で、作業を切り替えるたびにスナップショットで完全に上書きする運用とする(ユーザー確認済み: 「同時に稼働することはないからスナップショットで大丈夫」)。
- **両PCで同時に作業しない**: 上記の裏返しとして、同時に両PCで書き込みが発生するとマージ不能な状態になる。運用ルールとして厳守する。
- **既存資産を活かす**: `scripts/db-backup.sh` / `db-restore.sh`(データのみdump/restore、マイグレーションは`supabase/migrations`が正)が既にあり、この方針をそのまま踏襲する。

## 3. 実測値(2026-09-29時点)

| 項目 | サイズ |
|---|---|
| DBデータダンプ(`--data-only`、非圧縮) | 275MB |
| 同、gzip圧縮後 | 62MB |
| Supabase Storageバケット | 263MB |

DBダンプ10世代ローテーション+将来3倍成長を見込んでも合計2GB程度。Google Driveの無料枠(15GB)で十分。

## 4. アーキテクチャ

### 4.1 同期チャネル: Google Drive for Desktop

両PCに「Google Drive for Desktop」アプリを導入し、Drive上に専用フォルダを作る。このアプリはDriveをローカルディスクのように見せてバックグラウンド同期するため、スクリプトからは単なるファイルコピーとして扱える(Drive APIの直接利用はしない)。

```
<Drive>/music-synapse-sync/
├── db-snapshots/       # DBダンプ、最新10世代をローテーション保持
│   └── YYYYMMDD-HHMMSS.sql
├── storage-snapshot/   # Supabase Storageバケットの中身(最新のみ、まるごと上書き)
└── env/                # .env.local, .env.production.local(常に最新のみ)
```

Drive上の実パス(Mac: `~/Library/CloudStorage/GoogleDrive-.../My Drive/...`、Windows: `G:\My Drive\...`等)はPCごとに異なるため、リポジトリ管理外の設定ファイル`.sync-config.json`(gitignore対象、各PCで1回だけ手動作成)にパスを持たせる。

```json
{ "driveSyncFolder": "/Users/th/Library/CloudStorage/GoogleDrive-.../My Drive/music-synapse-sync" }
```

### 4.2 同期スクリプト: TypeScript製(`npx tsx`)

既存の`db-backup.sh`/`db-restore.sh`はbash製でWindowsではGit Bash等が無いと動かない。このプロジェクトは元々Node/TypeScriptスクリプト中心のため、新規スクリプトは**すべてTypeScript**にしてOS差を無くす。

- `scripts/sync-push.ts` → `npm run sync:push`
- `scripts/sync-pull.ts` → `npm run sync:pull`
- `scripts/syncConfig.ts` → `.sync-config.json`読み込み共通処理

**ファイルコピーはバイト列のまま行う**(`fs.copyFile`/`fs.promises.copyFile`相当。テキストとして読んで書き直す処理は一切行わない)。これによりOS・文字コードに関係なくファイル内容の完全性を保証する(文字化け対策)。

#### `sync-push`(作業終了時に実行)

1. `git status`を確認。未コミットの変更が残っていれば**処理を中断して警告**(自動コミットはしない)
2. `git push`
3. ローカルSupabaseが起動しているか確認(`supabase status`)。していなければ中断
4. `supabase db dump --local --data-only`でDBダンプを取得し、`db-snapshots/YYYYMMDD-HHMMSS.sql`として書き込み
5. `db-snapshots/`内のファイルを日時降順に並べ、11個目以降を削除(10世代ローテーション)
6. DockerのStorageボリュームの中身を`storage-snapshot/`にコピー(まるごと上書き)
7. `.env.local` / `.env.production.local`を`env/`にコピー(まるごと上書き)
8. 各ステップの結果(成功/失敗)をコンソールに表示

#### `sync-pull`(別PCで作業再開時に実行)

1. `git pull`
2. `env/`から`.env.local` / `.env.production.local`をこのPCのリポジトリ直下にコピー
3. ローカルSupabaseが起動しているか確認。していなければ`supabase start`を促して中断
4. **確認プロンプトを出す**(「ローカルDBの現在の内容は失われます。続行しますか?」既存の`db-restore.sh`と同じ安全策を踏襲)
5. `db-snapshots/`内の最新ファイルで`supabase db reset`→dump流し込み
6. `storage-snapshot/`の中身でローカルStorageを復元
7. 各ステップの結果をコンソールに表示。最後に「`npm install`の実行を忘れずに(package.jsonが変わっている場合)」と案内

### 4.3 Git設定

**`.gitattributes`(新規)**
```
* text=auto eol=lf
*.sh text eol=lf
```
リポジトリ内のテキストファイルはLFに統一。改行コード由来のdiffノイズ・シェルスクリプト実行エラーを防ぐ。文字コード(UTF-8)自体には影響しない(改行コードのみの正規化)。

**`.editorconfig`(新規)**
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```
エディタが新規保存時に迷わずUTF-8/LFを使うようにする保険。

### 4.4 データ整合性・文字コードについて

- ローカルSupabase(Docker)はMac/Windowsどちらでも同一のLinuxコンテナ(Postgres 17固定、`supabase/config.toml`)で動くため、DBの動作自体にOS差は無い
- DB/クライアントエンコーディングは共にUTF8(確認済み)
- DBダンプはGoogle Drive経由の生ファイルコピーで転送され、gitのようなテキスト変換を一切経由しない(`backups/`相当のディレクトリはgit管理外)ため、改行コード正規化やエンコーディング変換によるデータ破損は起きない
- `node_modules`は同期対象に含めない(OS依存バイナリを含むパッケージがあるため)。`git pull`後、依存関係が変わった時だけ各PCで`npm install`を実行する

## 5. エラーハンドリング方針

- 各ステップは失敗したら即座に処理を中断し、どのステップで何が失敗したかを明示する(サイレントに次のステップへ進めない)
- `sync-pull`のDB復元は必ず確認プロンプトを挟む(誤操作でのデータ消失を防ぐ)
- Drive同期フォルダのパスが`.sync-config.json`に無い/存在しない場合は、その場でエラーにして案内を出す

## 6. スコープ外(今回やらないこと)

- 2台のPostgresの常時ライブ同期(レプリケーション)
- Google Drive APIを使った直接アップロード(Desktopアプリの自動同期に任せる)
- CI/自動実行(スクリプトは手動実行のみ)

## 7. 導入手順(ユーザーが実際に行う作業、参考)

1. Windows機にGoogle Drive for Desktop・Git・Node.js・Docker Desktop・Supabase CLIを導入
2. リポジトリをclone、`npm install`
3. Drive上に`music-synapse-sync/`フォルダを作成
4. 各PCで`.sync-config.json`を作成(Drive実パスを記入)
5. Mac側で`npm run sync:push`を1回実行し、初期スナップショットをDriveに送る
6. Windows側で`npm run sync:pull`を実行して初期状態を取り込む
