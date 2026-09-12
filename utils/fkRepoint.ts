// utils/fkRepoint.ts
//
// 重複アーティスト/アルバム/トラックを削除する前に、それらのidを参照している
// 外部キー列を新しいid(本体側)へ一括で付け替えるための汎用処理。
// テーブルごとに固有のユニーク制約があり得るため、1テーブルの失敗が他の
// テーブルの処理を止めないようにする(実際の更新方法はupdateFnとして注入し、
// このファイル自体はDBに触れない)。

export type FkReference = { table: string; column: string }
export type RepointOutcome = { table: string; column: string; status: 'ok' | 'failed'; movedCount?: number; error?: string }

export async function repointForeignKeys(
  refs: FkReference[],
  fromId: string,
  toId: string,
  updateFn: (table: string, column: string, fromId: string, toId: string) => Promise<{ error: string | null; count?: number }>
): Promise<RepointOutcome[]> {
  const outcomes: RepointOutcome[] = []
  for (const ref of refs) {
    const { error, count } = await updateFn(ref.table, ref.column, fromId, toId)
    if (error) {
      outcomes.push({ table: ref.table, column: ref.column, status: 'failed', error })
    } else {
      outcomes.push({ table: ref.table, column: ref.column, status: 'ok', movedCount: count ?? 0 })
    }
  }
  return outcomes
}
