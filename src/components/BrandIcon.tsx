import { Money } from "@phosphor-icons/react";

export function BrandIcon({ size = 34 }: { size?: number }) {
  const glyphSize = Math.round(size * 0.68);

  return (
    <span className="brand-icon" style={{ width: size, height: size }} aria-hidden="true">
      <Money size={glyphSize} weight="bold" />
    </span>
  );
}
