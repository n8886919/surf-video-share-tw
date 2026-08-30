import type { Metadata } from "next";
import { PROJECT_PURPOSE } from "../../../packages/domain/src/project-purpose";
import { PublicVideo } from "./public-video";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ videoId: string }>;
}): Promise<Metadata> {
  const { videoId } = await params;
  const thumbnail = `/api/v1/videos/${encodeURIComponent(videoId)}/thumbnail`;
  return {
    title: "公開實拍｜彼日浪影",
    description: PROJECT_PURPOSE,
    openGraph: {
      title: "公開實拍｜彼日浪影",
      description: PROJECT_PURPOSE,
      images: [thumbnail],
      locale: "zh_TW",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "公開實拍｜彼日浪影",
      description: PROJECT_PURPOSE,
      images: [thumbnail],
    },
  };
}

export default async function PublicVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
}) {
  const { videoId } = await params;
  const query = await searchParams;
  const shareToken = typeof query.share === "string" ? query.share : null;
  return <PublicVideo videoId={videoId} shareToken={shareToken}/>;
}
