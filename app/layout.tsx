import type { Metadata } from "next";
import "./globals.css";
import { PROJECT_PURPOSE } from "../packages/domain/src/project-purpose";

export const metadata: Metadata = {
  title: "彼日浪影",
  description: PROJECT_PURPOSE,
  openGraph: {
    title: "彼日浪影",
    description: PROJECT_PURPOSE,
    images: ["/brand-logo.png"],
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "彼日浪影",
    description: PROJECT_PURPOSE,
    images: ["/brand-logo.png"],
  },
  icons: {
    icon: "/brand-logo.png",
    shortcut: "/brand-logo.png",
    apple: "/brand-logo.png",
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
