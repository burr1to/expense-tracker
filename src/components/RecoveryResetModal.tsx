"use client";

import { Modal, PasswordInput, Select, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { RECOVERY_QUESTION_OPTIONS, type RecoveryQuestionKey, type RecoveryVerification } from "../lib/recovery";

interface RecoveryResetModalProps {
  opened: boolean;
  onClose: () => void;
  onVerify: (verification: RecoveryVerification) => Promise<string>;
  onReset: (token: string, password: string) => Promise<void>;
  onComplete: () => void;
}

const questionData = RECOVERY_QUESTION_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

export function RecoveryResetModal({ opened, onClose, onVerify, onReset, onComplete }: RecoveryResetModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [questionOne, setQuestionOne] = useState<RecoveryQuestionKey>(RECOVERY_QUESTION_OPTIONS[0].value);
  const [answerOne, setAnswerOne] = useState("");
  const [questionTwo, setQuestionTwo] = useState<RecoveryQuestionKey>(RECOVERY_QUESTION_OPTIONS[1].value);
  const [answerTwo, setAnswerTwo] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setStep(1); setEmail(""); setQuestionOne(RECOVERY_QUESTION_OPTIONS[0].value); setAnswerOne(""); setQuestionTwo(RECOVERY_QUESTION_OPTIONS[1].value); setAnswerTwo(""); setRecoveryCode(""); setToken(""); setPassword(""); setConfirmPassword(""); setError(null);
  }, [opened]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (questionOne === questionTwo) { setError("Choose the same two questions you used during setup."); return; }
    setSubmitting(true); setError(null);
    try {
      const nextToken = await onVerify({ email, questionOne, answerOne, questionTwo, answerTwo, recoveryCode });
      setToken(nextToken); setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those recovery details did not match.");
    } finally {
      setSubmitting(false);
    }
};
  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirmPassword) { setError("The new passwords do not match."); return; }
    setSubmitting(true); setError(null);
    try {
      await onReset(token, password);
      onClose();
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your password.");
    } finally {
      setSubmitting(false);
    }
  };

  return <Modal opened={opened} onClose={() => { if (!submitting) onClose(); }} centered closeOnClickOutside={!submitting} closeOnEscape={!submitting} withCloseButton={!submitting} title={step === 1 ? "Verify account recovery" : "Choose a new password"} overlayProps={{ backgroundOpacity: .55, blur: 5 }}>
    {step === 1 ? <form className="recovery-form" onSubmit={verify} aria-busy={submitting}>
      <p className="field-hint">Step 1 of 2 · Use the two questions and recovery code you saved for this account.</p>
      <TextInput label="Email address" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" required disabled={submitting} />
      <Select label="Security question 1" value={questionOne} onChange={(value) => value && setQuestionOne(value as RecoveryQuestionKey)} data={questionData} allowDeselect={false} disabled={submitting} />
      <TextInput label="Your answer" value={answerOne} onChange={(event) => setAnswerOne(event.currentTarget.value)} autoComplete="off" required disabled={submitting} />
      <Select label="Security question 2" value={questionTwo} onChange={(value) => value && setQuestionTwo(value as RecoveryQuestionKey)} data={questionData} allowDeselect={false} disabled={submitting} />
      <TextInput label="Your answer" value={answerTwo} onChange={(event) => setAnswerTwo(event.currentTarget.value)} autoComplete="off" required disabled={submitting} />
      <TextInput label="Recovery code" value={recoveryCode} onChange={(event) => setRecoveryCode(event.currentTarget.value)} autoComplete="one-time-code" required disabled={submitting} />
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" disabled={submitting}>{submitting ? <><ButtonSpinner />Checking…</> : "Verify recovery details"}</button></div>
    </form> : <form className="recovery-form" onSubmit={reset} aria-busy={submitting}>
      <p className="field-hint">Step 2 of 2 · Your recovery details matched. Choose a new password for this account.</p>
      <PasswordInput label="New password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} minLength={8} maxLength={128} autoComplete="new-password" required disabled={submitting} />
      <PasswordInput label="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} minLength={8} maxLength={128} autoComplete="new-password" required disabled={submitting} />
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" disabled={submitting || password.length < 8 || confirmPassword.length < 8}>{submitting ? <><ButtonSpinner />Updating…</> : "Update password"}</button></div>
    </form>}
  </Modal>;
}
