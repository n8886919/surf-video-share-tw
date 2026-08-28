import { SurfApp } from "./surf-app";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ login?: string | string[] }>;
}) {
  const login = (await searchParams).login;
  return <SurfApp capacityReached={login === "capacity"} />;
}
