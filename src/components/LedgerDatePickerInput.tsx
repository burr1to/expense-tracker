import { DatePickerInput, type DatePickerInputProps } from "@mantine/dates";
import { CalendarBlank } from "@phosphor-icons/react";

export function LedgerDatePickerInput(props: DatePickerInputProps) {
  return (
    <DatePickerInput
      leftSection={<CalendarBlank size={16} aria-hidden />}
      popoverProps={{ classNames: { dropdown: "day-picker-popover" } }}
      {...props}
    />
  );
}
