// app/admin/import/search/page.tsx
import Link from 'next/link'
import SearchRegister from './SearchRegister'

export const maxDuration = 60

export default function SearchRegisterPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
        ← URL入力での一括登録に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">検索してアーティスト・アルバム・トラックを登録</h1>
      <p className="mt-2 text-sm text-white/50">
        キーワードで検索し、候補をタップすると登録します。アーティストを選ぶとそのアーティストのアルバム・トラックを一括登録、
        アルバム/トラックを選ぶとそのアルバム(収録トラック含む)だけを登録します。
      </p>

      <SearchRegister />
    </div>
  )
}
