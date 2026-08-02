import { CATEGORY_ICON_OPTIONS } from "../lib/category-icons";
import type { CategoryIconName } from "../types";
import { LedgerIcon } from "./LedgerIcon";

export function CategoryIconPicker({ value, onChange, disabled = false, legend = "Icon" }: { value: CategoryIconName; onChange: (value: CategoryIconName) => void; disabled?: boolean; legend?: string }) {
  return <fieldset className="category-icon-picker" disabled={disabled}><legend>{legend}</legend><div>{CATEGORY_ICON_OPTIONS.map((option) => <button key={option.value} type="button" className={value === option.value ? "active" : undefined} aria-label={option.label} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><LedgerIcon icon={option.value} size={17} /><span>{option.label}</span></button>)}</div></fieldset>;
}
