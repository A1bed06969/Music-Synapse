// app/api/map/geo-boundary/route.ts
//
// マップのアーティスト出身地ドリルダウン表示専用。geo_boundaryは行によっては
// 数百KBあるため、選択中の国のアーティストが実際に使っているコードだけを
// クエリパラメータで指定して取得する(テーブル全件のselectは絶対に行わない)。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const level = searchParams.get('level')
  const codesParam = searchParams.get('codes')

  if (level !== 'municipality' && level !== 'region') {
    return NextResponse.json({ error: 'level must be "municipality" or "region"' }, { status: 400 })
  }
  if (!codesParam) {
    return NextResponse.json({ error: 'codes is required' }, { status: 400 })
  }

  const codes = codesParam.split(',').filter(Boolean)
  if (codes.length === 0) {
    return NextResponse.json([])
  }

  const supabase = await createClient()
  const { data, error } = await supabase.from('geo_boundary').select('code, name, geometry').eq('level', level).in('code', codes)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  })
}
