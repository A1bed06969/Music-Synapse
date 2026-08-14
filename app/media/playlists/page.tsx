type SpotifyPlaylist = { title: string; playlistId: string }
type AppleMusicPlaylist = { title: string; playlistId: string; slug: string }

// 各プレイリストは実在するIDであることを事前に確認済み。
// Release Radar/Discover Weekly はユーザーごとに内容が変わる
// パーソナライズド・プレイリストで全員共通の公開URLが存在しないため、
// Hot Hits Japan / Gacha Pop(いずれもSpotify公式の固定編集プレイリスト)に差し替えている。
const SPOTIFY_PLAYLISTS: SpotifyPlaylist[] = [
  { title: "Today's Top Hits", playlistId: '37i9dQZF1DXcBWIGoYBM5M' },
  { title: 'NEW MUSIC FRIDAY JAPAN', playlistId: '37i9dQZF1DXc57cuGAMEkA' },
  { title: 'RADAR: Early Noise', playlistId: '37i9dQZF1DX4OR8pnFkwhR' },
  { title: 'Hot Hits Japan', playlistId: '37i9dQZF1DXayDMsJG9ZBv' },
  { title: 'Gacha Pop', playlistId: '37i9dQZF1DX9ww9tisjowN' },
]

const APPLE_MUSIC_PLAYLISTS: AppleMusicPlaylist[] = [
  { title: 'トップ100：グローバル', slug: 'top-100-global', playlistId: 'd25f5d1181894928af76c85c967f8f31' },
  { title: 'NMD(ニュー・ミュージック・デイリー)', slug: 'new-music-daily', playlistId: '2b0e6e332fdf4b7a91164da3162127b5' },
  { title: 'Up Next', slug: 'up-next', playlistId: '5cb9c0f3ca9d4fc1bccbaf67ca6201e7' },
  { title: '邦楽ヒッツ・トゥデイ', slug: 'hits-today', playlistId: '2f5fcebf9ad247098e445d27011aecc4' },
  { title: '#ヤンスタ', slug: 'yanstar', playlistId: '6036fd53c2fd4aea93cb410ae71d56fe' },
  { title: 'In The City', slug: 'in-the-city', playlistId: '8113b2b2dc2f494194aeac779ee88a4a' },
  { title: 'GENKI TRACKS', slug: 'genki-tracks', playlistId: '90232b51548f43118f608c9a2aca36c8' },
  { title: 'カフェミュージック', slug: 'cafe-music', playlistId: '51abcc1adb164991acbaacfc11c0d5ea' },
  { title: 'RとB', slug: 'r-and-b', playlistId: '38e226dfe8db48e7b5f46922aee8841e' },
  { title: 'インディーズ＋チル', slug: 'indie-chill', playlistId: 'c4074df0f3114c7d9572859645229d75' },
]

// udiscovermusic.jp自身が運営するSpotifyアカウントの中から、季節ものを除いた
// 定番プレイリストを掲載(https://www.udiscovermusic.jp/essentials/playlists で公開確認済み)
const UDISCOVER_PLAYLISTS: SpotifyPlaylist[] = [
  { title: 'Forever POP', playlistId: '2H4mGtLWb8stz0r3hWSXoJ' },
  { title: 'Rock Hits', playlistId: '0SthmxKs98q9J7SYO2oYtO' },
  { title: 'Best Love Songs Ever', playlistId: '7epZImIiGscrDthv3jQl9e' },
]

function SpotifyCard({ title, playlistId }: SpotifyPlaylist) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 truncate text-sm font-medium">{title}</p>
      <iframe
        src={`https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`}
        width="100%"
        height={152}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        style={{ borderRadius: 8 }}
      />
    </div>
  )
}

function AppleMusicCard({ title, slug, playlistId }: AppleMusicPlaylist) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 truncate text-sm font-medium">{title}</p>
      <iframe
        allow="autoplay *; encrypted-media *; clipboard-write"
        frameBorder="0"
        height={175}
        style={{ width: '100%', overflow: 'hidden', borderRadius: 8 }}
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
        src={`https://embed.music.apple.com/jp/playlist/${slug}/pl.${playlistId}`}
        loading="lazy"
      />
    </div>
  )
}

export default function CurationPlaylistPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">厳選プレイリストハブ</h1>
      <p className="mt-2 text-sm text-white/50">
        Spotify・Apple Musicの公式プレイリストと、音楽メディアがセレクトするプレイリストをまとめてチェックできます。
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Spotify公式</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SPOTIFY_PLAYLISTS.map((p) => (
            <SpotifyCard key={p.playlistId} {...p} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Apple Music公式</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {APPLE_MUSIC_PLAYLISTS.map((p) => (
            <AppleMusicCard key={p.playlistId} {...p} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">メディアセレクト</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {UDISCOVER_PLAYLISTS.map((p) => (
            <SpotifyCard key={p.playlistId} {...p} />
          ))}
          <a
            href="https://mag.digle.tokyo/"
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-6 text-center transition hover:border-white/25 hover:bg-white/[0.06]"
          >
            <span className="text-2xl">🎧</span>
            <p className="mt-2 text-sm font-medium">DIGLE MAGAZINE</p>
            <p className="mt-1 text-xs text-white/40">プレイリスト&カルチャーメディアで見る →</p>
          </a>
        </div>
      </section>
    </div>
  )
}
