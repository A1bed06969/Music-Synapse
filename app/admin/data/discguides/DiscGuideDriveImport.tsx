// app/admin/data/discguides/DiscGuideDriveImport.tsx
// Google Driveフォルダから画像を読み込むためのフォーム。ローカルアップロード
// (DiscGuideImageUpload.tsx)と同じdisc_guide_scan_pendingパイプラインに合流する。
//
// サーバーが自分自身を再帰ディスパッチするchunk方式(album-syncなどこのアプリの
// 他のバックグラウンド処理と同じパターン)は、間隔をどれだけ広げてもVercelの
// ループ検知(HTTP 508、同一関数への4回連続自己呼び出しで必ず発火)に引っかかる
// ことを本番で確認した。呼び出し元をこのクライアントコンポーネントに変え、
// タブを開いている間ブラウザから/api/admin/disc-guide-scan/drive-importを
// 繰り返し呼ぶことで回避する(1回の呼び出しはサーバー自己呼び出しではないため
// ループ検知の対象にならない)。
'use client'

import { useState } from 'react'

type DriveImageFile = { id: string; name: string; mimeType: string }

type Progress = {
  status: 'idle' | 'listing' | 'running' | 'done' | 'error'
  message: string
  processed: number
  total: number
}

export default function DiscGuideDriveImport({ discGuideId }: { discGuideId: string }) {
  const [folderUrl, setFolderUrl] = useState('')
  const [progress, setProgress] = useState<Progress>({ status: 'idle', message: '', processed: 0, total: 0 })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setProgress({ status: 'listing', message: 'Driveフォルダを確認しています...', processed: 0, total: 0 })

    let folderId: string
    let files: DriveImageFile[]
    try {
      const res = await fetch('/api/admin/disc-guide-scan/drive-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      folderId = body.folderId
      files = body.files
    } catch (err) {
      setProgress({ status: 'error', message: (err as Error).message, processed: 0, total: 0 })
      return
    }

    setProgress({ status: 'running', message: '', processed: 0, total: files.length })

    let startIndex = 0
    while (startIndex < files.length) {
      try {
        const res = await fetch('/api/admin/disc-guide-scan/drive-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discGuideId, folderId, files, startIndex }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        startIndex = body.nextIndex
        setProgress({ status: 'running', message: '', processed: startIndex, total: files.length })
      } catch (err) {
        setProgress({
          status: 'error',
          message: `${(err as Error).message}(${startIndex}/${files.length}件まで処理済み。フォームを再送信すると続きから再開できます)`,
          processed: startIndex,
          total: files.length,
        })
        return
      }
    }

    setProgress({ status: 'done', message: '', processed: files.length, total: files.length })
  }

  const isBusy = progress.status === 'listing' || progress.status === 'running'

  return (
    <div className="mt-2">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={folderUrl}
          onChange={(e) => setFolderUrl(e.target.value)}
          placeholder="GoogleDriveフォルダのURL(または共有設定後のフォルダID)"
          required
          disabled={isBusy}
          className="min-w-[280px] flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isBusy}
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isBusy ? '読み込み中...' : 'Driveから読み込む'}
        </button>
      </form>

      {progress.status === 'listing' && (
        <p className="mt-1 text-xs text-white/50">{progress.message}</p>
      )}
      {progress.status === 'running' && (
        <p className="mt-1 text-xs text-white/50">
          読み込み中: {progress.processed}/{progress.total}件(このタブを開いたままにしてください)
        </p>
      )}
      {progress.status === 'done' && (
        <p className="mt-1 text-xs text-green-400">
          完了しました: {progress.total}件処理しました。スキャン確認ページで内容を確認してください。
        </p>
      )}
      {progress.status === 'error' && (
        <p className="mt-1 text-xs text-red-400">エラー: {progress.message}</p>
      )}
    </div>
  )
}
