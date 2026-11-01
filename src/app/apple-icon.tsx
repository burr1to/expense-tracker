/* eslint-disable react-refresh/only-export-components -- a Next.js icon route, not a component module */
import { ImageResponse } from "next/og";
import { brandIconDataUri } from "./icons/brand-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The Home Screen icon on iPhone and iPad: full-bleed, since iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(<img src={brandIconDataUri("apple")} width={size.width} height={size.height} alt="" />, size);
}
