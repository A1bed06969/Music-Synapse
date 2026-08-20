// utils/geminiDiscGuideExtract.ts
//
// ディスクガイド本のページ写真から、掲載されているアルバムレビュー(アーティスト名・
// タイトル・レーベル・発売年)をGemini APIで直接構造化データとして抽出する。
//
// 元々はtesseract.js(ローカルOCR)+正規表現ベースのパーサーで実装していたが、
// 実物のページ(サムネイル画像とレビュー文が入り組んだレイアウト)で検証したところ、
// Tesseract自身のレイアウト分割が完全に失敗する(ページ全体が1ブロックとして扱われる)
// うえ文字認識のノイズも大きく、実用に耐えなかった。Geminiは画像のレイアウトを
// 理解したうえで直接JSON構造を返せるため、この2つの問題を同時に解決できる。
// HEIC/HEIFも直接受け付けるため、heic-convert等の変換も不要になった。
import { GoogleGenAI, Type } from '@google/genai';
import type { AlbumExtract } from './discGuideImport.ts';

const MODEL = 'gemini-flash-latest';

const PROMPT = `この画像は日本の音楽ディスクガイド本の見開き(または1ページ)です。
ページに掲載されているアルバムレビューのエントリーをすべて抽出してください。
各エントリーには通常、小さなジャケット写真、太字のアーティスト名、太字の
アルバムタイトル、レーベル名と発売年(西暦)、レビュー文が含まれます。

以下のルールに従ってください:
- レビュー文の本文は抽出しない(artist_name / title / label / release_yearのみ)
- 評者名(文末の「(〇〇)」のような署名)は無視する
- セクションの見出し・装飾テキスト・ページ番号は無視する
- release_yearは西暦4桁の数値のみ(不明な場合は省略)
- このページにアルバムレビューが1件も無い場合(表紙・目次・はじめに・
  章扉など)は空の配列を返す
- 実際に印刷されている表記をそのまま使う(推測で補完しない)`;

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      artist_name: { type: Type.STRING },
      title: { type: Type.STRING },
      label: { type: Type.STRING },
      release_year: { type: Type.INTEGER },
    },
    required: ['artist_name', 'title'],
  },
};

type GeminiEntry = {
  artist_name?: unknown;
  title?: unknown;
  label?: unknown;
  release_year?: unknown;
};

export async function extractAlbumsWithGemini(imageBuffer: Buffer, mimeType: string): Promise<AlbumExtract[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: imageBuffer.toString('base64') } }, { text: PROMPT }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return (parsed as GeminiEntry[])
    .filter((e) => typeof e?.artist_name === 'string' && typeof e?.title === 'string')
    .map((e) => ({
      artist_name: e.artist_name as string,
      title: e.title as string,
      label: typeof e.label === 'string' ? e.label : undefined,
      release_year: typeof e.release_year === 'number' ? e.release_year : undefined,
    }));
}
