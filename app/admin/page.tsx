import { SurfApp } from "../surf-app";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "管理後台｜彼日浪影", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <SurfApp adminMode/>;
}
