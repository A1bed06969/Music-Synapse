// app/api/admin/disc-guide-scan/apply-discogs/route.ts
//
// disc_guide_scan_pendingの一括登録で「最小限登録」(streaming_status: 'unreleased'、
// ジャケット・トラック無し)になったアルバムへ、Discogsのリリース情報(ジャケット・
// 発売日・レーベル・トラックリスト)を適用する。app/admin/data/albums/[id]/
// discogs-lookup/actions.tsのapplyDiscogsLookupと同じDB書き込みロジックだが、
// あちらはフォーム送信からのredirect()前提のためバッチ実行では使えない。
// discogsReleaseIdを直接受け取る(呼び出し側でfindDiscogsReleaseMatchによる
// 厳密一致確認を済ませておく想定。ここで再検索はしない)。
import { createAdminClient } from '@/utils/Supabase/admin';
import { fetchDiscogsReleaseInfo } from '@/utils/discogs';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { albumId, discogsReleaseId } = (await req.json()) as { albumId?: string; discogsReleaseId?: number };
  if (!albumId || !discogsReleaseId) {
    return NextResponse.json({ success: false, message: 'albumIdとdiscogsReleaseIdが必要です。' }, { status: 400 });
  }

  const discogsUrl = `https://www.discogs.com/release/${discogsReleaseId}`;
  const supabase = createAdminClient();

  let info;
  try {
    info = await fetchDiscogsReleaseInfo(discogsUrl);
  } catch (err) {
    return NextResponse.json({ success: false, message: `取得に失敗しました: ${(err as Error).message}` });
  }

  if (!info.imageUrl && !info.releaseDate && !info.labelName && info.tracks.length === 0) {
    return NextResponse.json({ success: true, applied: false, message: 'リリースページから情報を読み取れませんでした。' });
  }

  let labelId: string | undefined;
  if (info.labelName) {
    const { data: existingLabel } = await supabase.from('label').select('id').eq('name', info.labelName).maybeSingle();
    if (existingLabel) {
      labelId = existingLabel.id;
    } else {
      const { data: newLabel, error: labelError } = await supabase
        .from('label')
        .insert({ name: info.labelName })
        .select('id')
        .single();
      if (labelError) {
        console.error(`レーベルの登録に失敗しました("${info.labelName}"):`, labelError.message);
      } else {
        labelId = newLabel?.id;
      }
    }
  }

  // discogs_urlは画像が取れた場合のみ保存する(discogs-lookup/actions.tsと同じ理由:
  // 画像抽出だけ失敗した状態で保存すると「未マッチ」判定から静かに外れてしまう)
  const update: Record<string, unknown> = {};
  if (info.imageUrl) {
    update.discogs_url = discogsUrl;
    update.jacket_url = info.imageUrl;
  }
  if (info.releaseDate) update.release_date = info.releaseDate;
  if (labelId) update.label_id = labelId;

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase.from('album').update(update).eq('id', albumId);
    if (updateError) {
      return NextResponse.json({ success: false, message: `更新に失敗しました: ${updateError.message}` });
    }
  }

  let tracksAdded = 0;
  if (info.tracks.length > 0) {
    const { count: existingTrackCount } = await supabase
      .from('track')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumId);

    if (!existingTrackCount) {
      const { data: albumArtist } = await supabase.from('album').select('artist_id').eq('id', albumId).single();
      const { error: trackError } = await supabase.from('track').insert(
        info.tracks.map((t) => ({
          album_id: albumId,
          artist_id: albumArtist?.artist_id ?? null,
          track_no: t.trackNo,
          disc_number: t.discNumber,
          title: t.title,
        }))
      );
      if (trackError) {
        console.error(`トラックの登録に失敗しました(album_id=${albumId}):`, trackError.message);
      } else {
        tracksAdded = info.tracks.length;
      }
    }
  }

  return NextResponse.json({ success: true, applied: Boolean(info.imageUrl), tracksAdded });
}
