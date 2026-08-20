// utils/towerRecords.ts
//
// Apple Music/iTunesに存在しない作品(サブスク未配信の旧譜・アナログ限定盤など)の
// ジャケット画像・発売日・レーベルを、Tower Records(tower.jp)の商品ページから
// 取り込むためのユーティリティ。ヘッドレスブラウザは使わず、商品ページのHTMLに
// そのまま含まれている「基本情報」テーブル(TOL-item-info-PC-tab-basic-info-table)
// をそのまま解析する(実際の商品ページで構造を確認済み)。

export type TowerTrack = {
  discNumber: number;
  trackNo: number;
  title: string;
};

export type TowerProductInfo = {
  imageUrl?: string;
  releaseDate?: string; // YYYY-MM-DD
  labelName?: string;
  tracks: TowerTrack[];
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractBasicInfoField(table: string, label: string): string | undefined {
  const re = new RegExp(
    `<td class="TOL-item-info-PC-tab-basic-info-table-column">\\s*${label}\\s*</td>\\s*` +
      `<td class="TOL-item-info-PC-tab-basic-info-table-field">\\s*(?:<a[^>]*>)?\\s*(?:<span[^>]*>)?([^<]+)`
  );
  const m = table.match(re);
  return m ? decodeHtmlEntities(m[1]).trim() : undefined;
}

function parseJapaneseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// 「収録内容」タブは "N.[CDアルバム]" のようなディスク見出しと、各トラックの
// 番号・曲名が交互に並ぶ構造になっている(実際の商品ページで確認済み)。
// ディスク見出しとトラック行を1つの正規表現の交互マッチで拾い、直近に見た
// ディスク番号を状態として保持しながらトラックへ割り当てる。
function extractTracks(html: string): TowerTrack[] {
  const re =
    /<div class="TOL-item-info-PC-tab-recorded-contents-list-item-name"><span class="text-size-16 is-bold">(\d+)\.\[|<div class="TOL-item-info-PC-tab-recorded-contents-list-track-number"><span class="is-bold">(\d+)\.<\/span><\/div>\s*<div class="TOL-item-info-PC-tab-recorded-contents-list-track-title">([^<]+)<\/div>/g;

  let discNumber = 1;
  const tracks: TowerTrack[] = [];
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      discNumber = parseInt(m[1], 10);
    } else if (m[2] !== undefined && m[3] !== undefined) {
      tracks.push({ discNumber, trackNo: parseInt(m[2], 10), title: decodeHtmlEntities(m[3]).trim() });
    }
  }
  return tracks;
}

export async function fetchTowerProductInfo(url: string): Promise<TowerProductInfo> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MusicSynapse/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`Tower Recordsのページ取得に失敗しました: HTTP ${res.status}`);
  }
  const html = await res.text();

  const imageMatch = html.match(/<img src="(https:\/\/cdn\.tower\.jp\/[^"]+)" class="PC-item-info-jacket-img/);
  const imageUrl = imageMatch?.[1];

  const tableMatch = html.match(/<table class="TOL-item-info-PC-tab-basic-info-table">([\s\S]*?)<\/table>/);
  const table = tableMatch?.[1] ?? '';

  const releaseDate = parseJapaneseDate(extractBasicInfoField(table, '発売日'));
  const labelName = extractBasicInfoField(table, 'レーベル');
  const tracks = extractTracks(html);

  return { imageUrl, releaseDate, labelName, tracks };
}
