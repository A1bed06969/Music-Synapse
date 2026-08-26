import type { SupabaseClient } from '@supabase/supabase-js'

/** PostgRESTの1リクエストあたり行数上限(既定1000件)を超えるテーブルから
 * 全件を安全に取得する。単純に.select()するとサイレントに1000件で打ち切られ、
 * 並び順によっては後半のデータが一覧から丸ごと消える(実際にこの上限が原因の
 * 不具合がこのプロジェクトで複数回発生している)。 */
export async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderColumn: string
): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}
