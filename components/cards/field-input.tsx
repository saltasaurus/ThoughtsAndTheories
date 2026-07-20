import type { FieldType } from "@prisma/client";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { inWorldDateSchema } from "@/lib/schemas";

export type FieldInputContext = {
  eras: Array<{ id: string; name: string; abbreviation: string }>;
  months: Array<{ name: string; order: number }>;
  /** visible cards only — the CARD_REF picker must not surface gated cards */
  cardOptions: Array<{ id: string; title: string }>;
};

type TemplateFieldLike = {
  id: string;
  fieldType: FieldType;
  options: unknown;
  required: boolean;
};

function choices(tf: TemplateFieldLike): string[] {
  const o = tf.options;
  if (typeof o === "object" && o !== null && "choices" in o) {
    const c = (o as { choices: unknown }).choices;
    if (Array.isArray(c)) return c.filter((x): x is string => typeof x === "string");
  }
  return [];
}

/** One input (or input cluster) for a template field. Names follow lib/field-form.ts. */
export function FieldInput({
  tf,
  ctx,
  defaultValue,
}: {
  tf: TemplateFieldLike;
  ctx: FieldInputContext;
  defaultValue?: unknown;
}) {
  const name = `field_${tf.id}`;
  switch (tf.fieldType) {
    case "TEXT":
      return <Input name={name} defaultValue={typeof defaultValue === "string" ? defaultValue : ""} required={tf.required} />;
    case "NUMBER":
      return (
        <Input
          name={name}
          type="number"
          step="any"
          defaultValue={typeof defaultValue === "number" ? defaultValue : ""}
          required={tf.required}
        />
      );
    case "IMAGE_URL":
      return <Input name={name} type="url" placeholder="https://…" defaultValue={typeof defaultValue === "string" ? defaultValue : ""} required={tf.required} />;
    case "SELECT":
      return (
        <Select name={name} defaultValue={typeof defaultValue === "string" ? defaultValue : ""} required={tf.required}>
          <option value="">—</option>
          {choices(tf).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      );
    case "MULTISELECT": {
      const selected = new Set(Array.isArray(defaultValue) ? (defaultValue as unknown[]) : []);
      return (
        <div className="flex flex-wrap gap-3">
          {choices(tf).map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={name} value={c} defaultChecked={selected.has(c)} />
              {c}
            </label>
          ))}
        </div>
      );
    }
    case "CARD_REF": {
      const current =
        typeof defaultValue === "object" && defaultValue !== null && "cardId" in defaultValue
          ? String((defaultValue as { cardId: unknown }).cardId)
          : "";
      return (
        <Select name={name} defaultValue={current} required={tf.required}>
          <option value="">—</option>
          {ctx.cardOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      );
    }
    case "RICHTEXT":
      return <RichTextEditor name={name} initial={defaultValue} />;
    case "INWORLD_DATE": {
      const parsed = inWorldDateSchema.safeParse(defaultValue);
      const d = parsed.success ? parsed.data : null;
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select name={`${name}_precision`} defaultValue={d?.precision ?? ""}>
            <option value="">— no date —</option>
            <option value="YEAR">Year</option>
            <option value="MONTH">Month</option>
            <option value="DAY">Day</option>
            <option value="UNKNOWN">Unknown</option>
          </Select>
          <Select name={`${name}_era`} defaultValue={d?.eraId ?? ""}>
            <option value="">era…</option>
            {ctx.eras.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.abbreviation})
              </option>
            ))}
          </Select>
          <Input name={`${name}_year`} type="number" placeholder="year" defaultValue={d?.year ?? ""} />
          <Select name={`${name}_month`} defaultValue={d?.monthOrder ?? ""}>
            <option value="">month…</option>
            {ctx.months.map((m) => (
              <option key={m.order} value={m.order}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input name={`${name}_day`} type="number" placeholder="day" defaultValue={d?.day ?? ""} />
          <Input name={`${name}_override`} placeholder="display override" defaultValue={d?.displayOverride ?? ""} />
        </div>
      );
    }
  }
}
