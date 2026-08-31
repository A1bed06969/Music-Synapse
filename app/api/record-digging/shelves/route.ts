import { NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'
import { fetchEligibleGenreShelves } from '@/utils/recordDigging'

export async function GET() {
  const supabase = await createClient()
  const shelves = await fetchEligibleGenreShelves(supabase)
  return NextResponse.json(shelves)
}
