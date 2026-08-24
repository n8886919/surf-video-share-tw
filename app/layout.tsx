import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://taiwan-surf-conditions.nolanasd123.chatgpt.site"),
  title: "台灣浪況實錄",
  description: "用今天的實拍浪況，理解下一次相似海況實際長什麼樣。",
  openGraph: {
    title: "台灣浪況實錄",
    description: "用今天的實拍，理解下一次的浪。",
    locale: "zh_TW",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "台灣浪況實錄",
    description: "用今天的實拍，理解下一次的浪。",
    images: ["/og.png"],
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
