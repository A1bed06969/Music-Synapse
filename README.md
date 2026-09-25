This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## ローカル開発環境

このプロジェクトはDBアクセスをすべて`@supabase/supabase-js`(PostgRESTベース)経由で行っているため、素のPostgresコンテナでは動かない。**Supabase CLIのローカルスタック**(Postgres + PostgREST + GoTrue + Storage + Studio + Kong一式)をDocker上で起動して使う。本番のホスト型Supabaseとゼロコード差分で切り替えられる。

### 前提ツール

- [Colima](https://github.com/abiosoft/colima)(GUI不要のDocker Desktop代替) + Docker CLI: `brew install colima docker`
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started): `brew install supabase/tap/supabase`

### 初回セットアップ

```bash
colima start          # 未起動の場合。以後は再起動不要(PC再起動時のみ再実行)
supabase start        # supabase/migrations 配下を全件適用してローカルDBを構築
```

`supabase start`が完了すると、接続情報(URLとanon/service_roleキー)が表示される。この値を`.env.local`に設定する(値は`supabase status`でいつでも再表示できる):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase startの出力のanon key>
SUPABASE_SERVICE_ROLE_KEY=<supabase startの出力のservice_role key>
```

上記以外の環境変数(Spotify/Discogs/Gemini/Google/YouTube等の各種APIキー)はSupabaseと無関係なので、本番用の値をそのまま使ってよい。

### 日常の使い方

```bash
colima start   # Dockerデーモンが落ちている場合のみ
supabase start # 既にコンテナが起動していれば何もしない。停止していれば再起動
npm run dev    # Next.js開発サーバー(http://localhost:3000)
```

| 用途 | URL |
|---|---|
| アプリ本体 | http://localhost:3000 |
| Supabase Studio(テーブル閲覧・SQL実行) | http://localhost:54323 |
| メール確認(Auth関連のテストメール) | http://localhost:54324 |
| REST API直叩き | http://localhost:54321 |
| Postgres直接接続 | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

作業を終えるときは`supabase stop`でコンテナを止める(データは`supabase stop --no-backup`しない限り保持される)。Colima自体は起動したままでよい。

### マイグレーション

- `supabase/migrations/`配下のSQLファイルが正。ファイル名は`YYYYMMDDNNNNNN_説明.sql`(日付+6桁連番)で、この順に適用される
- スキーマを変更したら、新しいマイグレーションファイルを追加して`supabase db reset`(全マイグレーションを最初から再適用、ローカルDBのデータは消える)で動作確認する
- 一部のテーブル(`00000000000001_reconstructed_base_schema.sql`)は、本番障害当時にマイグレーション未管理のまま存在していたテーブル群をアプリケーションコードから逆算して復元したもの。本番の実スキーマと完全一致は保証しないため、本番との差異に気付いたら随時修正する

### バックアップ/リストア

スキーマは`supabase/migrations`が正なので、バックアップ対象は**データのみ**。

```bash
npm run db:backup                          # backups/YYYYMMDD-HHMMSS.sql に保存(gitignore対象)
npm run db:restore -- backups/<file>.sql   # マイグレーションからスキーマを再構築 → データを流し込む
```

- `db:restore`は実行前に確認プロンプトが出る(既存データはすべて失われる)
- 内部的には`supabase db dump --local --data-only`でダンプし、`supabase db reset`で最新マイグレーション状態のスキーマに戻してから、ローカルDBコンテナ内の`psql`(`docker exec`経由、ホストに`psql`のインストールは不要)で流し込む
- スキーマ自体を変更したい場合はダンプ/リストアではなく、新しいマイグレーションファイルを追加すること

### 本番環境への切り替え

本番のSupabase接続情報は`.env.production.local`に退避してある。本番に戻す場合は、その中の3行(`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY`)を`.env.local`にコピーするだけでよい。**本番DBへの書き込みを伴う操作を行う前は、必ずどちら向きの設定か(`.env.local`の該当3行)を確認すること。**

### データ登録の方針

実データの登録・修正作業は[docs/data-registration-guidelines.md](./docs/data-registration-guidelines.md)の優先順位・ルールに従う。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
