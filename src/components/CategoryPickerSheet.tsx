"use client";

import { Check, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getCategory, pickerCategoriesFor, subcategoriesFor, subcategoryOptionsFor } from "../lib/categories";
import type { CustomCategory, CustomSubcategory, TransactionKind } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { CategoryIcon } from "./CategoryIcon";
import { SubcategoryIcon } from "./SubcategoryIcon";

export interface CategoryPick { kind: TransactionKind; category: string; subcategory: string }

interface CategoryPickerSheetProps {
  /** The line being edited; null keeps the sheet closed. */
  value: CategoryPick | null;
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  onPick: (pick: CategoryPick) => void;
  onClose: () => void;
}

/** Every category and its subcategories for one line, with its type, in one sheet. */
export function CategoryPickerSheet({ value, ...props }: CategoryPickerSheetProps) {
  // The choices outlive a close so they can animate out, and start over on the next open.
  const [shown, setShown] = useState<{ key: number; value: CategoryPick } | null>(value ? { key: 1, value } : null);
  if (value && value !== shown?.value) setShown({ key: (shown?.key ?? 0) + 1, value });
  if (!shown) return null;
  // Rendered on the body so the route panel's stacking context cannot put the bottom nav above it.
  return createPortal(<AnimatedOverlay open={Boolean(value)} dismissOnBackdrop onClose={props.onClose}>
    <CategoryPicker key={shown.key} initial={shown.value} {...props} />
  </AnimatedOverlay>, document.body);
}

function CategoryPicker({ initial, customCategories, customSubcategories, onPick, onClose }: Omit<CategoryPickerSheetProps, "value"> & { initial: CategoryPick }) {
  const [kind, setKind] = useState(initial.kind);
  const [category, setCategory] = useState(initial.category);
  const [subcategory, setSubcategory] = useState(initial.subcategory);
  const categories = pickerCategoriesFor(kind, customCategories);
  const options = category ? subcategoryOptionsFor(category, customSubcategories) : [];
  const color = category ? getCategory(category, customCategories).color : undefined;
  const subcategoryRef = useRef<HTMLFieldSetElement>(null);
  const pickedHere = useRef(false);

  // On a phone the types sit below the fold, so bring them up once a category is tapped.
  useEffect(() => {
    if (!pickedHere.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    subcategoryRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [category]);

  const changeKind = (next: TransactionKind) => {
    setKind(next);
    if (!pickerCategoriesFor(next, customCategories).some((item) => item.id === category)) { setCategory(""); setSubcategory(""); }
  };
  const chooseCategory = (id: string) => {
    // A category with no finer types is the whole answer, so the sheet closes on it.
    if (!subcategoryOptionsFor(id, customSubcategories).length) { onPick({ kind, category: id, subcategory: "" }); return; }
    if (id !== category) setSubcategory("");
    pickedHere.current = true;
    setCategory(id);
  };

  return <section className="category-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="category-picker-title">
    <header>
      <h2 id="category-picker-title">Choose a category</h2>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
    </header>
    <div className="category-picker-body">
      <div className="kind-toggle" role="group" aria-label="Type">
        {(["expense", "income"] as const).map((item) => <button type="button" key={item} className={`kind-toggle-option is-${item}${kind === item ? " on" : ""}`} aria-pressed={kind === item} onClick={() => changeKind(item)}>{item === "expense" ? "Expense" : "Income"}</button>)}
      </div>
      <div className="category-grid">
        {categories.map((item) => <button key={item.id} type="button" className={category === item.id ? "category-choice selected" : "category-choice"} aria-pressed={category === item.id} onClick={() => chooseCategory(item.id)}>
          <span style={{ "--category-color": item.color } as CSSProperties}><CategoryIcon category={item.id} icon={item.icon} /></span>
          {item.label}
          {category === item.id && <Check size={15} weight="bold" />}
        </button>)}
      </div>
      {options.length > 0 && <fieldset ref={subcategoryRef} className="subcategory-fieldset">
        <legend>{subcategoriesFor(category).label} <span>Optional</span></legend>
        <div className="subcategory-grid">
          {options.map((option) => <button key={option.name} type="button" className={subcategory === option.name ? "subcategory-choice selected" : "subcategory-choice"} aria-pressed={subcategory === option.name} onClick={() => onPick({ kind, category, subcategory: subcategory === option.name ? "" : option.name })}>
            <span style={{ "--category-color": color } as CSSProperties}><SubcategoryIcon subcategory={option.name} icon={option.icon} /></span>
            {option.name}
            {subcategory === option.name && <Check size={14} weight="bold" />}
          </button>)}
        </div>
      </fieldset>}
    </div>
    <footer className="dialog-actions">
      <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
      <button type="button" className="primary-button" disabled={!category} onClick={() => onPick({ kind, category, subcategory })}>{options.length && !subcategory ? "Use without type" : "Done"}</button>
    </footer>
  </section>;
}
