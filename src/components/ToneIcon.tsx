import type { CSSProperties } from "react";
import { getCategory } from "../lib/categories";
import { accountLook, categoryTone, type Tone } from "../lib/tones";
import type { CustomCategory, PaymentAccount, TransactionCategory } from "../types";
import { CategoryIcon } from "./CategoryIcon";

const tileStyle = (tone: Tone, size: number): CSSProperties => ({ "--tile-bg": tone.bg, "--tile-ink": tone.ink, "--tile-size": `${size}px` } as CSSProperties);

export function CategoryTile({ category, custom, size = 42 }: { category: TransactionCategory; custom?: readonly CustomCategory[]; size?: number }) {
  const definition = getCategory(category, custom);
  return <span className="v2-tile" style={tileStyle(categoryTone(category, custom), size)} aria-hidden="true"><CategoryIcon category={category} icon={definition.icon} size={Math.round(size * 0.52)} weight="duotone" /></span>;
}

export function AccountTile({ account, bucket, size = 42 }: { account: (Pick<PaymentAccount, "type"> & { provider?: string }) | null; bucket?: string; size?: number }) {
  const { tone, icon: IconComponent } = accountLook(account, bucket);
  return <span className="v2-tile" style={tileStyle(tone, size)} aria-hidden="true"><IconComponent size={Math.round(size * 0.52)} weight="duotone" /></span>;
}
