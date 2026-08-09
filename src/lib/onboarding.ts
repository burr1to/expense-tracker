export const ONBOARDING_EVENT = "saveyorupee:open-onboarding";
export const onboardingStorageKey = (userId: string) => `saveyorupee:onboarding:v1:${userId}`;
export const onboardingProgressKey = (userId: string) => `saveyorupee:onboarding:progress:v1:${userId}`;

export type OnboardingStepId = "pin" | "account" | "import" | "customize" | "transaction";
export type OnboardingProgress = Partial<Record<OnboardingStepId, boolean>>;

export function readOnboardingProgress(userId: string): OnboardingProgress {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(onboardingProgressKey(userId)) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      (["pin", "account", "import", "customize", "transaction"] as const)
        .filter((step) => parsed[step] === true)
        .map((step) => [step, true]),
    ) as OnboardingProgress;
  } catch {
    return {};
  }
}

export function markOnboardingStep(userId: string, step: OnboardingStepId) {
  if (typeof window === "undefined") return;
  const progress = { ...readOnboardingProgress(userId), [step]: true } satisfies OnboardingProgress;
  window.localStorage.setItem(onboardingProgressKey(userId), JSON.stringify(progress));
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT, { detail: { type: "progress", step } }));
}

export function reopenOnboardingGuide(userId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(onboardingStorageKey(userId), "active");
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT, { detail: { type: "reopen" } }));
}
