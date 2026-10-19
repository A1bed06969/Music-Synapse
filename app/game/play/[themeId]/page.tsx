import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { buildBoard } from '@/utils/gameData'
import PlayClient from './PlayClient'

export default async function GamePlayPage({ params }: { params: Promise<{ themeId: string }> }) {
  const { themeId } = await params
  const supabase = await createClient()

  const { data: theme } = await supabase.from('disc_guide').select('id, title').eq('id', themeId).maybeSingle()
  if (!theme) notFound()

  const board = await buildBoard(supabase, themeId)
  if (!board) {
    return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-white/50">このテーマは、盤面を作れるだけのジャケットがまだありません。</p>
  }
  return <PlayClient themeId={themeId} themeTitle={theme.title} initialBoard={board} />
}
