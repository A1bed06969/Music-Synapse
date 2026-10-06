// app/api/admin/ranking/register-album/route.ts
//
// キュレーションコンテンツ(ranking_entry)へのアルバム紐付けを、iTunesの実カタログと
// 照合しながら1件登録する。registerAlbumFromSearch(app/admin/import/search/
// actions.ts)は内部でafter()を複数回呼ぶため、スクリプトから直接呼ぶと
// "after was called outside a request scope"で落ちる(disc-guide-scan/registerと
// 同じ理由。詳細はそちらのコメント参照)。Route Handlerの中で呼ぶことで
// 正しいリクエストコンテキストを持たせる。
import { createAdminClient } from '@/utils/Supabase/admin';
import { findAppleMusicAlbumMatch } from '@/utils/discGuideImport';
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions';
import { resolveCurationAlbum } from '@/utils/curationAlbumResolve';
import { classifyAlbumType } from '@/utils/albumType';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { rankingId, periodDate, artistName, title, year, rank, strict } = await req.json();

  if (!rankingId || !periodDate || !artistName || !title) {
    return NextResponse.json({ success: false, message: '必須項目が不足しています。' }, { status: 400 });
  }

  const supabase = createAdminClient();
  let albumId: string | undefined;
  let matchedItunes = false;

  // strict: 表記ゆれ(邦題/カタカナ)をLLMで解決し、見つからなければ名前だけのアーティスト/
  // アルバムを作らず保留として返す(名前一致の新規作成が既存の英語名アーティストと重複するため)
  let matched: { collectionId: number; country: 'JP' | 'US' } | null = null;
  if (strict) {
    const resolved = await resolveCurationAlbum(artistName, title);
    if (!resolved.found) {
      return NextResponse.json({ success: false, pending: true, message: resolved.reason });
    }
    await adoptNameOnlyStub(supabase, artistName, resolved.appleArtistId);
    matched = { collectionId: resolved.collectionId, country: resolved.country };
  } else {
    const exact = await findAppleMusicAlbumMatch(artistName, title);
    if (exact) matched = { collectionId: exact.collectionId, country: 'JP' };
  }
  if (matched) {
    const result = await registerAlbumFromSearch(matched.collectionId, matched.country);
    if (result.success) {
      const { data: registeredAlbum } = await supabase
        .from('album')
        .select('id')
        .eq('apple_music_album_id', String(matched.collectionId))
        .limit(1)
        .maybeSingle();
      if (registeredAlbum) {
        albumId = registeredAlbum.id;
        matchedItunes = true;
      }
    } else {
      console.error(`iTunes経由の登録に失敗("${title}"): ${result.message}`);
    }
  }

  if (!albumId && strict) {
    return NextResponse.json({ success: false, pending: true, message: 'Apple Musicのアルバム登録に失敗' });
  }

  if (!albumId) {
    const { data: existingArtist } = await supabase
      .from('artist')
      .select('id')
      .ilike('name', artistName)
      .limit(1)
      .maybeSingle();

    let artistId = existingArtist?.id;
    if (!artistId) {
      const { data: newArtist, error } = await supabase.from('artist').insert({ name: artistName }).select('id').single();
      if (error || !newArtist) {
        return NextResponse.json({ success: false, message: `アーティスト作成失敗: ${error?.message}` });
      }
      artistId = newArtist.id;
    }

    const { data: newAlbum, error: albumError } = await supabase
      .from('album')
      .insert({
        artist_id: artistId,
        title,
        release_date: year ? `${year}-01-01` : null,
        album_type: classifyAlbumType(title, null),
        streaming_status: 'unreleased',
      })
      .select('id')
      .single();

    if (albumError || !newAlbum) {
      return NextResponse.json({ success: false, message: `アルバム作成失敗: ${albumError?.message}` });
    }
    albumId = newAlbum.id;
  }

  // 同じアルバムが既にこの企画にリンク済みなら重複登録しない(スクリプトの
  // 再実行時の冪等性。前回after()の例外で中断した回など、アルバム自体は
  // 作成済みでranking_entryだけ未登録のケースをやり直せるようにするため)
  const { data: existingEntry } = await supabase
    .from('ranking_entry')
    .select('id')
    .eq('ranking_id', rankingId)
    .eq('album_id', albumId)
    .maybeSingle();

  if (existingEntry) {
    return NextResponse.json({ success: true, albumId, matchedItunes, alreadyLinked: true });
  }

  const { error: entryError } = await supabase.from('ranking_entry').insert({
    ranking_id: rankingId,
    rank: rank ?? null,
    period_date: periodDate,
    album_id: albumId,
  });

  if (entryError) {
    return NextResponse.json({ success: false, message: `ranking_entry登録失敗: ${entryError.message}` });
  }

  return NextResponse.json({ success: true, albumId, matchedItunes });
}

// リストと同じ名前で、Apple Music ID・MusicBrainz IDを持たない既存行(以前の名前だけ登録)が
// あれば、それに今回特定したApple Music IDを付与して流用させる(新規作成による重複を防ぐ)
async function adoptNameOnlyStub(
  supabase: ReturnType<typeof createAdminClient>,
  artistName: string,
  appleArtistId: number
) {
  const { data: withId } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(appleArtistId))
    .limit(1);
  if (withId && withId.length > 0) return;
  const { data: stubs } = await supabase
    .from('artist')
    .select('id')
    .ilike('name', artistName)
    .is('apple_music_artist_id', null)
    .is('musicbrainz_id', null);
  if (stubs && stubs.length === 1) {
    await supabase.from('artist').update({ apple_music_artist_id: String(appleArtistId) }).eq('id', stubs[0].id);
  }
}
