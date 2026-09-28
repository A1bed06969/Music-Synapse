// app/api/admin/ranking/upgrade-minimal-album/route.ts
//
// register-album route(scripts/import-rolling-stone-500.ts等)がiTunesで
// 一致しなかった場合に作る「最小限登録」(streaming_status: 'unreleased'、
// ジャケット・トラック無し)のアルバムを、改善したfindAppleMusicAlbumMatch
// (接尾辞付き再発盤の救済ロジック追加、2026-09-27)で再照合し、見つかれば
// 実カタログのアルバムに差し替える。register-albumと同じ理由で、
// registerAlbumFromSearchの呼び出しにはリクエストコンテキストが要るため
// Route Handlerにする。
import { createAdminClient } from '@/utils/Supabase/admin';
import { findAppleMusicAlbumMatch } from '@/utils/discGuideImport';
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { rankingEntryId } = await req.json();
  if (!rankingEntryId) {
    return NextResponse.json({ success: false, message: 'rankingEntryIdが必要です。' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: entry } = await supabase
    .from('ranking_entry')
    .select('id, album_id, album:album_id(id, title, streaming_status, artist:artist_id(name))')
    .eq('id', rankingEntryId)
    .maybeSingle();
  if (!entry) {
    return NextResponse.json({ success: false, message: '対象のranking_entryが見つかりませんでした。' });
  }
  const album = Array.isArray(entry.album) ? entry.album[0] : entry.album;
  if (!album || album.streaming_status !== 'unreleased') {
    return NextResponse.json({ success: true, upgraded: false, message: '最小限登録ではないためスキップしました。' });
  }
  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist;
  if (!artist) {
    return NextResponse.json({ success: false, message: 'アーティスト情報が取得できませんでした。' });
  }

  const matched = await findAppleMusicAlbumMatch(artist.name, album.title);
  if (!matched) {
    return NextResponse.json({ success: true, upgraded: false, message: '今回も一致しませんでした。' });
  }

  const registerResult = await registerAlbumFromSearch(matched.collectionId);
  if (!registerResult.success) {
    return NextResponse.json({ success: false, message: `iTunes経由の登録に失敗: ${registerResult.message}` });
  }

  const { data: newAlbum } = await supabase
    .from('album')
    .select('id, title')
    .eq('apple_music_album_id', String(matched.collectionId))
    .maybeSingle();
  if (!newAlbum) {
    return NextResponse.json({ success: false, message: '登録後のアルバムが見つかりませんでした。' });
  }

  const oldAlbumId = album.id;

  const { error: updateError } = await supabase
    .from('ranking_entry')
    .update({ album_id: newAlbum.id })
    .eq('id', rankingEntryId);
  if (updateError) {
    return NextResponse.json({ success: false, message: `ranking_entryの更新に失敗: ${updateError.message}` });
  }

  // 差し替えで最小限アルバムを参照する行が無くなったら削除する
  // (他のranking_entry・trackから参照されていないことを確認してから)
  const [{ count: rankingRefs }, { count: trackRefs }] = await Promise.all([
    supabase.from('ranking_entry').select('id', { count: 'exact', head: true }).eq('album_id', oldAlbumId),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('album_id', oldAlbumId),
  ]);
  if (!rankingRefs && !trackRefs) {
    await supabase.from('album').delete().eq('id', oldAlbumId);
  }

  return NextResponse.json({ success: true, upgraded: true, newAlbumTitle: newAlbum.title, newAlbumId: newAlbum.id });
}
