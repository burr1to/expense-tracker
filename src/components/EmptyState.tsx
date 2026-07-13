import { Receipt } from "@phosphor-icons/react";

export function EmptyState({ title = "Nothing logged yet", message = "Add your first entry to start seeing your monthly story.", action }: { title?: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Receipt size={34} weight="duotone" />
      <strong>{title}</strong>
      <p>{message}</p>
      {action}
    </div>
  );
}
