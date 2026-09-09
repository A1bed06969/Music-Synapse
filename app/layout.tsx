import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import { PreviewPlayerProvider } from "./components/PreviewPlayerContext";
import { JunkieDigProvider } from "./components/record-digging/JunkieDigContext";
import RecordDiggingLauncher from "./components/record-digging/RecordDiggingLauncher";
import NavHistoryTracker from "./components/navigation/NavHistoryTracker";
import { getStats } from "@/utils/stats";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Music Synapse | 音楽データベース",
  description: "世界中の音楽データ・メディア・文脈をシナプスのように結合する音楽データベース",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const stats = await getStats();

  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-white" suppressHydrationWarning>
        <JunkieDigProvider>
          {/* useSearchParamsを使うためSuspenseで包む(静的生成時のビルドエラー回避)。
              画面には何も描画しない、サイト内履歴の記録専用コンポーネント。 */}
          <Suspense fallback={null}>
            <NavHistoryTracker />
          </Suspense>
          <SiteHeader stats={stats} />
          <PreviewPlayerProvider>
            <main className="flex-1">{children}</main>
            <RecordDiggingLauncher />
          </PreviewPlayerProvider>
          <SiteFooter />
        </JunkieDigProvider>
      </body>
    </html>
  );
}
