// app/api/admin/disc-guide-scan/auto-register/route.ts
//
// OCRで読み取ったディスクガイドの1作品を、確認画面を通さずに自動で登録する。
// キュレーション企画と同じ照合(utils/curationAlbumResolve.ts: タイトル完全一致→JP/USストアの
// 作品一覧からLLMで同一作品を判定、確信度0.9以上のみ)で確実に特定できたものだけ登録し、
// 特定できなかった作品は確認画面(/admin/data/discguides/confirm)に残す。
// registerAlbumFromSearchが内部でafter()を使うため、Route Handlerとして実行する。
import { createAdminClient } from '@/utils/Supabase/admin'
import { resolveCurationAlbum } from '@/utils/curationAlbumResolve'
import { registerOneConfirmedAlbum } from '@/utils/discGuideRegister'
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

type Extracted = { artist_name?: string; title?: string; release_year?: number }

export async function POST(req: NextRequest) {
  const { pending_id, index } = (await req.json()) as { pending_id?: string; index?: number }
  if (!pending_id || typeof index !== 'number') {
    return NextResponse.json({ error: 'pending_id and index are required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { data: pending } = await supabase
    .from('disc_guide_scan_pending')
    .select('id, disc_guide_id, extracted_data, registered_indices')
    .eq('id', pending_id)
    .single()
  if (!pending) return NextResponse.json({ error: 'Pending record not found' }, { status: 404 })

  const items = (Array.isArray(pending.extracted_data) ? pending.extracted_data : []) as Extracted[]
  const item = items[index]
  if (!item?.artist_name || !item?.title) return NextResponse.json({ status: 'skipped', reason: '作品名が読み取れていない' })
  if ((pending.registered_indices ?? []).includes(index)) return NextResponse.json({ status: 'already' })

  const resolved = await resolveCurationAlbum(item.artist_name, item.title)
  if (!resolved.found) return NextResponse.json({ status: 'pending', reason: resolved.reason })

  const result = await registerAlbumFromSearch(resolved.collectionId, resolved.country)
  if (!result.success) return NextResponse.json({ status: 'pending', reason: `Apple Musicからの登録に失敗: ${result.message}` })
  const { data: album } = await supabase
    .from('album')
    .select('id')
    .eq('apple_music_album_id', String(resolved.collectionId))
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!album) return NextResponse.json({ status: 'pending', reason: '登録後にアルバムが見つからない' })

  const registered = await registerOneConfirmedAlbum(supabase, pending.disc_guide_id, {
    extracted_index: index,
    title: item.title,
    artist_name: item.artist_name,
    album_id: album.id,
  })
  if (!registered.selectionRegistered) return NextResponse.json({ status: 'pending', reason: '掲載作品の登録に失敗' })

  // 同時実行で上書きしないよう、最新のregistered_indicesを読み直してから足す
  const { data: latest } = await supabase.from('disc_guide_scan_pending').select('registered_indices').eq('id', pending_id).single()
  const indices = Array.from(new Set([...(latest?.registered_indices ?? []), index]))
  const update: Record<string, unknown> = { registered_indices: indices }
  if (indices.length >= items.length) update.status = 'registered'
  await supabase.from('disc_guide_scan_pending').update(update).eq('id', pending_id)

  return NextResponse.json({ status: 'registered', albumId: album.id, via: resolved.via })
}
