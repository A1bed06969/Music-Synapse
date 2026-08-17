// app/api/admin/disc-guide-scan/confirm/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { NextRequest, NextResponse } from 'next/server';

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
    const { pending_id, confirmed_data } = await req.json();

    if (!pending_id || !confirmed_data) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch pending record
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending) {
      return NextResponse.json({ error: 'Pending record not found' }, { status: 404 });
    }

    // Save confirmed data
    await supabase
      .from('disc_guide_scan_pending')
      .update({
        confirmed_data,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', pending_id);

    return NextResponse.json({
      success: true,
      message: `Confirmed ${confirmed_data.albums.length} albums`,
    });
  } catch (err) {
    console.error('Confirm endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
