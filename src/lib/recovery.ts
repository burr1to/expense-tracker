export const RECOVERY_QUESTION_OPTIONS = [
  { value: "childhood_nickname", label: "What was your childhood nickname?" },
  { value: "first_pet", label: "What was the name of your first pet?" },
  { value: "favorite_teacher", label: "What was the surname of a favorite teacher?" },
  { value: "first_job", label: "What was your first job?" },
  { value: "favorite_place", label: "What was your favorite place growing up?" },
] as const;

export type RecoveryQuestionKey = (typeof RECOVERY_QUESTION_OPTIONS)[number]["value"];

export interface RecoverySetup {
  questionOne: RecoveryQuestionKey;
  answerOne: string;
  questionTwo: RecoveryQuestionKey;
  answerTwo: string;
  recoveryCode: string;
}
export interface RecoveryVerification {
  email: string;
  questionOne: RecoveryQuestionKey;
  answerOne: string;
  questionTwo: RecoveryQuestionKey;
  answerTwo: string;
  recoveryCode: string;
}

export function normalizeRecoveryAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeRecoveryCode(value: string) {
  return value.trim().replace(/[\s-]+/g, "").toUpperCase();
}

export function generateRecoveryCode() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}
