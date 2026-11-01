import { BRAND_MARK_PATH } from "../../lib/brand-mark";

/**
 * The SaveYoRupee banknote mark from `src/app/icon.svg`, redrawn for the PNG app icons (server only).
 * "rounded" is the tab/launcher icon as drawn; "maskable" bleeds to the edges and keeps the
 * mark inside Android's safe circle; "apple" bleeds to the edges for iOS to round itself.
 */
export type BrandIconVariant = "rounded" | "maskable" | "apple";

/** Paper (--paper in styles.css) behind the splash screen, the ledger green (--green) for the browser and status bar. */
export const APP_BACKGROUND_COLOR = "#f2efe2";
export const APP_THEME_COLOR = "#3f6653";

const MARK_SCALE: Record<BrandIconVariant, number> = { rounded: 1, maskable: 0.64, apple: 0.82 };

export function brandIconSvg(variant: BrandIconVariant) {
  const scale = MARK_SCALE[variant];
  const background = variant === "rounded"
    ? '<rect width="256" height="256" rx="68" fill="#10231B"/><rect x="12" y="12" width="232" height="232" rx="56" fill="url(#bg)"/>'
    : '<rect width="256" height="256" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs><linearGradient id="bg" x1="32" y1="24" x2="224" y2="240" gradientUnits="userSpaceOnUse"><stop stop-color="#32A66A"/><stop offset="1" stop-color="#0B5D38"/></linearGradient></defs>${background}<path transform="translate(128 128) scale(${scale}) translate(-128 -128)" d="${BRAND_MARK_PATH}" fill="#F7FFF9"/></svg>`;
}

export function brandIconDataUri(variant: BrandIconVariant) {
  return `data:image/svg+xml;base64,${Buffer.from(brandIconSvg(variant)).toString("base64")}`;
}
