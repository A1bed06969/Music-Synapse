import { after } from 'next/server'

/** next/serverのafter()は、Next.jsのリクエストコンテキスト外(スタンドアロン
 * スクリプトからServer Actionを直接呼び出す場合など)で呼ぶと同期的に例外を
 * 投げる(`after` was called outside a request scope)。その場合は即座に実行する
 * フォールバックにする(Webからの通常呼び出しでは従来通りafter()でレスポンス
 * 後に遅延実行される。2026-09-14、NME 100/Fender NEXTの一括Gemini判定を
 * スクリプトから直接呼んだ際、1件目の自動反映でafter()が例外を投げてループ
 * 全体が止まってしまった実績あり)。 */
export function afterOrNow(fn: () => Promise<void> | void): void {
  try {
    after(fn)
  } catch {
    void fn()
  }
}
