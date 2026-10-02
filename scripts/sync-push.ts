// scripts/sync-push.ts
//
// 作業を終える時に実行する: git push + ローカルDB/Storage/envをGoogle Drive
// 同期フォルダへスナップショットとして書き出す。もう片方のPCがsync-pullで
// これを取り込む(docs/superpowers/specs/2026-09-29-dual-machine-sync-design.md参照)。
//
// 各ステップは失敗したら即座に中断する(サイレントに次へ進めない)。
//
// 実行方法: npm run sync:push
import { execSync, spawnSync } from 'child_process'
import { readdirSync, statSync, unlinkSync, copyFileSync, readFileSync } from 'fs'
import path from 'path'
import { loadSyncConfig, runSupabase, syncSubfolders } from './syncConfig'

const DB_SNAPSHOT_KEEP = 10
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

function main() {
  const config = loadSyncConfig()
  const { dbSnapshots, storageSnapshot, env } = syncSubfolders(config)

  // 1) gitの状態確認(未コミットの変更が残っていたら中断。自動コミットはしない)
  step('1/5 gitの状態を確認')
  const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' })
  if (gitStatus.trim().length > 0) {
    console.log(gitStatus)
    fail('コミットされていない変更が残っています。先にコミットしてから実行してください。')
  }
  console.log('OK: 作業ツリーはクリーンです。')

  // 2) git push
  step('2/5 git push')
  const pushResult = spawnSync('git', ['push'], { stdio: 'inherit' })
  if (pushResult.status !== 0) fail('git pushに失敗しました。')

  // 3) ローカルSupabaseが起動しているか確認
  const statusCheck = runSupabase(['status'], { stdio: 'pipe' })
  if (statusCheck.status !== 0) {
    fail("ローカルSupabaseが起動していません。先に 'supabase start' を実行してください。")
  }

  // 4) DBダンプ(データのみ)
  step('3/5 DBスナップショットを作成')
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15) // YYYYMMDD-HHMMSS
  const dumpPath = path.join(dbSnapshots, `${timestamp}.sql`)
  const dumpResult = runSupabase(['db', 'dump', '--local', '--data-only', '-f', dumpPath], {
    stdio: 'inherit',
  })
  if (dumpResult.status !== 0) fail('DBダンプに失敗しました。')
  console.log(`保存: ${dumpPath}`)

  // 古いスナップショットを削除(直近DB_SNAPSHOT_KEEP件のみ残す)
  const files = readdirSync(dbSnapshots)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ name: f, mtime: statSync(path.join(dbSnapshots, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const old of files.slice(DB_SNAPSHOT_KEEP)) {
    unlinkSync(path.join(dbSnapshots, old.name))
    console.log(`古いスナップショットを削除: ${old.name}`)
  }

  // 5) Storageバケットの中身をコピー(dockerボリュームをtarにまとめてコピー)
  step('4/5 Storageスナップショットを作成')
  const projectId = readProjectId()
  const storageVolume = `supabase_storage_${projectId}`
  const storageTarPath = path.join(storageSnapshot, 'storage.tar.gz')
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
      'tar',
      'czf',
      '/backup/storage.tar.gz',
      '-C',
      '/vol',
      '.',
    ],
    { stdio: 'inherit' }
  )
  if (dockerResult.status !== 0) fail('Storageスナップショットの作成に失敗しました。')
  console.log(`保存: ${storageTarPath}`)

  // 6) env
  step('5/5 環境変数ファイルをコピー')
  for (const file of ENV_FILES) {
    const src = path.join(process.cwd(), file)
    try {
      copyFileSync(src, path.join(env, file))
      console.log(`コピー: ${file}`)
    } catch {
      console.log(`スキップ(存在しない): ${file}`)
    }
  }

  console.log('\n=== sync-push 完了 ===')
}

main()
