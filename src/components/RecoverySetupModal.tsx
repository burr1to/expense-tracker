"use client";

import { Checkbox, Modal, Select, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { generateRecoveryCode, RECOVERY_QUESTION_OPTIONS, type RecoveryQuestionKey, type RecoverySetup } from "../lib/recovery";

interface RecoverySetupModalProps {
  opened: boolean;
  onClose: () => void;
  onSave: (setup: RecoverySetup) => Promise<void>;
  title?: string;
}

const questionData = RECOVERY_QUESTION_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

export function RecoverySetupModal({ opened, onClose, onSave, title = "Set up password recovery" }: RecoverySetupModalProps) {
  const [questionOne, setQuestionOne] = useState<RecoveryQuestionKey>(RECOVERY_QUESTION_OPTIONS[0].value);
  const [answerOne, setAnswerOne] = useState("");
  const [questionTwo, setQuestionTwo] = useState<RecoveryQuestionKey>(RECOVERY_QUESTION_OPTIONS[1].value);
  const [answerTwo, setAnswerTwo] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setQuestionOne(RECOVERY_QUESTION_OPTIONS[0].value);
    setAnswerOne("");
    setQuestionTwo(RECOVERY_QUESTION_OPTIONS[1].value);
    setAnswerTwo("");
    setRecoveryCode(generateRecoveryCode());
    setSavedCode(false);
    setError(null);
  }, [opened]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (questionOne === questionTwo) { setError("Choose two different security questions."); return; }
    if (!savedCode) { setError("Save your recovery code somewhere safe first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onSave({ questionOne, answerOne, questionTwo, answerTwo, recoveryCode });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your recovery details.");
    } finally {
      setSubmitting(false);
    }
};
  return <Modal opened={opened} onClose={() => { if (!submitting) onClose(); }} centered closeOnClickOutside={!submitting} closeOnEscape={!submitting} withCloseButton={!submitting} title={title} overlayProps={{ backgroundOpacity: .55, blur: 5 }}>
    <form className="recovery-form" onSubmit={submit} aria-busy={submitting}>
      <p className="field-hint">These details are used to reset your password when email delivery is unavailable. Answers are stored as hashes.</p>
      <Select label="Security question 1" value={questionOne} onChange={(value) => value && setQuestionOne(value as RecoveryQuestionKey)} data={questionData} allowDeselect={false} disabled={submitting} />
      <TextInput label="Your answer" value={answerOne} onChange={(event) => setAnswerOne(event.currentTarget.value)} minLength={2} maxLength={128} autoComplete="off" required disabled={submitting} />
      <Select label="Security question 2" value={questionTwo} onChange={(value) => value && setQuestionTwo(value as RecoveryQuestionKey)} data={questionData} allowDeselect={false} disabled={submitting} />
      <TextInput label="Your answer" value={answerTwo} onChange={(event) => setAnswerTwo(event.currentTarget.value)} minLength={2} maxLength={128} autoComplete="off" required disabled={submitting} />
      <div className="recovery-code-panel"><span>One-time recovery code</span><code>{recoveryCode}</code><small>Store this code outside the app. It will not be shown again.</small></div>
      <Checkbox label="I saved my recovery code" checked={savedCode} onChange={(event) => setSavedCode(event.currentTarget.checked)} disabled={submitting} />
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Not now</button><button className="primary-button" disabled={submitting || !answerOne.trim() || !answerTwo.trim() || !savedCode}>{submitting ? <><ButtonSpinner />Saving…</> : "Save recovery details"}</button></div>
    </form>
  </Modal>;
}
