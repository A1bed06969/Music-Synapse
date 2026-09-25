import { type RankingPreview } from './actions'

/** キュレーションコンテンツ1件のメインビジュアル・タイトル・説明文(左カラム)。
 * エントリ一覧(中央カラム)とは別コンポーネントに分けている
 * (2026-09-24、タイトル/ビジュアルを左・一覧を中央に配置する構成に変更)。
 * 全件を中央カラムでそのまま表示するため、詳細ページ(/media/features/[id])への
 * 遷移リンクは置かない(2026-09-24、ユーザー要望)。 */
export default function RankingPreviewHeader({ preview }: { preview: RankingPreview }) {
  return (
    <div>
      {preview.imageUrl && (
        <div className="aspect-[21/9] w-full overflow-hidden rounded-lg bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.imageUrl} alt={preview.name} className="h-full w-full object-cover" />
        </div>
      )}

      <p className="mt-4 text-xs text-white/40">{preview.mediaName ?? 'メディア企画'}</p>
      <h2 className="mt-1 text-lg font-bold">{preview.name}</h2>
      {preview.description && <p className="mt-2 text-sm leading-relaxed text-white/70">{preview.description}</p>}
      <p className="mt-3 text-xs text-white/30">全{preview.totalCount}件</p>
    </div>
  )
}
