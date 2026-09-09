/** ページ遷移中に表示する共通のローディング表示。
 * 各ルートセグメントのloading.tsxから使う。Next.jsのloading.tsxは対象セグメントを
 * Suspenseで包むため、これがあるとサーバーのレンダリング完了を待たずに即座に
 * 画面が切り替わり、「クリックしても何も起きない」状態を防げる。 */
export default function PageLoading({ label = '読み込んでいます' }: { label?: string }) {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center px-6 py-32 text-white/50">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70"
        aria-hidden="true"
      />
      <p className="mt-4 text-sm">{label}</p>
    </div>
  )
}
