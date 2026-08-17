// __tests__/disc-guide-import.integration.test.ts
//
// ディスクガイド自動取り込みの結合テスト。
//
// 実行: npm test   (内部で `node --env-file-if-exists=.env.local --test __tests__/`)
//
// 前提:
//   - Node 24 の TypeScript ネイティブ実行 (type stripping) を使うため、相対 import は
//     拡張子 `.ts` まで書く。`@/` エイリアスは Node が解決できないので使わない。
//   - HTTP を叩くテストは dev server (`npm run dev`) が必要。起動していない場合は
//     fail ではなく skip する。サイト全体が proxy.ts の Basic 認証配下にあるため
//     Authorization ヘッダを付ける。
//   - 新規アルバム作成パス (test 5) は artist / album を実際に作成し、register の
//     after() が MusicBrainz 取り込みを走らせる。既定では skip し、
//     RUN_DESTRUCTIVE_TESTS=1 のときだけ実行する。

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminClient } from '../utils/Supabase/admin.ts'
import { fetchGoogleBooksCover } from '../utils/googleBooksApi.ts'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'
const DESTRUCTIVE = process.env.RUN_DESTRUCTIVE_TESTS === '1'

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const user = process.env.BASIC_AUTH_USER ?? ''
  const pass = process.env.BASIC_AUTH_PASSWORD ?? ''
  const token = Buffer.from(`${user}:${pass}`).toString('base64')
  return { Authorization: `Basic ${token}`, ...extra }
}

describe('Disc Guide Album Import - Integration', () => {
  let supabase: ReturnType<typeof createAdminClient>
  let serverUp = false
  // 後片付け対象。テスト内で push していく。
  const cleanup = {
    selectionIds: [] as string[],
    pendingIds: [] as string[],
    discGuideIds: [] as string[],
    albumIds: [] as string[],
    artistIds: [] as string[],
  }

  before(async () => {
    supabase = createAdminClient()
    try {
      const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/upload`, {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      })
      // 401 は Basic 認証の資格情報が違う = サーバは動いている
      serverUp = res.status !== 404
      if (res.status === 401) {
        console.warn('[integration] Basic auth rejected; HTTP tests will be skipped')
        serverUp = false
      }
    } catch {
      serverUp = false
      console.warn(`[integration] dev server unreachable at ${BASE_URL}; HTTP tests skipped`)
    }
  })

  after(async () => {
    // 依存順に削除する (selection -> album -> artist, pending -> disc_guide)
    if (cleanup.selectionIds.length) {
      await supabase.from('disc_guide_selection').delete().in('id', cleanup.selectionIds)
    }
    if (cleanup.pendingIds.length) {
      await supabase.from('disc_guide_scan_pending').delete().in('id', cleanup.pendingIds)
    }
    if (cleanup.albumIds.length) {
      await supabase.from('track').delete().in('album_id', cleanup.albumIds)
      await supabase.from('album').delete().in('id', cleanup.albumIds)
    }
    if (cleanup.artistIds.length) {
      await supabase.from('artist').delete().in('id', cleanup.artistIds)
    }
    if (cleanup.discGuideIds.length) {
      await supabase.from('disc_guide').delete().in('id', cleanup.discGuideIds)
    }
  })

  // ---------------------------------------------------------------- test 1
  test('fetches a disc guide cover image from Google Books by ISBN', async (t) => {
    // fetchGoogleBooksCover は非 2xx を握りつぶして null を返すため、
    // レート制限 (429) と「表紙が無い」を区別できない。先に直接叩いて切り分ける。
    const probe = await fetch(
      'https://www.googleapis.com/books/v1/volumes?q=isbn:9784894444639&maxResults=1',
      { headers: { 'User-Agent': 'MusicSynapse/1.0' }, signal: AbortSignal.timeout(10000) }
    )
    if (probe.status === 429) {
      return t.skip('Google Books API rate limited (429)')
    }

    const coverUrl = await fetchGoogleBooksCover('9784894444639')
    assert.ok(coverUrl, 'expected a cover URL for a known ISBN')
    assert.match(coverUrl, /^https?:\/\//)
  })

  test('returns null for an ISBN with no Google Books match', async () => {
    // 429 でも null になるが、いずれにせよ「表紙 URL を返さない」ことの確認で足りる。
    const coverUrl = await fetchGoogleBooksCover('0000000000000')
    assert.equal(coverUrl, null)
  })

  // ---------------------------------------------------------------- test 2
  test('upload endpoint exists and rejects missing params', async (t) => {
    if (!serverUp) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/upload`, {
      method: 'POST',
      headers: authHeaders(),
    })
    // 400 (missing params) を期待。404 ならルートが存在しない。
    assert.notEqual(res.status, 404, 'upload route should exist')
    assert.ok([400, 405, 500].includes(res.status), `unexpected status ${res.status}`)
  })

  test('confirm endpoint rejects an unknown pending_id', async (t) => {
    if (!serverUp) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/confirm`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        pending_id: 'DGS_does_not_exist',
        confirmed_data: { albums: [] },
      }),
    })
    // このルートは「レコードが無い」を 404 で返す。Next.js の「ルートが無い」404 は
    // HTML を返すので、JSON ボディが返っていることでルートの存在を確認する。
    assert.equal(res.status, 404)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json()
    assert.match(body.error, /not found/i)
  })

  test('register endpoint refuses a pending record that is not confirmed', async (t) => {
    if (!serverUp) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/register`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pending_id: 'DGS_does_not_exist' }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /not confirmed/i)
  })

  // ---------------------------------------------------------------- test 3
  test('pending -> confirmed -> registered lifecycle with an existing album', async (t) => {
    if (!serverUp) return t.skip('dev server not running')

    // 既存アルバムを 1 件借りる (新規作成パスを踏まないので副作用が無い)
    const { data: existingAlbum } = await supabase
      .from('album')
      .select('id, title, artist:artist_id(name)')
      .limit(1)
      .single()
    assert.ok(existingAlbum, 'need at least one album in the database')

    const artistRef = existingAlbum.artist
    const artistName = (Array.isArray(artistRef) ? artistRef[0] : artistRef)?.name ?? 'Unknown'

    // テスト用ディスクガイド
    const { data: guide } = await supabase
      .from('disc_guide')
      .insert({ title: `__test guide ${Date.now()}`, publisher: 'test', published_year: 2026 })
      .select('id')
      .single()
    assert.ok(guide, 'failed to create test disc guide')
    cleanup.discGuideIds.push(guide.id)

    // OCR 済みを模した pending レコード
    const extracted = [{ title: existingAlbum.title, artist_name: artistName }]
    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .insert({
        disc_guide_id: guide.id,
        image_filename: 'test-page.png',
        extracted_data: extracted,
        extraction_confidence: 0.9,
        matched_data: [
          {
            extracted_index: 0,
            album_id: existingAlbum.id,
            candidates: [
              { id: existingAlbum.id, title: existingAlbum.title, artist_name: artistName },
            ],
          },
        ],
        status: 'pending',
      })
      .select('id, status')
      .single()
    assert.ok(pending, 'failed to create pending record')
    cleanup.pendingIds.push(pending.id)
    assert.equal(pending.status, 'pending')

    // --- confirm ---
    const confirmRes = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/confirm`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        pending_id: pending.id,
        confirmed_data: {
          albums: [
            {
              extracted_index: 0,
              title: existingAlbum.title,
              artist_name: artistName,
              album_id: existingAlbum.id,
              create_new_album: false,
            },
          ],
        },
      }),
    })
    // ボディは 1 度しか読めない。assert のメッセージ引数は成功時も評価されるため、
    // 先に読み切ってから比較する。
    const confirmBody = await confirmRes.text()
    assert.equal(confirmRes.status, 200, confirmBody)

    const { data: afterConfirm } = await supabase
      .from('disc_guide_scan_pending')
      .select('status, confirmed_data, confirmed_at')
      .eq('id', pending.id)
      .single()
    assert.equal(afterConfirm?.status, 'confirmed')
    assert.ok(afterConfirm?.confirmed_at, 'confirmed_at should be stamped')
    assert.equal(afterConfirm?.confirmed_data.albums.length, 1)

    // --- register ---
    const registerRes = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/register`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pending_id: pending.id }),
    })
    const registerText = await registerRes.text()
    assert.equal(registerRes.status, 200, registerText)
    const registerBody = JSON.parse(registerText)
    assert.equal(registerBody.registered_count, 1)
    // 既存アルバムを選んだので新規アーティストは発生しない
    assert.deepEqual(registerBody.new_artists, [])

    const { data: afterRegister } = await supabase
      .from('disc_guide_scan_pending')
      .select('status')
      .eq('id', pending.id)
      .single()
    assert.equal(afterRegister?.status, 'registered')

    // disc_guide_selection が作られている
    const { data: selections } = await supabase
      .from('disc_guide_selection')
      .select('id, album_id')
      .eq('disc_guide_id', guide.id)
    assert.equal(selections?.length, 1)
    assert.equal(selections?.[0].album_id, existingAlbum.id)
    cleanup.selectionIds.push(...(selections ?? []).map((s) => s.id))
  })

  // ---------------------------------------------------------------- test 4
  test('new album creation path creates artist + album and reports bulk-import targets', async (t) => {
    if (!serverUp) return t.skip('dev server not running')
    if (!DESTRUCTIVE) {
      return t.skip('creates real artist/album rows and fires MusicBrainz import; set RUN_DESTRUCTIVE_TESTS=1')
    }

    const stamp = Date.now()
    const artistName = `__TestArtist ${stamp}`
    const albumTitle = `__TestAlbum ${stamp}`

    const { data: guide } = await supabase
      .from('disc_guide')
      .insert({ title: `__test guide new ${stamp}`, publisher: 'test' })
      .select('id')
      .single()
    assert.ok(guide)
    cleanup.discGuideIds.push(guide.id)

    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .insert({
        disc_guide_id: guide.id,
        image_filename: 'test-new.png',
        extracted_data: [{ title: albumTitle, artist_name: artistName, release_year: 1999 }],
        matched_data: [{ extracted_index: 0, candidates: [] }],
        status: 'confirmed',
        confirmed_data: {
          albums: [
            {
              extracted_index: 0,
              title: albumTitle,
              artist_name: artistName,
              year: 1999,
              create_new_album: true,
            },
          ],
        },
      })
      .select('id')
      .single()
    assert.ok(pending)
    cleanup.pendingIds.push(pending.id)

    const registerRes = await fetch(`${BASE_URL}/api/admin/disc-guide-scan/register`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pending_id: pending.id }),
    })
    const registerText = await registerRes.text()
    assert.equal(registerRes.status, 200, registerText)
    const body = JSON.parse(registerText)

    // assert より先に後片付け対象へ登録する。ここで落ちても行が残らないように。
    cleanup.artistIds.push(...(body.new_artists ?? []))
    const { data: createdAlbums } = await supabase
      .from('album')
      .select('id')
      .eq('title', albumTitle)
    cleanup.albumIds.push(...(createdAlbums ?? []).map((a) => a.id))
    const { data: createdSelections } = await supabase
      .from('disc_guide_selection')
      .select('id')
      .eq('disc_guide_id', guide.id)
    cleanup.selectionIds.push(...(createdSelections ?? []).map((s) => s.id))

    assert.equal(body.registered_count, 1)
    assert.equal(body.new_artists.length, 1, 'a brand-new artist should be queued for bulk import')

    // アーティストとアルバムが実際に作られている
    const { data: artist } = await supabase
      .from('artist')
      .select('id, name')
      .eq('id', body.new_artists[0])
      .single()
    assert.equal(artist?.name, artistName)

    const { data: album } = await supabase
      .from('album')
      .select('id, title, release_date')
      .eq('artist_id', body.new_artists[0])
      .single()
    assert.ok(album)
    assert.equal(album.title, albumTitle)
    assert.equal(album.release_date, '1999-01-01')

    const { data: selections } = await supabase
      .from('disc_guide_selection')
      .select('id, album_id')
      .eq('disc_guide_id', guide.id)
    assert.equal(selections?.length, 1)
    assert.equal(selections?.[0].album_id, album.id)

    const { data: afterRegister } = await supabase
      .from('disc_guide_scan_pending')
      .select('status')
      .eq('id', pending.id)
      .single()
    assert.equal(afterRegister?.status, 'registered')
  })
})
