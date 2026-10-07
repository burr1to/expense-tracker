import { describe, expect, it } from "vitest";
import { aiCategoryChoices, allCategoriesFor, pickerCategoriesFor } from "./categories";
import type { CustomCategory } from "../types";

const custom: CustomCategory[] = [
  { id: "custom-pets", userId: "user-1", name: "Pets", label: "Pets", kind: "expense", color: "#557f69", icon: "tag", custom: true },
  { id: "custom-rent", userId: "user-1", name: "Rent received", label: "Rent received", kind: "income", color: "#557f69", icon: "tag", custom: true },
];

describe("pickerCategoriesFor", () => {
  it("keeps the loan category pickable but lists it last, after custom categories", () => {
    for (const kind of ["expense", "income"] as const) {
      const ids = pickerCategoriesFor(kind, custom).map((category) => category.id);
      expect(ids.at(-1)).toBe("loan");
      expect(ids.filter((id) => id === "loan")).toHaveLength(1);
      expect([...ids].sort()).toEqual(allCategoriesFor(kind, custom).map((category) => category.id).sort());
    }
    expect(pickerCategoriesFor("expense", custom).map((category) => category.id).slice(-3)).toEqual(["other", "custom-pets", "loan"]);
    expect(pickerCategoriesFor("income")[0].id).toBe("salary");
  });
});

describe("aiCategoryChoices", () => {
  const subcategories = [{ categoryId: "food", name: "Momo" }, { categoryId: "custom-pets", name: "Vet" }, { categoryId: "loan", name: "Family" }];

  it("never offers the loan category to an AI reader", () => {
    expect(aiCategoryChoices(custom, subcategories).some((category) => category.id === "loan")).toBe(false);
    expect(aiCategoryChoices(custom, subcategories, "expense").some((category) => category.id === "loan")).toBe(false);
    expect(aiCategoryChoices([], []).some((category) => category.id === "loan")).toBe(false);
  });

  it("lists built-in and custom categories with their subcategories, custom ones added", () => {
    const choices = aiCategoryChoices(custom, subcategories);
    expect(choices.find((category) => category.id === "food")).toEqual({ id: "food", label: "Food & Dining", subcategories: ["Lunch", "Groceries", "Snacks", "Cafe", "Restaurant", "Momo"] });
    expect(choices.find((category) => category.id === "custom-pets")).toEqual({ id: "custom-pets", label: "Pets", subcategories: ["Vet"] });
    expect(choices.map((category) => category.id)).toEqual(expect.arrayContaining(["salary", "other", "custom-rent"]));
  });

  it("keeps only one kind's categories when asked, and custom categories without a kind", () => {
    const ids = aiCategoryChoices([...custom, { id: "custom-any", name: "Misc" }], [], "expense").map((category) => category.id);
    expect(ids).toEqual(expect.arrayContaining(["food", "other", "custom-pets", "custom-any"]));
    expect(ids).not.toContain("salary");
    expect(ids).not.toContain("custom-rent");
  });
});
