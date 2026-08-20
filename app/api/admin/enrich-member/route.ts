// utils/memberEnrichmentDispatch.tsからのみ叩かれる内部専用エンドポイント。
// バンドメンバーとして新規作成/再利用されたartist行1件分の肉付け
// (SNS/ジャンル/出身地+iTunesカタログ照合)を、独立したmaxDuration予算で行う。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { enrichNewlyCreatedMember } from '@/utils/artistProfileImport'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { artistId, artistName, mbid } = await request.json()
  if (!artistId || typeof artistId !== 'string' || !mbid || typeof mbid !== 'string') {
    return NextResponse.json({ error: 'artistId and mbid are required' }, { status: 400 })
  }

  after(async () => {
    const supabase = createAdminClient()
    try {
      await enrichNewlyCreatedMember(supabase, artistId, artistName ?? '', mbid)
      revalidatePath(`/artists/${artistId}`)
    } catch (err) {
      console.error(`メンバー肉付けに失敗しました(${artistName}):`, err)
    }
  })

  return NextResponse.json({ dispatched: true })
}
