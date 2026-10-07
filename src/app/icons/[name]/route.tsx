/* eslint-disable react-refresh/only-export-components -- a route handler, not a component module */
import { ImageResponse } from "next/og";
import { brandIconDataUri, type BrandIconVariant } from "../brand-art";

/** The installable-app icons named in `src/app/manifest.ts`, rendered once at build time. */
const ICONS: Record<string, { size: number; variant: BrandIconVariant }> = {
  "icon-192.png": { size: 192, variant: "rounded" },
  "icon-512.png": { size: 512, variant: "rounded" },
  "maskable-512.png": { size: 512, variant: "maskable" },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(<img src={brandIconDataUri(icon.variant)} width={icon.size} height={icon.size} alt="" />, {
    width: icon.size,
    height: icon.size,
    headers: { "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400" },
  });
}
