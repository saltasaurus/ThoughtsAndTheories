import { Select } from "@/components/ui/select";
import type { SectionOption } from "@/lib/visibility";

/** Reveal-point / position picker. Labels are structure (never gated); titles appear only when passed the gate. */
export function SectionSelect({
  name,
  options,
  defaultValue,
  emptyLabel,
  required,
  id,
  ariaLabel,
}: {
  name: string;
  options: SectionOption[];
  defaultValue?: string;
  /** when set, an empty first option with this label is offered */
  emptyLabel?: string;
  required?: boolean;
  id?: string;
  /** for repeated in-row pickers, which have no visible <label> of their own */
  ariaLabel?: string;
}) {
  return (
    <Select
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      required={required}
      aria-label={ariaLabel}
    >
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
