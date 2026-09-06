import { revalidatePath } from 'next/cache'

/** registerPickIdToRotation(app/admin/data/media/radio-airplay-pick/actions.ts)のように、
 * 通常のWebリクエスト(ボタン押下によるサーバーアクション)と、バックグラウンド
 * スクリプトからの直接importの両方から呼ばれる関数向け。revalidatePathは
 * Next.jsのリクエストライフサイクル外(CLIスクリプトからの直接呼び出し)で使うと
 * 「Invariant: static generation store missing」で例外を投げ、本処理(DB更新)まで
 * 巻き込んで止めてしまうため、その場合は握りつぶす。 */
export function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // リクエストコンテキスト外からの呼び出し(スクリプト実行時)。無視してよい。
  }
}
