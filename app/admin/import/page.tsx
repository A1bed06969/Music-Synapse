// app/admin/import/page.tsx
import Link from 'next/link'
import ImportForm from './ImportForm'

// クライアントコンポーネント内でのexportはRoute Segment Configとして機能しないため、
// サーバーコンポーネントであるこのファイルで指定する
export const maxDuration = 60

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">アーティスト一括登録(iTunes API)</h1>
      <p className="mt-2 text-sm text-white/50">
        Apple MusicのアーティストページURLを1行に1件ずつ入力すると、それぞれのアルバム・トラックを一括で取得・登録します。
        アルバム・トラックの取込は登録完了後にバックグラウンドで進行します。
      </p>

      <ImportForm />

      <Link href="/" className="mt-10 block text-xs text-white/40 hover:text-white/70">
        ← ホームに戻る
      </Link>
    </div>
  )
}
