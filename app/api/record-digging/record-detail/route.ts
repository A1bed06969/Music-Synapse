import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchRecordDetail } from '@/utils/recordDigging'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const albumId = searchParams.get('albumId')
  const artistId = searchParams.get('artistId')
  if (!albumId || !artistId) {
    return NextResponse.json({ error: 'albumId and artistId are required' }, { status: 400 })
  }
  const supabase = await createClient()
  const detail = await fetchRecordDetail(supabase, albumId, artistId)
  return NextResponse.json(detail)
}
