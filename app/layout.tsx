import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import { PreviewPlayerProvider } from "./components/PreviewPlayerContext";
import RecordDiggingLauncher from "./components/record-digging/RecordDiggingLauncher";
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
        <SiteHeader stats={stats} />
        <PreviewPlayerProvider>
          <main className="flex-1">{children}</main>
          <RecordDiggingLauncher />
        </PreviewPlayerProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
