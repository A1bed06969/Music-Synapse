// app/api/admin/disc-guide-scan/match/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { pending_id } = await req.json();

    if (!pending_id) {
      return NextResponse.json({ error: 'Missing pending_id' }, { status: 400 });
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

    // Re-run matching (in case DB has been updated)
    const matched = await matchAlbumsWithCandidates(supabase, pending.extracted_data);

    // Update pending record
    await supabase
      .from('disc_guide_scan_pending')
      .update({ matched_data: matched })
      .eq('id', pending_id);

    return NextResponse.json({
      success: true,
      matched_data: matched,
    });
  } catch (err) {
    console.error('Match endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
