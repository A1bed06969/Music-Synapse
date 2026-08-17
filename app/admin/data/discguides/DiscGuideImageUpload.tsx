// app/admin/data/discguides/DiscGuideImageUpload.tsx
// ページ画像アップロード用のクライアントコンポーネント。
// Server Component からは onSubmit ハンドラを渡せないため分離している。

'use client'

import { useState } from 'react'

export default function DiscGuideImageUpload({ discGuideId }: { discGuideId: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const form = e.currentTarget
        const formData = new FormData(form)
        const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0)

        if (files.length === 0) {
          setStatus('画像を選択してください。')
          return
        }

        setUploading(true)
        setStatus(null)
        try {
          const uploadData = new FormData()
          uploadData.append('disc_guide_id', discGuideId)
          files.forEach((f) => uploadData.append('files', f))

          const response = await fetch('/api/admin/disc-guide-scan/upload', {
            method: 'POST',
            body: uploadData,
          })

          if (response.ok) {
            setStatus(`${files.length}件をアップロードしました。OCR処理中です...`)
            form.reset()
          } else {
            const body = await response.json().catch(() => ({}))
            setStatus(`アップロードに失敗しました: ${body.error ?? response.status}`)
          }
        } catch (err) {
          setStatus(`アップロードに失敗しました: ${(err as Error).message}`)
        } finally {
          setUploading(false)
        }
      }}
    >
      <input
        type="file"
        name="images"
        multiple
        accept="image/*"
        required
        className="text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white"
      />
      <button
        type="submit"
        disabled={uploading}
        className="rounded bg-green-600 px-3 py-1 text-sm hover:bg-green-700 disabled:opacity-50"
      >
        {uploading ? 'アップロード中...' : 'アップロード'}
      </button>
      {status && <span className="w-full text-xs text-white/50">{status}</span>}
    </form>
  )
}
