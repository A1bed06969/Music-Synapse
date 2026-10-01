// scripts/sync-pull.ts
//
// sync-push.tsが書き出したスナップショットを取り込む側(もう片方のPCで実行する)。
// git pull → ローカルDBを最新スナップショットで置き換え → Storageを置き換え →
// envファイルをコピー、の順。各ステップは失敗したら即座に中断する。
//
// DB復元について: album<->trackのように循環する外部キー制約があるため
// (sync-push.ts実行時にpg_dumpが警告する)、単純な順序でのINSERTでは
// 制約違反になりうる。session_replication_role='replica'にしてから復元する
// ことでFK/トリガーチェックを一時的に無効化する(スーパーユーザーのみ可能。
// ローカルSupabaseのpostgresユーザーはスーパーユーザーなので問題ない)。
// また毎回の取り込みを冪等にするため、復元前にpublicスキーマの全テーブルを
// TRUNCATEしてから流し込む(既存データを残したまま追記すると主キー重複で
// 失敗するため)。
//
// psql CLIのインストールをどちらのPCにも要求しないよう、復元はdocker exec経由で
// ローカルSupabaseのpostgresコンテナに直接SQLを流し込む(Dockerは
// supabase startの前提として既に入っている)。
//
// 実行方法: npm run sync:pull
import { execSync, spawnSync } from 'child_process'
import { readdirSync, statSync, copyFileSync, readFileSync } from 'fs'
import path from 'path'
import { loadSyncConfig, syncSubfolders } from './syncConfig'

const ENV_FILES = ['.env.local', '.env.production.local']

function fail(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(label: string) {
  console.log(`\n--- ${label} ---`)
}

function readProjectId(): string {
  const configToml = readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf-8')
  const match = configToml.match(/^project_id\s*=\s*"([^"]+)"/m)
  if (!match) fail('supabase/config.toml からproject_idを読み取れませんでした。')
  return match![1]
}

function latestFile(dir: string, suffix: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => ({ name: f, mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) fail(`${dir} に${suffix}ファイルが見つかりません。先にもう片方のPCでsync-pushを実行してください。`)
  return files[0].name
}

// supabase db dumpはpublicスキーマだけでなくstorage.buckets/storage.objects等
// (バケット定義・ファイルメタデータ)も含む。--data-onlyでは制約の都合上
// storage.bucketsは既にmigrationで作成済みの行と衝突するため、storageスキーマ側も
// 事前にTRUNCATEしておく必要がある。ただしstorage.migrationsはSupabase Storage
// 自体の内部スキーマバージョン管理テーブルであり、アプリのデータではないため
// 除外する(消すとStorage APIが壊れる)
const TRUNCATE_ALL_TABLES = `
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname IN ('public', 'storage') AND tablename != 'migrations'
  ) LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
`

function main() {
  const config = loadSyncConfig()
  const { dbSnapshots, storageSnapshot, env } = syncSubfolders(config)
  const projectId = readProjectId()
  const dbContainer = `supabase_db_${projectId}`
  const storageVolume = `supabase_storage_${projectId}`

  // 1) gitの状態確認(未コミットの変更が残っていたら中断。sync-push.tsと同じ)
  step('1/5 gitの状態を確認')
  const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' })
  if (gitStatus.trim().length > 0) {
    console.log(gitStatus)
    fail('コミットされていない変更が残っています。先に確認してから実行してください。')
  }
  console.log('OK: 作業ツリーはクリーンです。')

  // 2) git pull
  step('2/5 git pull')
  const pullResult = spawnSync('git', ['pull'], { stdio: 'inherit' })
  if (pullResult.status !== 0) fail('git pullに失敗しました。')

  // ローカルSupabaseが起動しているか確認
  const statusCheck = spawnSync('supabase', ['status'], { stdio: 'pipe' })
  if (statusCheck.status !== 0) {
    fail("ローカルSupabaseが起動していません。先に 'supabase start' を実行してください。")
  }

  // 3) DB復元(最新スナップショットで全置き換え)
  step('3/5 DBスナップショットを復元')
  const dumpName = latestFile(dbSnapshots, '.sql')
  const dumpPath = path.join(dbSnapshots, dumpName)
  console.log(`復元対象: ${dumpName}`)
  const dumpSql = readFileSync(dumpPath, 'utf-8')
  const restoreScript = [
    'SET session_replication_role = replica;',
    TRUNCATE_ALL_TABLES,
    dumpSql,
    'SET session_replication_role = DEFAULT;',
  ].join('\n')
  // -1(--single-transaction)で全体を1トランザクションに包む。途中で失敗しても
  // (ON_ERROR_STOP=1と合わせて)ロールバックされ、復元前のデータが保たれる
  const restoreResult = spawnSync(
    'docker',
    ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-1'],
    { input: restoreScript, stdio: ['pipe', 'inherit', 'inherit'] }
  )
  if (restoreResult.status !== 0) fail('DBの復元に失敗しました。')
  console.log('OK: DBを復元しました。')

  // 4) Storage復元(ボリュームの中身を一旦空にしてから展開)
  step('4/5 Storageスナップショットを復元')
  const dockerResult = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${storageVolume}:/vol`,
      '-v',
      `${storageSnapshot}:/backup`,
      'alpine',
      'sh',
      '-c',
      'rm -rf /vol/* /vol/.[!.]* 2>/dev/null; tar xzf /backup/storage.tar.gz -C /vol',
    ],
    { stdio: 'inherit' }
  )
  if (dockerResult.status !== 0) fail('Storageスナップショットの復元に失敗しました。')
  console.log('OK: Storageを復元しました。')

  // 5) env
  step('5/5 環境変数ファイルをコピー')
  for (const file of ENV_FILES) {
    const src = path.join(env, file)
    try {
      copyFileSync(src, path.join(process.cwd(), file))
      console.log(`コピー: ${file}`)
    } catch {
      console.log(`スキップ(存在しない): ${file}`)
    }
  }

  console.log('\n=== sync-pull 完了 ===')
}

main()
