import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../../lib/auth";
import { KATHMANDU_BOUNDS, isInsideKathmandu } from "../../../../lib/kathmandu-locations";

export const dynamic = "force-dynamic";

const querySchema = z.string().trim().min(2).max(120);
const resultSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
    properties: z.object({
      name: z.string().optional(),
      housenumber: z.string().optional(),
      street: z.string().optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      county: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
    }),
  })),
});

let nextRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

async function rateLimitedFetch(url: URL) {
  let release = () => {};
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 300;
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": `SaveYoRupee/1.0 (+${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"})`,
      },
      next: { revalidate: 86_400 },
    });
  } finally {
    release();
  }
}

export async function GET(request: Request) {
  const session = await getBetaSession(await headers());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q"));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter at least two characters to search Kathmandu." }, { status: 400 });
  }

  const url = new URL(process.env.PHOTON_SEARCH_URL ?? "https://photon.komoot.io/api");
  url.searchParams.set("q", parsed.data);
  url.searchParams.set("bbox", `${KATHMANDU_BOUNDS.west},${KATHMANDU_BOUNDS.south},${KATHMANDU_BOUNDS.east},${KATHMANDU_BOUNDS.north}`);
  url.searchParams.set("lat", String((KATHMANDU_BOUNDS.south + KATHMANDU_BOUNDS.north) / 2));
  url.searchParams.set("lon", String((KATHMANDU_BOUNDS.west + KATHMANDU_BOUNDS.east) / 2));
  url.searchParams.set("zoom", "13");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", "6");

  try {
    const response = await rateLimitedFetch(url);
    if (!response.ok) throw new Error(`Photon returned ${response.status}`);
    const rawResults = resultSchema.parse(await response.json()).features;
    const seen = new Set<string>();
    const results = rawResults.flatMap((result) => {
      const [longitude, latitude] = result.geometry.coordinates;
      const { properties } = result;
      const label = properties.name?.trim() || properties.street?.trim() || parsed.data;
      const key = `${label.toLowerCase()}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isInsideKathmandu(latitude, longitude) || seen.has(key)) return [];
      seen.add(key);
      const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(" ");
      const address = [...new Set([
        streetAddress,
        properties.district,
        properties.city,
        properties.county,
        properties.state,
        properties.country,
      ].filter((part): part is string => Boolean(part?.trim())))].join(", ");
      return [{
        label,
        address: address || "Kathmandu, Nepal",
        latitude,
        longitude,
      }];
    });
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[maps/search] Kathmandu geocoding failed", error);
    return NextResponse.json({ error: "Place search is temporarily unavailable. You can still reuse a previous location or drop a pin." }, { status: 502 });
  }
}
