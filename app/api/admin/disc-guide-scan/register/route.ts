// app/api/admin/disc-guide-scan/register/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { autoImportArtistProfileFromMusicBrainz } from '@/utils/artistProfileImport';
import { classifyAlbumType } from '@/utils/albumType';
import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';

// after()内で新規アーティストごとにMusicBrainzプロフィール取込を行うため、
// 1ページに新規アーティストが多いと時間がかかる。他の管理画面バックグラウンド
// 処理と同じ規約に合わせる。
export const maxDuration = 60;

type ConfirmedAlbum = {
  extracted_index: number;
  title: string;
  artist_name: string;
  label?: string;
  year?: number;
  album_id?: string;
  create_new_album?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { pending_id } = await req.json();

    if (!pending_id) {
      return NextResponse.json({ error: 'Missing pending_id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch confirmed pending record
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending || pending.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'Pending record not confirmed' },
        { status: 400 }
      );
    }

    const confirmed: { albums: ConfirmedAlbum[] } = pending.confirmed_data;
    const bulkImportArtistIds: string[] = [];
    let registeredCount = 0;

    // 2. Create albums & register selections
    for (const albumData of confirmed.albums) {
      let albumId = albumData.album_id;

      if (!albumId && albumData.create_new_album) {
        // Get or create artist
        let artistId = albumData.artist_name; // Placeholder, should query

        // Check if artist exists. .single()は0件・2件以上の両方でエラーになり、
        // dataがnullのまま握りつぶされるため、既に候補が複数ある場合も
        // 「存在しない」扱いになって重複作成されてしまう。.limit(1).maybeSingle()
        // なら該当が2件以上あっても先頭1件を安全に拾える。
        const { data: existingArtist } = await supabase
          .from('artist')
          .select('id')
          .ilike('name', `%${albumData.artist_name}%`)
          .limit(1)
          .maybeSingle();

        if (!existingArtist) {
          // Create new artist
          const { data: newArtist, error: artistError } = await supabase
            .from('artist')
            .insert({ name: albumData.artist_name })
            .select('id')
            .single();

          if (artistError) {
            console.error(
              `Failed to create artist "${albumData.artist_name}":`,
              artistError.message
            );
          }

          artistId = newArtist?.id || '';
          if (artistId) {
            bulkImportArtistIds.push(artistId);
          }
        } else {
          artistId = existingArtist.id;
        }

        // Create album (unregistered)
        if (artistId) {
          const { data: newAlbum, error: albumError } = await supabase
            .from('album')
            .insert({
              artist_id: artistId,
              title: albumData.title,
              release_date: albumData.year
                ? `${albumData.year}-01-01`
                : null,
              // この時点ではトラック数が不明なため、タイトルの手がかりのみで判定する
              album_type: classifyAlbumType(albumData.title, null),
            })
            .select('id')
            .single();

          if (albumError) {
            console.error(
              `Failed to create album "${albumData.title}":`,
              albumError.message
            );
          }

          albumId = newAlbum?.id;
        }
      }

      // Register to disc_guide_selection。upsert + onConflict ignoreDuplicatesで、
      // (disc_guide_id, album_id)が既に登録済みなら何もしない(再試行時の冪等性)。
      // エラーを確認せずにカウントしていた旧実装では、insert失敗時も
      // registeredCountが実際の登録件数より多く報告されてしまっていた。
      if (albumId) {
        const { error: selectionError } = await supabase.from('disc_guide_selection').upsert(
          {
            disc_guide_id: pending.disc_guide_id,
            album_id: albumId,
            note: null,
          },
          { onConflict: 'disc_guide_id,album_id', ignoreDuplicates: true }
        );

        if (selectionError) {
          console.error(
            `Failed to register album "${albumData.title}" (${albumId}) to disc guide selection:`,
            selectionError.message
          );
        } else {
          registeredCount++;
        }
      }
    }

    // 3. Update pending status
    await supabase
      .from('disc_guide_scan_pending')
      .update({ status: 'registered' })
      .eq('id', pending_id);

    // 4. Trigger bulk import for new artists
    if (bulkImportArtistIds.length > 0) {
      after(async () => {
        for (const artistId of bulkImportArtistIds) {
          try {
            const result = await autoImportArtistProfileFromMusicBrainz(supabase, artistId);
            console.log(`Auto-import for artist ${artistId}: ${result}`);
          } catch (err) {
            console.error(`Auto-import failed for artist ${artistId}:`, err);
          }
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: `Registered ${registeredCount} albums`,
      registered_count: registeredCount,
      new_artists: bulkImportArtistIds,
    });
  } catch (err) {
    console.error('Register endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
