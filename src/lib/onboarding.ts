export const ONBOARDING_EVENT = "saveyorupee:open-onboarding";
export const onboardingStorageKey = (userId: string) => `saveyorupee:onboarding:v1:${userId}`;

export function reopenOnboardingGuide(userId: string) {
  window.localStorage.setItem(onboardingStorageKey(userId), "active");
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT));
}
