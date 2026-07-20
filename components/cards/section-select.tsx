import { Select } from "@/components/ui/select";
import type { SectionOption } from "@/lib/visibility";

/** Reveal-point / position picker. Labels are structure (never gated); titles appear only when passed the gate. */
export function SectionSelect({
  name,
  options,
  defaultValue,
  emptyLabel,
  required,
}: {
  name: string;
  options: SectionOption[];
  defaultValue?: string;
  /** when set, an empty first option with this label is offered */
  emptyLabel?: string;
  required?: boolean;
}) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} required={required}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
          {o.title ? ` — ${o.title}` : ""}
        </option>
      ))}
    </Select>
  );
}
