import { TextInput } from "@mantine/core";
import { X } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { formatLedgerDate } from "../lib/dates";
import { groupDraftError, TRANSACTION_GROUP_ICONS } from "../lib/transaction-groups";
import { toUserMessage } from "../lib/user-messages";
import type { CalendarSystem, TransactionGroup, TransactionGroupDraft } from "../types";
import { AnimatedOverlay } from "./AnimatedOverlay";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import { GroupIcon } from "./GroupIcon";
import { LedgerDatePickerInput as DatePickerInput } from "./LedgerDatePickerInput";

interface GroupFormSheetProps {
  open: boolean;
  /** The group being edited; a new group otherwise. */
  group?: TransactionGroup | null;
  calendarSystem: CalendarSystem;
  onSave: (draft: TransactionGroupDraft) => Promise<void>;
  onClose: () => void;
}

const emptyDraft: TransactionGroupDraft = { name: "", icon: "trip", startOn: "", endOn: "", note: "" };

export function GroupFormSheet({ open, group, calendarSystem, onSave, onClose }: GroupFormSheetProps) {
  const [draft, setDraft] = useState<TransactionGroupDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  // Mounted from the first open on, so it can animate out; nothing renders on the server.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const close = () => { if (!saving) onClose(); };

  // Set up once per opening, so a ledger refresh underneath never resets what is being typed.
  useEffect(() => {
    if (!open) return;
    setDraft(group ? { name: group.name, icon: group.icon, startOn: group.startOn ?? "", endOn: group.endOn ?? "", note: group.note } : emptyDraft);
    setError("");
    setTouched(false);
  }, [group, open]);

  const problem = groupDraftError(draft);
  const set = <K extends keyof TransactionGroupDraft>(key: K, value: TransactionGroupDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not save this group."));
    } finally {
      setSaving(false);
    }
  };
  const bsHint = (value: string) => calendarSystem === "BS" && value ? formatLedgerDate(value, "BS") : undefined;

  if (!shown) return null;
  // Rendered on the body so the route panel's transform cannot clip the backdrop.
  return createPortal(<AnimatedOverlay open={open} dismissOnBackdrop onClose={close}>
    <section className="group-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title" aria-busy={saving}>
      <header>
        <div><span className="eyebrow">{group ? "Edit group" : "New group"}</span><h2 id="group-dialog-title">{group ? group.name : "Group transactions"}</h2></div>
        <button type="button" className="icon-button" disabled={saving} onClick={close} aria-label="Close"><X size={20} /></button>
      </header>
      <form className="group-form" onSubmit={(event) => void submit(event)} noValidate>
        <TextInput label="Name" placeholder="Pokhara trip" value={draft.name} onChange={(event) => set("name", event.currentTarget.value.slice(0, 60))} error={touched && problem?.field === "name" ? problem.message : undefined} maxLength={60} required data-autofocus />
        <fieldset className="group-icon-choices">
          <legend>Icon</legend>
          <div>{TRANSACTION_GROUP_ICONS.map((option) => <button type="button" key={option.id} className={draft.icon === option.id ? "group-icon-choice selected" : "group-icon-choice"} aria-pressed={draft.icon === option.id} onClick={() => set("icon", option.id)}><GroupIcon icon={option.id} size={19} /><span>{option.label}</span></button>)}</div>
        </fieldset>
        <div className="group-form-dates">
          <DatePickerInput label="Starts" description={bsHint(draft.startOn) ?? "Optional"} value={draft.startOn || null} onChange={(value) => set("startOn", value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
          <DatePickerInput label="Ends" description={bsHint(draft.endOn) ?? "Optional"} value={draft.endOn || null} onChange={(value) => set("endOn", value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} minDate={draft.startOn || undefined} error={problem?.field === "endOn" ? problem.message : undefined} />
        </div>
        <p className="field-hint">Dates help pick the right entries and suggest this group when you add something on those days. Entries outside them can still be added.</p>
        <TextInput label="Note" description="Optional" placeholder="With college friends" value={draft.note} onChange={(event) => set("note", event.currentTarget.value.slice(0, 240))} maxLength={240} />
        <FormError message={error} />
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={close}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Saving…</> : group ? "Save changes" : "Create group"}</button>
        </div>
      </form>
    </section>
  </AnimatedOverlay>, document.body);
}
