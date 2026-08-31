import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchShelfRecords } from '@/utils/recordDigging'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const shelf = searchParams.get('shelf')
  if (!shelf) {
    return NextResponse.json({ error: 'shelf is required' }, { status: 400 })
  }
  const supabase = await createClient()
  const records = await fetchShelfRecords(supabase, shelf)
  return NextResponse.json(records)
}
