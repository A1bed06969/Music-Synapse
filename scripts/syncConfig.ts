// scripts/syncConfig.ts
//
// sync-push/sync-pullが共通で使う設定読み込み。Google Drive上の実パスは
// PCごとに違う(Mac: ~/Library/CloudStorage/GoogleDrive-.../My Drive/...、
// Windows: G:\My Drive\...等)ため、リポジトリ管理外(.gitignore対象)の
// .sync-config.jsonに各PCで1回だけ書いておく。
//
// .sync-config.json の中身:
//   { "driveSyncFolder": "/path/to/Drive/music-synapse-sync" }
import { existsSync, readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { spawnSync, type SpawnSyncOptions } from 'child_process'

export type SyncConfig = {
  driveSyncFolder: string
}

const CONFIG_PATH = path.join(process.cwd(), '.sync-config.json')

export function loadSyncConfig(): SyncConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `.sync-config.json が見つかりません。リポジトリ直下に以下の内容で作成してください:\n` +
        `{ "driveSyncFolder": "<このPCでのGoogle Drive同期フォルダの実パス>/music-synapse-sync" }`
    )
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<SyncConfig>
  if (!raw.driveSyncFolder) {
    throw new Error('.sync-config.json に driveSyncFolder がありません。')
  }
  if (!existsSync(raw.driveSyncFolder)) {
    throw new Error(
      `driveSyncFolderのパスが存在しません: ${raw.driveSyncFolder}\n` +
        `Google Drive for Desktopが起動して同期済みか確認してください。`
    )
  }
  return { driveSyncFolder: raw.driveSyncFolder }
}

export function syncSubfolders(config: SyncConfig) {
  const dbSnapshots = path.join(config.driveSyncFolder, 'db-snapshots')
  const storageSnapshot = path.join(config.driveSyncFolder, 'storage-snapshot')
  const env = path.join(config.driveSyncFolder, 'env')
  for (const dir of [dbSnapshots, storageSnapshot, env]) {
    mkdirSync(dir, { recursive: true })
  }
  return { dbSnapshots, storageSnapshot, env }
}

// Windowsにはsupabase CLIをグローバル導入していないため、npx経由(.cmdなのでshell必須)で呼ぶ
export function runSupabase(args: string[], options: SpawnSyncOptions = {}) {
  if (process.platform === 'win32') {
    return spawnSync('npx', ['supabase', ...args], { ...options, shell: true })
  }
  return spawnSync('supabase', args, options)
}
