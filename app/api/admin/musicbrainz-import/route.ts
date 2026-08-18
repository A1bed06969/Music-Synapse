// utils/musicbrainzImportDispatch.tsからのみ叩かれる内部専用エンドポイント。
// アルバム・トラック同期とは別のサーバー関数呼び出しとして実行されるため、
// 独自のmaxDuration予算でMusicBrainzプロフィール取込(1req/秒のレート制限あり)を行える。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { artistId } = await request.json()
  if (!artistId || typeof artistId !== 'string') {
    return NextResponse.json({ error: 'artistId is required' }, { status: 400 })
  }

  after(async () => {
    const supabase = createAdminClient()
    try {
      const result = await autoImportArtistProfileFromMusicBrainz(supabase, artistId)
      console.log(`MusicBrainzプロフィール取込(${artistId}): ${result}`)
    } catch (err) {
      console.error(`MusicBrainzプロフィール取込に失敗しました(${artistId}):`, err)
    }
    revalidatePath(`/artists/${artistId}`)
  })

  return NextResponse.json({ dispatched: true })
}
