import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "浪影互助",
  description: "用今天的實拍浪況，理解下一次相似海況實際長什麼樣。",
  openGraph: {
    title: "浪影互助",
    description: "用今天的實拍，理解下一次的浪。",
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "浪影互助",
    description: "用今天的實拍，理解下一次的浪。",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="antialiased">{children}</body>
    </html>
  );
}
